/* =====================================================================
   app.js — library browser + player.

   Two backends behind one interface:
     DirectSource    .mkv straight off WebDAV / File Station
     JellyfinSource  Jellyfin on the NAS demuxes and serves HLS

   Only JellyfinSource can switch audio tracks embedded inside an MKV.
   That is a browser limitation, not a gap in this code: the HTMLMediaElement
   audioTracks API is unimplemented in Chrome and Firefox, so nothing running
   in the page can reach a second audio stream inside a container.
   ===================================================================== */
(function () {
"use strict";

const CFG = window.ANIME_CONFIG || {};
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  source: null,
  series: [],
  current: { series: null, seasonIdx: 0, episode: null },
  art: null,
  octopus: null,
  hls: null,
  altAudio: null,       // <audio> used for sidecar dubs in direct mode
  driftTimer: null,
  subOffset: 0,
  currentSubId: undefined,
  gain: null            // WebAudio node for volume boost past 100%
};

const PROGRESS_KEY = "ap:progress";
const JF_KEY = "ap:jellyfin";

/* ------------------------------ utils ------------------------------ */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const hhmm = s => {
  if (!s || !isFinite(s)) return "";
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const clock = s => {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60), x = Math.floor(s % 60);
  return `${m}:${String(x).padStart(2, "0")}`;
};

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function progressAll() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { return {}; }
}
function saveProgress(key, time, duration) {
  if (!key || !isFinite(time) || !duration) return;
  const all = progressAll();
  if (time / duration > 0.93) delete all[key];          // finished, drop it
  else all[key] = { t: time, d: duration, at: Date.now() };
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch (e) {}
}
const getProgress = key => progressAll()[key] || null;

/* A stable key per episode so resume survives reloads. */
const epKey = (series, ep) => `${series.id}::${ep.seasonIdx ?? 0}::${ep.n}`;

/* Deterministic colour so series without art still look intentional. */
function coverGradient(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  const a = h % 360, b = (a + 48) % 360;
  return `linear-gradient(140deg, hsl(${a} 55% 32%), hsl(${b} 60% 20%))`;
}

/* =====================================================================
   SOURCE: DIRECT  (WebDAV / File Station)
   ===================================================================== */
const DirectSource = {
  name: "direct",
  canSwitchEmbeddedAudio: false,

  url(path) {
    if (/^https?:\/\//i.test(path)) return path;
    const base = (CFG.nas?.baseUrl || "").replace(/\/+$/, "");
    return base + "/" + String(path).split("/").map(encodeURIComponent).join("/");
  },

  async library() {
    return (CFG.library || []).map(s => ({
      ...s,
      seasons: (s.seasons || []).map((season, si) => ({
        ...season,
        episodes: (season.episodes || []).map(e => ({ ...e, seasonIdx: si }))
      }))
    }));
  },

  /* Returns everything the player needs for one episode. */
  async playback(series, ep) {
    const subs = (ep.subtitles || []).map((s, i) => ({
      id: "sub" + i, label: s.label || s.lang || `Track ${i + 1}`,
      url: this.url(s.file),
      format: /\.(ass|ssa)$/i.test(s.file) ? "ass" : "vtt",
      default: !!s.default
    }));

    const audio = (ep.audio || []).map((a, i) => ({
      id: "aud" + i, label: a.label || a.lang || `Track ${i + 1}`,
      embedded: !!a.embedded,
      url: a.file ? this.url(a.file) : null
    }));

    return {
      type: "file",
      src: this.url(ep.file),
      mime: "video/x-matroska",
      subtitles: subs,
      audio: audio.length ? audio : [{ id: "aud0", label: "Default", embedded: true, url: null }],
      thumbnails: ep.thumbnails ? this.url(ep.thumbnails) : null,
      intro: ep.intro || null,
      duration: ep.duration || 0
    };
  }
};

/* =====================================================================
   SOURCE: JELLYFIN
   The server demuxes, so audio and subtitle tracks arrive as real,
   independently selectable streams.
   ===================================================================== */
const JellyfinSource = {
  name: "jellyfin",
  canSwitchEmbeddedAudio: true,
  auth: null,

  get base() { return (CFG.jellyfin?.serverUrl || "").replace(/\/+$/, ""); },

  loadAuth() {
    try { this.auth = JSON.parse(localStorage.getItem(JF_KEY)); } catch (e) { this.auth = null; }
    if (!this.auth && CFG.jellyfin?.apiKey) {
      this.auth = { token: CFG.jellyfin.apiKey, userId: null, name: "API key" };
    }
    return this.auth;
  },

  authHeader() {
    const device = "AnimePortal";
    const t = this.auth?.token ? `, Token="${this.auth.token}"` : "";
    return `MediaBrowser Client="${device}", Device="Browser", DeviceId="ap-web", Version="1.0.0"${t}`;
  },

  async api(path, opts = {}) {
    const r = await fetch(this.base + path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization": this.authHeader(),
        ...(opts.headers || {})
      }
    });
    if (r.status === 401) { this.logout(); throw new Error("Session expired. Sign in again."); }
    if (!r.ok) throw new Error(`Jellyfin returned ${r.status}`);
    return r.status === 204 ? null : r.json();
  },

  async login(username, password) {
    const r = await fetch(this.base + "/Users/AuthenticateByName", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Emby-Authorization": this.authHeader() },
      body: JSON.stringify({ Username: username, Pw: password })
    });
    if (r.status === 401) throw new Error("Wrong username or password.");
    if (!r.ok) throw new Error(`Could not reach Jellyfin (${r.status}).`);
    const d = await r.json();
    this.auth = { token: d.AccessToken, userId: d.User.Id, name: d.User.Name };
    localStorage.setItem(JF_KEY, JSON.stringify(this.auth));
    return this.auth;
  },

  logout() {
    this.auth = null;
    try { localStorage.removeItem(JF_KEY); } catch (e) {}
  },

  async library() {
    if (!this.auth?.userId) return [];
    const res = await this.api(
      `/Users/${this.auth.userId}/Items?IncludeItemTypes=Series&Recursive=true` +
      `&Fields=Overview,Genres,ProductionYear&SortBy=SortName&Limit=500`
    );
    return (res.Items || []).map(it => ({
      id: it.Id,
      title: it.Name,
      year: it.ProductionYear,
      genres: it.Genres || [],
      synopsis: it.Overview || "",
      poster: it.ImageTags?.Primary
        ? `${this.base}/Items/${it.Id}/Images/Primary?maxHeight=450&tag=${it.ImageTags.Primary}`
        : "",
      seasons: null,           // filled lazily by loadSeasons
      _lazy: true
    }));
  },

  async loadSeasons(series) {
    const seasons = await this.api(`/Shows/${series.id}/Seasons?userId=${this.auth.userId}`);
    const out = [];
    for (const [si, s] of (seasons.Items || []).entries()) {
      const eps = await this.api(
        `/Shows/${series.id}/Episodes?seasonId=${s.Id}&userId=${this.auth.userId}` +
        `&Fields=Overview,MediaSources,RunTimeTicks`
      );
      out.push({
        title: s.Name,
        episodes: (eps.Items || []).map(e => ({
          id: e.Id,
          n: e.IndexNumber ?? 0,
          title: e.Name,
          desc: e.Overview || "",
          seasonIdx: si,
          duration: e.RunTimeTicks ? e.RunTimeTicks / 1e7 : 0,
          thumb: e.ImageTags?.Primary
            ? `${this.base}/Items/${e.Id}/Images/Primary?maxHeight=140&tag=${e.ImageTags.Primary}`
            : "",
          _mediaSourceId: e.MediaSources?.[0]?.Id,
          _streams: e.MediaSources?.[0]?.MediaStreams || []
        }))
      });
    }
    return out;
  },

  async playback(series, ep) {
    const streams = ep._streams || [];
    const msId = ep._mediaSourceId || ep.id;

    const audio = streams.filter(s => s.Type === "Audio").map(s => ({
      id: String(s.Index),
      index: s.Index,
      label: s.DisplayTitle || s.Language || `Audio ${s.Index}`,
      embedded: true,
      url: null
    }));

    // Subtitles come out as sidecar files, which is exactly what libass wants.
    const subtitles = streams.filter(s => s.Type === "Subtitle").map(s => {
      const ass = /ass|ssa/i.test(s.Codec || "");
      return {
        id: String(s.Index),
        index: s.Index,
        label: s.DisplayTitle || s.Language || `Subtitle ${s.Index}`,
        url: `${this.base}/Videos/${ep.id}/${msId}/Subtitles/${s.Index}/0/Stream.${ass ? "ass" : "vtt"}?api_key=${this.auth.token}`,
        format: ass ? "ass" : "vtt",
        default: !!s.IsDefault
      };
    });

    const build = audioIndex => {
      const p = new URLSearchParams({
        MediaSourceId: msId,
        api_key: this.auth.token,
        VideoCodec: "h264",
        AudioCodec: "aac",
        MaxStreamingBitrate: String(CFG.jellyfin?.maxBitrate || 20000000),
        TranscodingContainer: "ts",
        TranscodingProtocol: "hls",
        SegmentContainer: "ts",
        MinSegments: "1",
        BreakOnNonKeyFrames: "true"
      });
      if (audioIndex != null) p.set("AudioStreamIndex", String(audioIndex));
      return `${this.base}/Videos/${ep.id}/master.m3u8?${p}`;
    };

    return {
      type: "hls",
      src: build(audio[0]?.index),
      buildSrc: build,                   // re-called when the audio track changes
      audio: audio.length ? audio : [{ id: "0", index: null, label: "Default", embedded: true }],
      subtitles,
      thumbnails: null,
      intro: null,
      duration: ep.duration || 0
    };
  }
};

/* =====================================================================
   SUBTITLES (libass / SubtitlesOctopus)
   ===================================================================== */
/* MUST be same-origin. Browsers throw SecurityError on new Worker() with a
   cross-origin URL, so the libass worker cannot be loaded from a CDN — it has
   to live in your repo. See SETUP.md step 2. */
/* Absolute, because relative URLs inside a Worker resolve against the WORKER's
   location, not the page's — a relative path silently 404s the font. */
const abs = p => new URL(p, location.href).href;
const OCTOPUS_WORKER = abs((window.ANIME_CONFIG?.subtitleWorker) || "vendor/libass/subtitles-octopus-worker.js");
const OCTOPUS_FONT   = abs((window.ANIME_CONFIG?.subtitleFont)   || "vendor/libass/default.woff2");
let octopusChecked = false, octopusOk = false;

async function octopusAvailable() {
  if (octopusChecked) return octopusOk;
  octopusChecked = true;
  try {
    const r = await fetch(OCTOPUS_WORKER, { method: "HEAD" });
    octopusOk = r.ok;
  } catch (e) { octopusOk = false; }
  if (!octopusOk) {
    toast("ASS subtitles need the libass files in vendor/libass/ — see SETUP.md step 2.", 6000);
  }
  return octopusOk;
}

function destroySubs() {
  if (state.octopus) { try { state.octopus.dispose(); } catch (e) {} state.octopus = null; }
}

async function mountSubs(video, track) {
  // ArtPlayer fires onSelect for the default item during init, which races the
  // "ready" handler. Without this guard the second call disposes the first
  // worker mid-boot and subtitles silently never appear.
  const id = track ? track.id : null;
  if (id === state.currentSubId && (state.octopus || !id)) return;
  state.currentSubId = id;

  destroySubs();
  if (!track) return;

  if (track.format === "ass") {
    if (typeof SubtitlesOctopus === "undefined") { toast("Subtitle renderer failed to load."); return; }
    if (!(await octopusAvailable())) return;
    try {
      state.octopus = new SubtitlesOctopus({
        video,
        subUrl: track.url,
        workerUrl: OCTOPUS_WORKER,
        // libass needs a real font file. The npm package does not ship one,
        // so it must be vendored alongside the worker or nothing renders.
        fallbackFont: OCTOPUS_FONT,
        // legacyWorkerUrl left unset: every browser we target has WebAssembly
        timeOffset: state.subOffset,
        onError: () => toast("Could not load that subtitle file. Check CORS on the NAS.")
      });
    } catch (e) {
      toast("Subtitle renderer failed to start.");
    }
    return;
  }

  // VTT / SRT path: let the browser render it natively
  [...video.querySelectorAll("track")].forEach(t => t.remove());
  const t = document.createElement("track");
  t.kind = "subtitles"; t.label = track.label; t.src = track.url; t.default = true;
  video.appendChild(t);
  setTimeout(() => { if (video.textTracks[0]) video.textTracks[0].mode = "showing"; }, 60);
}

function setSubOffset(sec) {
  state.subOffset = sec;
  if (state.octopus) { try { state.octopus.timeOffset = sec; } catch (e) {} }
}

/* =====================================================================
   SIDECAR DUB SYNC  (direct mode only)
   Plays a separate audio file locked to the video clock. Not as clean as
   real track switching, but it is the only way to get a dub in direct mode.
   ===================================================================== */
function stopAltAudio(video) {
  clearInterval(state.driftTimer); state.driftTimer = null;
  if (state.altAudio) { state.altAudio.pause(); state.altAudio.src = ""; state.altAudio = null; }
  if (video) video.muted = false;
}

function startAltAudio(video, url) {
  stopAltAudio(video);
  const a = new Audio(url);
  a.preload = "auto";
  a.crossOrigin = CFG.nas?.withCredentials ? "use-credentials" : "anonymous";
  state.altAudio = a;
  video.muted = true;

  const sync = () => { if (Math.abs(a.currentTime - video.currentTime) > 0.3) a.currentTime = video.currentTime; };
  a.addEventListener("loadedmetadata", () => { sync(); if (!video.paused) a.play().catch(() => {}); });
  video.addEventListener("play",  () => { sync(); a.play().catch(() => {}); });
  video.addEventListener("pause", () => a.pause());
  video.addEventListener("seeked", sync);
  video.addEventListener("ratechange", () => { a.playbackRate = video.playbackRate; });
  state.driftTimer = setInterval(sync, 1000);
}

/* =====================================================================
   VOLUME BOOST  (WebAudio gain above 1.0)
   ===================================================================== */
function ensureGain(video) {
  if (state.gain) return state.gain;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(video);
    const g = ctx.createGain();
    src.connect(g); g.connect(ctx.destination);
    state.gain = { ctx, node: g };
    return state.gain;
  } catch (e) { return null; }   // cross-origin media without CORS headers blocks this
}

/* =====================================================================
   PLAYER
   ===================================================================== */
async function playEpisode(series, ep) {
  let pb;
  try {
    pb = await state.source.playback(series, ep);
  } catch (e) {
    return toast(e.message || "Could not prepare that episode.");
  }

  state.current = { series, seasonIdx: ep.seasonIdx ?? 0, episode: ep };
  showView("player");

  $("#nowSeries").textContent = series.title;
  $("#nowTitle").textContent  = `Episode ${ep.n}${ep.title ? " · " + ep.title : ""}`;
  $("#nowDesc").textContent   = ep.desc || series.synopsis || "";

  renderEpisodes();
  renderTrackInfo(pb);

  const key = epKey(series, ep);
  const resume = getProgress(key);

  state.currentSubId = undefined;
  destroySubs();
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  if (state.art) { try { state.art.destroy(false); } catch (e) {} state.art = null; }

  const defaultSub = pb.subtitles.find(s => s.default) || pb.subtitles[0] || null;

  const art = new Artplayer({
    container: "#player",
    url: pb.src,
    type: pb.type === "hls" ? "m3u8" : "",
    volume: 1,
    autoplay: false,
    pip: true,
    setting: true,
    playbackRate: true,
    fullscreen: true,
    fullscreenWeb: true,
    miniProgressBar: true,
    autoOrientation: true,
    airplay: true,
    theme: CFG.site?.accent || "#8b5cf6",
    moreVideoAttr: {
      crossOrigin: CFG.nas?.withCredentials ? "use-credentials" : "anonymous",
      playsInline: true
    },

    customType: {
      m3u8: (video, url) => {
        if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = url; return; }
        if (!window.Hls || !Hls.isSupported()) { toast("HLS is not supported in this browser."); return; }
        const hls = new Hls({ maxBufferLength: 30, enableWorker: true });
        hls.loadSource(url); hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) toast("Stream error: " + d.details); });
        state.hls = hls;
      }
    },

    // ±10s, speed, boost and offset live here
    controls: [
      {
        name: "back10", position: "left", index: 12,
        html: '<span style="font-size:12px;font-weight:700">-10s</span>',
        tooltip: "Back 10 seconds",
        click: () => { art.currentTime = Math.max(0, art.currentTime - 10); }
      },
      {
        name: "fwd10", position: "left", index: 13,
        html: '<span style="font-size:12px;font-weight:700">+10s</span>',
        tooltip: "Forward 10 seconds",
        click: () => { art.currentTime = Math.min(art.duration, art.currentTime + 10); }
      }
    ],

    settings: [
      /* ---- audio ---- */
      {
        width: 260,
        html: "Audio",
        tooltip: pb.audio[0]?.label || "Default",
        selector: pb.audio.map((a, i) => ({ ...a, html: a.label, default: i === 0 })),
        onSelect: item => { switchAudio(art, pb, item); return item.html; }
      },
      /* ---- subtitles ---- */
      {
        width: 260,
        html: "Subtitles",
        tooltip: defaultSub ? defaultSub.label : "Off",
        selector: [
          { html: "Off", url: null, default: !defaultSub },
          ...pb.subtitles.map(s => ({ ...s, html: s.label, default: defaultSub && s.id === defaultSub.id }))
        ],
        onSelect: item => { mountSubs(art.video, item.url ? item : null); return item.html; }
      },
      /* ---- subtitle offset ---- */
      {
        html: "Subtitle delay",
        tooltip: "0.0s",
        selector: [-2, -1, -0.5, 0, 0.5, 1, 2].map(v => ({
          html: (v > 0 ? "+" : "") + v.toFixed(1) + "s", value: v, default: v === 0
        })),
        onSelect: item => { setSubOffset(item.value); return item.html; }
      },
      /* ---- volume boost ---- */
      {
        html: "Volume boost",
        tooltip: "Off",
        selector: [1, 1.5, 2, 3].map(v => ({ html: v === 1 ? "Off" : v + "x", value: v, default: v === 1 })),
        onSelect: item => {
          const g = ensureGain(art.video);
          if (!g) { toast("Boost needs CORS headers on the media host."); return "Off"; }
          g.ctx.resume();
          g.node.gain.value = item.value;
          return item.html;
        }
      }
    ]
  });

  state.art = art;

  art.on("ready", () => {
    if (resume && resume.t > 10) {
      art.currentTime = resume.t;
      toast(`Resumed at ${clock(resume.t)}`);
    }
    if (defaultSub) mountSubs(art.video, defaultSub);
    if (pb.thumbnails) { try { art.thumbnails.url = pb.thumbnails; } catch (e) {} }

    // "Skip intro" appears only while inside the configured window
    if (pb.intro) {
      const btn = document.createElement("button");
      btn.className = "btn-accent";
      btn.textContent = "Skip intro";
      btn.style.cssText = "position:absolute;right:20px;bottom:76px;z-index:60;display:none";
      btn.onclick = () => { art.currentTime = pb.intro[1]; btn.style.display = "none"; };
      art.template.$player.appendChild(btn);
      art.on("video:timeupdate", () => {
        const t = art.currentTime;
        btn.style.display = (t >= pb.intro[0] && t < pb.intro[1]) ? "block" : "none";
      });
    }
  });

  let tick = 0;
  art.on("video:timeupdate", () => {
    if (++tick % 20) return;                       // roughly every 5s
    saveProgress(key, art.currentTime, art.duration);
  });

  art.on("video:ended", () => {
    saveProgress(key, 0, art.duration);
    const next = neighbourEpisode(1);
    if (next) playEpisode(series, next);
  });

  art.on("error", () => {
    toast(pb.type === "file"
      ? "The browser refused this file. The codecs inside are probably unsupported — see SETUP.md."
      : "Playback failed. Check that Jellyfin is reachable.");
  });
}

/* Audio switching differs completely between the two backends. */
function switchAudio(art, pb, track) {
  if (state.source.canSwitchEmbeddedAudio && pb.buildSrc) {
    // Jellyfin: ask the server for the same video with a different audio index
    const at = art.currentTime, wasPlaying = !art.video.paused;
    const url = pb.buildSrc(track.index);
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    art.switchUrl(url).then(() => {
      art.currentTime = at;
      if (wasPlaying) art.play();
    });
    return;
  }

  // Direct mode
  if (track.embedded) { stopAltAudio(art.video); return; }
  if (track.url) { startAltAudio(art.video, track.url); return; }
  toast("This track is inside the MKV and the browser cannot reach it.");
}

/* =====================================================================
   RENDERING
   ===================================================================== */
function showView(which) {
  $("#viewBrowse").classList.toggle("hidden", which !== "browse");
  $("#viewPlayer").classList.toggle("hidden", which !== "player");
  $("#pageTitle").textContent = which === "player" ? state.current.series?.title || "Now playing" : "Browse";
  if (which === "browse") window.scrollTo({ top: 0 });
}

function renderGrid(filter = "") {
  const q = filter.trim().toLowerCase();
  const list = state.series.filter(s =>
    !q || (s.title + " " + (s.genres || []).join(" ")).toLowerCase().includes(q));

  const grid = $("#grid");
  grid.innerHTML = "";
  $("#browseEmpty").classList.toggle("hidden", list.length > 0);

  if (!list.length) {
    $("#browseEmptyMsg").textContent = q
      ? `Nothing matches "${filter}".`
      : state.source.name === "jellyfin"
        ? "Sign in to your Jellyfin server to load the library."
        : "Add your series to the library array in config.js.";
    return;
  }

  list.forEach(s => {
    const count = (s.seasons || []).reduce((n, x) => n + x.episodes.length, 0);
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML =
      `<div class="card-art" style="background:${coverGradient(s.title)}">
         ${s.poster ? `<img src="${esc(s.poster)}" alt="" loading="lazy" onerror="this.remove()">`
                    : `<div class="card-fallback">${esc(s.title)}</div>`}
         ${count ? `<span class="card-count">${count} ep</span>` : ""}
       </div>
       <div class="card-title">${esc(s.title)}</div>
       <div class="card-sub">${[s.year, (s.genres || [])[0]].filter(Boolean).join(" · ")}</div>`;
    el.onclick = () => openSeries(s);
    grid.appendChild(el);
  });
}

function renderSeriesList() {
  const box = $("#seriesList");
  box.innerHTML = "";
  state.series.forEach(s => {
    const b = document.createElement("button");
    b.className = "series-row" + (state.current.series?.id === s.id ? " active" : "");
    b.textContent = s.title;
    b.onclick = () => { openSeries(s); closeSidebar(); };
    box.appendChild(b);
  });
}

async function openSeries(series) {
  if (series._lazy && !series.seasons) {
    toast("Loading episodes…");
    try { series.seasons = await state.source.loadSeasons(series); }
    catch (e) { return toast(e.message || "Could not load that series."); }
  }
  const eps = series.seasons?.[0]?.episodes || [];
  if (!eps.length) return toast("That series has no episodes.");

  // resume the furthest-watched episode if there is one
  const all = progressAll();
  const started = series.seasons.flatMap(s => s.episodes).filter(e => all[epKey(series, e)]);
  playEpisode(series, started.length ? started[started.length - 1] : eps[0]);
  renderSeriesList();
}

function renderEpisodes() {
  const { series, seasonIdx, episode } = state.current;
  if (!series) return;

  const sel = $("#seasonSelect");
  sel.innerHTML = series.seasons.map((s, i) =>
    `<option value="${i}" ${i === seasonIdx ? "selected" : ""}>${esc(s.title)}</option>`).join("");

  const eps = series.seasons[seasonIdx]?.episodes || [];
  const box = $("#episodeList");
  box.innerHTML = "";

  eps.forEach(ep => {
    const p = getProgress(epKey(series, ep));
    const pct = p ? Math.min(100, (p.t / p.d) * 100) : 0;
    const b = document.createElement("button");
    b.className = "ep" + (episode && ep.n === episode.n && ep.seasonIdx === episode.seasonIdx ? " playing" : "");
    b.innerHTML =
      `<div class="ep-thumb">
         ${ep.thumb ? `<img src="${esc(ep.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : `E${ep.n}`}
         ${pct ? `<span class="ep-progress" style="width:${pct}%"></span>` : ""}
       </div>
       <div style="min-width:0">
         <div class="ep-title">${ep.n}. ${esc(ep.title || "Episode " + ep.n)}</div>
         <div class="ep-meta">${[hhmm(ep.duration), p ? `${Math.round(pct)}% watched` : ""].filter(Boolean).join(" · ")}</div>
       </div>`;
    b.onclick = () => playEpisode(series, ep);
    box.appendChild(b);
  });

  $("#prevEp").disabled = !neighbourEpisode(-1);
  $("#nextEp").disabled = !neighbourEpisode(1);
}

function neighbourEpisode(step) {
  const { series, seasonIdx, episode } = state.current;
  if (!series || !episode) return null;
  const flat = series.seasons.flatMap(s => s.episodes);
  const i = flat.findIndex(e => e.n === episode.n && e.seasonIdx === seasonIdx);
  return i < 0 ? null : flat[i + step] || null;
}

function renderTrackInfo(pb) {
  const chips = [];
  chips.push(`<span class="chip">Source <b>${state.source.name === "jellyfin" ? "Jellyfin (HLS)" : "Direct file"}</b></span>`);
  chips.push(`<span class="chip">Audio tracks <b>${pb.audio.length}</b></span>`);
  chips.push(`<span class="chip">Subtitles <b>${pb.subtitles.length || "none"}</b></span>`);

  if (state.source.name === "direct") {
    const embeddedOnly = pb.audio.length > 1 && pb.audio.every(a => a.embedded);
    if (embeddedOnly) {
      chips.push(`<span class="chip warn">Embedded audio tracks cannot be switched in direct mode</span>`);
    }
    if (!pb.subtitles.length) {
      chips.push(`<span class="chip warn">Subtitles inside the MKV are invisible to the browser — add sidecar files</span>`);
    }
  }
  $("#trackInfo").innerHTML = chips.join("");
}

/* =====================================================================
   CONTINUE WATCHING
   ===================================================================== */
function renderContinue() {
  const all = progressAll();
  const rows = [];
  state.series.forEach(s => (s.seasons || []).forEach(season => season.episodes.forEach(ep => {
    const p = all[epKey(s, ep)];
    if (p) rows.push({ s, ep, p });
  })));
  rows.sort((a, b) => b.p.at - a.p.at);

  const grid = $("#grid");
  grid.innerHTML = "";
  $("#browseEmpty").classList.toggle("hidden", rows.length > 0);
  if (!rows.length) { $("#browseEmptyMsg").textContent = "Start an episode and it will show up here."; return; }

  rows.forEach(({ s, ep, p }) => {
    const pct = Math.min(100, (p.t / p.d) * 100);
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML =
      `<div class="card-art" style="aspect-ratio:16/9;background:${coverGradient(s.title)}">
         ${ep.thumb ? `<img src="${esc(ep.thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
         <span class="ep-progress" style="width:${pct}%;height:4px"></span>
       </div>
       <div class="card-title">${esc(s.title)}</div>
       <div class="card-sub">E${ep.n} · ${clock(p.t)} of ${clock(p.d)}</div>`;
    el.onclick = () => playEpisode(s, ep);
    grid.appendChild(el);
  });
}

/* =====================================================================
   SIDEBAR / EVENTS
   ===================================================================== */
const openSidebar  = () => { $("#sidebar").classList.remove("-translate-x-full"); $("#scrim").classList.remove("hidden"); };
const closeSidebar = () => { $("#sidebar").classList.add("-translate-x-full"); $("#scrim").classList.add("hidden"); };

function wire() {
  $("#sidebarOpen").onclick = openSidebar;
  $("#sidebarClose").onclick = closeSidebar;
  $("#scrim").onclick = closeSidebar;

  $("#search").oninput = e => {
    $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === "browse"));
    showView("browse");
    renderGrid(e.target.value);
  };

  $$(".nav-item").forEach(n => n.onclick = () => {
    $$(".nav-item").forEach(x => x.classList.toggle("active", x === n));
    showView("browse");
    n.dataset.view === "continue" ? renderContinue() : renderGrid($("#search").value);
    closeSidebar();
  });

  $("#seasonSelect").onchange = e => {
    state.current.seasonIdx = Number(e.target.value);
    renderEpisodes();
  };

  $("#prevEp").onclick = () => { const e = neighbourEpisode(-1); if (e) playEpisode(state.current.series, e); };
  $("#nextEp").onclick = () => { const e = neighbourEpisode(1);  if (e) playEpisode(state.current.series, e); };

  // keyboard shortcuts, skipped while typing in a field
  document.addEventListener("keydown", e => {
    if (!state.art || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const a = state.art;
    const k = e.key.toLowerCase();
    if (k === " " || k === "k") { e.preventDefault(); a.toggle(); }
    if (k === "arrowright") { e.preventDefault(); a.currentTime = Math.min(a.duration, a.currentTime + 10); }
    if (k === "arrowleft")  { e.preventDefault(); a.currentTime = Math.max(0, a.currentTime - 10); }
    if (k === "arrowup")    { e.preventDefault(); a.volume = Math.min(1, a.volume + 0.1); }
    if (k === "arrowdown")  { e.preventDefault(); a.volume = Math.max(0, a.volume - 0.1); }
    if (k === "f") a.fullscreen = !a.fullscreen;
    if (k === "n") { const n = neighbourEpisode(1); if (n) playEpisode(state.current.series, n); }
  });

  // Jellyfin sign-in
  $("#loginBtn").onclick = () => $("#loginModal").classList.replace("hidden", "flex");
  $("#loginCancel").onclick = () => $("#loginModal").classList.replace("flex", "hidden");
  $("#loginGo").onclick = doLogin;
  $("#jfPass").onkeydown = e => { if (e.key === "Enter") doLogin(); };
}

async function doLogin() {
  const err = $("#loginErr");
  err.classList.add("hidden");
  const btn = $("#loginGo");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const auth = await JellyfinSource.login($("#jfUser").value.trim(), $("#jfPass").value);
    $("#loginModal").classList.replace("flex", "hidden");
    $("#loginBtn").classList.add("hidden");
    const chip = $("#userChip");
    chip.classList.remove("hidden"); chip.classList.add("flex");
    chip.textContent = auth.name;
    await loadLibrary();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "Sign in";
  }
}

async function loadLibrary() {
  try {
    state.series = await state.source.library();
  } catch (e) {
    state.series = [];
    toast(e.message || "Could not load the library.");
  }
  renderSeriesList();
  renderGrid();
}

/* =====================================================================
   BOOT
   ===================================================================== */
async function boot() {
  $("#siteTitle").textContent = CFG.site?.title || "Anime Portal";
  document.title = CFG.site?.title || "Anime Portal";
  if (CFG.site?.accent) document.documentElement.style.setProperty("--accent", CFG.site.accent);

  state.source = CFG.source === "jellyfin" ? JellyfinSource : DirectSource;

  $("#sourceBadge").innerHTML = state.source.name === "jellyfin"
    ? `Jellyfin · full track switching`
    : `Direct file · <span style="color:#fda4af">no embedded track switching</span>`;

  if (state.source.name === "jellyfin") {
    const auth = JellyfinSource.loadAuth();
    if (auth?.userId) {
      const chip = $("#userChip");
      chip.classList.remove("hidden"); chip.classList.add("flex");
      chip.textContent = auth.name;
    } else {
      $("#loginBtn").classList.remove("hidden");
    }
  }

  wire();
  await loadLibrary();
}

boot();
})();