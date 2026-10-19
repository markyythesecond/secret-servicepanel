/* =====================================================================
   app.js — video gallery.
   Finds every video in the repo's videos/ folder through the GitHub API,
   shows them as thumbnail cards, plays them in a pop-up player that closes
   itself when the video ends. You shouldn't need to edit this file;
   settings live in config.js.
   ===================================================================== */
(function () {
"use strict";

const CFG = Object.assign({
  title: "Video Archive", tagline: "", theme: "classified", sfx: true,
  github: { owner: "", repo: "", branch: "main", folder: "videos" }
}, window.SITE || {});
const GH = CFG.github;

const $ = s => document.querySelector(s);
const VIDEO_EXT = ["mp4", "webm", "mov", "m4v", "ogv"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif"];
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } }
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ext = p => (p.split(".").pop() || "").toLowerCase();
const stem = p => p.replace(/\.[^./]+$/, "");
const encPath = p => p.split("/").map(encodeURIComponent).join("/");
const clock = s => {
  if (!isFinite(s)) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
};
const prettify = name => name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

let toastT;
function toast(msg, ms = 2800) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms);
}

/* ============================ sound effects ============================ */
const SFX = (() => {
  let ctx, master, enabled = store.get("ssp:sfx", CFG.sfx);
  const wave = () => ({ classified: "triangle", neon: "sawtooth", crimson: "square", terminal: "square", daylight: "sine" }[document.documentElement.dataset.theme] || "triangle");

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(f, dur, { type, vol = 0.12, to, delay = 0 } = {}) {
    const c = ac(); if (!c || !enabled) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = type || wave();
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    lp.type = "lowpass"; lp.frequency.value = o.type === "sine" ? 8000 : 3200;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function whoosh(dur, from, to, vol = 0.16) {
    const c = ac(); if (!c || !enabled) return;
    const t = c.currentTime, len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; bp.type = "bandpass"; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(master); src.start(t);
  }
  let lastHover = 0;
  return {
    get on() { return enabled; },
    set on(v) { enabled = v; store.set("ssp:sfx", v); },
    unlock: ac,
    hover() { const n = performance.now(); if (n - lastHover < 60) return; lastHover = n; tone(1600, 0.045, { vol: 0.035, type: "sine" }); },
    click() { tone(520, 0.07, { vol: 0.09 }); tone(780, 0.09, { vol: 0.07, delay: 0.05 }); },
    open() { whoosh(0.45, 300, 3500); tone(220, 0.35, { to: 660, vol: 0.07 }); tone(880, 0.25, { vol: 0.05, delay: 0.3, type: "sine" }); },
    close() { whoosh(0.35, 3000, 250, 0.12); tone(600, 0.25, { to: 180, vol: 0.06 }); },
    end() { [784, 659, 523, 392].forEach((f, i) => tone(f, 0.28, { vol: 0.07, delay: i * 0.11, type: "sine" })); },
    theme() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, { vol: 0.07, delay: i * 0.06 })); },
    toggle() { tone(440, 0.06, { vol: 0.08 }); tone(880, 0.08, { vol: 0.06, delay: 0.06 }); },
    chip() { tone(1100, 0.06, { vol: 0.06, type: "sine" }); },
    error() { tone(160, 0.25, { vol: 0.1, type: "square" }); }
  };
})();

/* ============================ themes ============================ */
const THEMES = [
  { id: "classified", name: "Classified", sw: ["#070b14", "#d4af5f", "#7fa2d6"] },
  { id: "neon",       name: "Neon",       sw: ["#07040f", "#ff3fc8", "#2ef2ff"] },
  { id: "crimson",    name: "Crimson",    sw: ["#0c0506", "#e63946", "#f4a261"] },
  { id: "terminal",   name: "Terminal",   sw: ["#020803", "#39ff78", "#c6ff3a"] },
  { id: "daylight",   name: "Daylight",   sw: ["#f3f1ec", "#2b54d6", "#d4593a"] }
];
function applyTheme(id, fx) {
  if (!THEMES.some(t => t.id === id)) id = "classified";
  document.documentElement.dataset.theme = id;
  store.set("ssp:theme", id);
  document.querySelectorAll("#themes button").forEach(b => b.setAttribute("aria-checked", b.dataset.id === id));
  BG.recolor();
  if (fx) { flash(); SFX.theme(); }
}
function buildThemeMenu() {
  const m = $("#themes");
  m.innerHTML = THEMES.map(t =>
    `<button role="menuitemradio" data-id="${t.id}" aria-checked="false">
       <span class="sw">${t.sw.map(c => `<i style="background:${c}"></i>`).join("")}</span>${t.name}
     </button>`).join("");
  m.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    applyTheme(b.dataset.id, true); m.classList.remove("open");
  });
  $("#themeBtn").addEventListener("click", e => {
    e.stopPropagation(); SFX.click(); m.classList.toggle("open");
  });
  document.addEventListener("click", e => { if (!m.contains(e.target)) m.classList.remove("open"); });
}
function flash() {
  if (REDUCED) return;
  const f = $("#flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}

/* ============================ background particles ============================ */
const BG = (() => {
  const cv = $("#fx"), cx = cv.getContext("2d");
  let W, H, dpr, pts = [], rgb = "212,175,95", mouse = { x: -999, y: -999 };
  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr;
    const n = Math.min(90, Math.round(innerWidth * innerHeight / 18000));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .25 * dpr, vy: (Math.random() - .5) * .25 * dpr,
      r: (Math.random() * 1.4 + .4) * dpr
    }));
  }
  function frame() {
    cx.clearRect(0, 0, W, H);
    const link = 130 * dpr;
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      const dx = p.x - mouse.x, dy = p.y - mouse.y, dm = Math.hypot(dx, dy);
      if (dm < 140 * dpr) { p.x += dx / dm * .8; p.y += dy / dm * .8; }
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      cx.fillStyle = `rgba(${rgb},.55)`;
      cx.beginPath(); cx.arc(a.x, a.y, a.r, 0, 7); cx.fill();
      for (let j = i + 1; j < pts.length; j++) {
        const b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < link) {
          cx.strokeStyle = `rgba(${rgb},${(1 - d / link) * .18})`;
          cx.lineWidth = dpr * .8;
          cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
        }
      }
    }
    if (!document.hidden && !paused) requestAnimationFrame(frame);
  }
  let paused = false;
  addEventListener("resize", size);
  addEventListener("pointermove", e => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !paused) requestAnimationFrame(frame); });
  return {
    start() { size(); if (REDUCED) { paused = true; frame(); } else requestAnimationFrame(frame); },
    pause(v) { const was = paused; paused = v || REDUCED; if (was && !paused) requestAnimationFrame(frame); },
    recolor() { rgb = getComputedStyle(document.documentElement).getPropertyValue("--particle").trim() || rgb; }
  };
})();

/* ============================ loading the video list ============================ */
async function loadVideos() {
  const CACHE = "ssp:tree:" + GH.owner + "/" + GH.repo;
  const cached = store.get(CACHE, null);
  if (cached && Date.now() - cached.t < 60 * 1000) return cached.items;

  try {
    if (!GH.owner || !GH.repo) throw new Error("no repo set");
    const r = await fetch(`https://api.github.com/repos/${GH.owner}/${GH.repo}/git/trees/${encodeURIComponent(GH.branch)}?recursive=1`,
      { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("GitHub API " + r.status);
    const items = fromTree((await r.json()).tree || []);
    store.set(CACHE, { t: Date.now(), items });
    return items;
  } catch (err) {
    console.warn("[videos] GitHub API failed:", err);
    if (cached) return cached.items;            // stale cache beats nothing
    try {                                       // last resort: a hand-written videos.json
      const r = await fetch("videos.json", { cache: "no-store" });
      if (r.ok) return (await r.json()).map(v => typeof v === "string" ? { path: v } : v).map(normalize);
    } catch (e) { /* none */ }
    throw err;
  }
}
function fromTree(tree) {
  const root = GH.folder.replace(/^\/|\/$/g, "") + "/";
  const files = tree.filter(n => n.type === "blob" && n.path.startsWith(root));
  const images = new Map();
  files.forEach(f => { if (IMAGE_EXT.includes(ext(f.path))) images.set(stem(f.path).toLowerCase(), f.path); });
  return files
    .filter(f => VIDEO_EXT.includes(ext(f.path)))
    .map(f => normalize({ path: f.path, sha: f.sha, size: f.size, thumb: images.get(stem(f.path).toLowerCase()) }));
}
function normalize(v) {
  const root = GH.folder.replace(/^\/|\/$/g, "") + "/";
  const rel = v.path.startsWith(root) ? v.path.slice(root.length) : v.path;
  const parts = rel.split("/");
  const file = parts.pop();
  return {
    path: v.path,
    src: v.src || encPath(v.path),
    thumb: v.thumb ? (/^https?:/.test(v.thumb) ? v.thumb : encPath(v.thumb)) : "",
    title: v.title || prettify(stem(file)),
    category: v.category || parts.join(" / ") || "",
    sha: v.sha || v.path,
    size: v.size || 0
  };
}

/* ============================ auto thumbnails ============================ */
const Thumbs = (() => {
  const queue = [];
  let running = 0;
  const KEY = "ssp:thumb:";
  function grab(v) {
    return new Promise(resolve => {
      const vid = document.createElement("video");
      vid.muted = true; vid.preload = "metadata"; vid.playsInline = true; vid.crossOrigin = "anonymous";
      let done = false;
      const finish = res => { if (done) return; done = true; vid.removeAttribute("src"); vid.load(); resolve(res); };
      setTimeout(() => finish(null), 20000);
      vid.addEventListener("loadedmetadata", () => {
        const d = vid.duration;
        vid.currentTime = isFinite(d) && d > 0 ? Math.min(d * 0.15, 8) : 1;
      });
      vid.addEventListener("seeked", () => {
        try {
          const w = 480, h = Math.round(w * (vid.videoHeight / vid.videoWidth || 9 / 16));
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(vid, 0, 0, w, h);
          finish({ img: c.toDataURL("image/jpeg", 0.72), dur: vid.duration });
        } catch (e) { finish({ img: null, dur: vid.duration }); }
      });
      vid.addEventListener("error", () => finish(null));
      vid.src = v.src;
    });
  }
  function pump() {
    while (running < 2 && queue.length) {
      const { v, cb } = queue.shift();
      running++;
      grab(v).then(res => {
        running--;
        if (res) store.set(KEY + v.sha, res);
        cb(res); pump();
      });
    }
  }
  return {
    cached: v => store.get(KEY + v.sha, null),
    request(v, cb) { queue.push({ v, cb }); pump(); }
  };
})();

/* ============================ gallery ============================ */
const state = { all: [], filter: "", cat: "" };
const seen = new Set(store.get("ssp:seen", []));

function render() {
  const q = state.filter.trim().toLowerCase();
  const list = state.all.filter(v =>
    (!state.cat || v.category === state.cat) &&
    (!q || v.title.toLowerCase().includes(q) || v.category.toLowerCase().includes(q)));

  $("#count").textContent = `${list.length} file${list.length === 1 ? "" : "s"}`;
  $("#empty").hidden = state.all.length > 0;

  const grid = $("#grid");
  if (state.all.length && !list.length) {
    grid.innerHTML = `<p style="grid-column:1/-1;color:var(--dim);text-align:center;padding:40px 0">Nothing matches “${esc(state.filter)}”.</p>`;
    return;
  }
  grid.innerHTML = list.map((v, i) => `
    <button class="card${seen.has(v.path) ? " seen" : ""}" style="--i:${Math.min(i, 20)}" data-path="${esc(v.path)}" aria-label="Play ${esc(v.title)}">
      <div class="thumb">
        <div class="ph"><span>Loading</span></div>
        <img alt="" decoding="async">
        ${v.category ? `<span class="tag">${esc(v.category)}</span>` : ""}
        <span class="dur" hidden></span>
        <span class="play"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg></span>
      </div>
      <div class="meta">
        <h3 title="${esc(v.title)}">${esc(v.title)}</h3>
        <p>${v.size ? (v.size / 1048576).toFixed(1) + " MB" : ext(v.path).toUpperCase()}</p>
      </div>
    </button>`).join("");

  grid.querySelectorAll(".card").forEach(card => io.observe(card));
}

function byPath(p) { return state.all.find(v => v.path === p); }

const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    fillThumb(e.target, byPath(e.target.dataset.path));
  });
}, { rootMargin: "300px" });

function fillThumb(card, v) {
  if (!v) return;
  const img = card.querySelector("img"), ph = card.querySelector(".ph"), dur = card.querySelector(".dur");
  const show = (src, d) => {
    if (d && isFinite(d)) { dur.textContent = clock(d); dur.hidden = false; }
    if (!src) { ph.classList.add("done"); ph.querySelector("span").textContent = ext(v.path).toUpperCase(); return; }
    img.onload = () => { img.classList.add("ok"); ph.remove(); };
    img.onerror = () => { ph.classList.add("done"); ph.querySelector("span").textContent = "No preview"; };
    img.src = src;
  };
  const c = Thumbs.cached(v);
  if (v.thumb) {
    show(v.thumb, c && c.dur);
    if (!c) Thumbs.request({ ...v, sha: v.sha }, res => res && show(null, res.dur) ); // just for duration
    return;
  }
  if (c && c.img) return show(c.img, c.dur);
  Thumbs.request(v, res => show(res && res.img, res && res.dur));
}

function buildChips() {
  const cats = [...new Set(state.all.map(v => v.category).filter(Boolean))].sort();
  const box = $("#chips");
  if (!cats.length) { box.innerHTML = ""; return; }
  box.innerHTML = ["", ...cats].map(c =>
    `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === state.cat}">${c ? esc(c) : "All"}</button>`).join("");
}

/* ============================ card tilt ============================ */
function tilt(grid) {
  if (REDUCED) return;
  grid.addEventListener("pointermove", e => {
    const card = e.target.closest(".card"); if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty("--ry", (x - .5) * 10 + "deg");
    card.style.setProperty("--rx", (.5 - y) * 10 + "deg");
    card.style.setProperty("--mx", x * 100 + "%");
    card.style.setProperty("--my", y * 100 + "%");
  });
  grid.addEventListener("pointerout", e => {
    const card = e.target.closest(".card");
    if (card && !card.contains(e.relatedTarget)) { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); }
  });
}

/* ============================ player ============================ */
const P = { el: $("#player"), frame: $("#frame"), video: $("#video"), from: null, current: null, closing: false };

function openPlayer(v, fromEl) {
  SFX.unlock();
  P.current = v; P.from = fromEl || null; P.closing = false;
  $("#ptitle").textContent = v.title;
  $("#prog").style.width = "0";
  P.video.src = v.src;
  P.el.hidden = false;
  document.body.style.overflow = "hidden";
  BG.pause(true);
  requestAnimationFrame(() => P.el.classList.add("open"));
  SFX.open(); flash();

  if (!REDUCED) {
    const to = P.frame.getBoundingClientRect();
    let start = "translateY(40px) scale(.85)";
    if (P.from) {
      const r = P.from.getBoundingClientRect();
      start = `translate(${r.left + r.width / 2 - (to.left + to.width / 2)}px,${r.top + r.height / 2 - (to.top + to.height / 2)}px) scale(${r.width / to.width})`;
    }
    P.frame.animate(
      [{ transform: start, opacity: 0, filter: "blur(6px)" }, { transform: "none", opacity: 1, filter: "blur(0)" }],
      { duration: 480, easing: "cubic-bezier(.2,.9,.25,1.05)" });
  }
  const p = P.video.play();
  if (p && p.catch) p.catch(() => { /* autoplay blocked: controls are visible, user can press play */ });
  history.replaceState(null, "", "#" + encodeURIComponent(v.path));
}

function closePlayer(reason) {
  if (P.el.hidden || P.closing) return;
  P.closing = true;
  reason === "ended" ? SFX.end() : SFX.close();
  P.el.classList.remove("open");

  const done = () => {
    P.video.pause(); P.video.removeAttribute("src"); P.video.load();
    P.el.hidden = true; P.closing = false;
    document.body.style.overflow = "";
    BG.pause(false);
    history.replaceState(null, "", location.pathname + location.search);
    if (P.from && document.contains(P.from)) P.from.focus({ preventScroll: true });
  };
  if (REDUCED) return done();

  let end = "translateY(30px) scale(.9)";
  if (P.from && document.contains(P.from)) {
    const r = P.from.getBoundingClientRect(), to = P.frame.getBoundingClientRect();
    end = `translate(${r.left + r.width / 2 - (to.left + to.width / 2)}px,${r.top + r.height / 2 - (to.top + to.height / 2)}px) scale(${r.width / to.width})`;
  }
  P.frame.animate(
    [{ transform: "none", opacity: 1 }, { transform: end, opacity: 0, filter: "blur(4px)" }],
    { duration: 380, easing: "cubic-bezier(.5,0,.75,0)" }).onfinish = done;
}

function markSeen(v) {
  seen.add(v.path); store.set("ssp:seen", [...seen]);
  const card = document.querySelector(`.card[data-path="${CSS.escape(v.path)}"]`);
  if (card) card.classList.add("seen");
}

P.video.addEventListener("timeupdate", () => {
  const d = P.video.duration;
  if (d) $("#prog").style.width = (P.video.currentTime / d * 100) + "%";
});
P.video.addEventListener("ended", () => {
  if (P.current) markSeen(P.current);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  setTimeout(() => closePlayer("ended"), 250);
});
P.video.addEventListener("webkitendfullscreen", () => { if (P.video.ended) closePlayer("ended"); });
P.video.addEventListener("error", () => {
  if (P.el.hidden || !P.video.getAttribute("src")) return;
  SFX.error();
  toast("This video couldn't be played. Try converting it to .mp4 (H.264).", 4500);
});
$("#close").addEventListener("click", () => closePlayer());
$("#backdrop").addEventListener("click", () => closePlayer());
document.addEventListener("keydown", e => {
  if (P.el.hidden) {
    if (e.key === "/" && document.activeElement !== $("#search")) { e.preventDefault(); $("#search").focus(); }
    return;
  }
  if (e.key === "Escape") closePlayer();
  else if (e.key === " " && e.target !== P.video) { e.preventDefault(); P.video.paused ? P.video.play() : P.video.pause(); }
  else if (e.key === "f") { (P.video.requestFullscreen || P.video.webkitEnterFullscreen || (() => {})).call(P.video); }
});

/* ============================ wiring ============================ */
function init() {
  document.title = CFG.title;
  $("#siteTitle").textContent = CFG.title;
  $("#siteTitle").dataset.text = CFG.title;
  $("#tagline").textContent = CFG.tagline;

  buildThemeMenu();
  BG.start();
  applyTheme(store.get("ssp:theme", CFG.theme));

  const sfxBtn = $("#sfxBtn");
  sfxBtn.setAttribute("aria-pressed", SFX.on);
  sfxBtn.addEventListener("click", () => {
    SFX.on = !SFX.on; sfxBtn.setAttribute("aria-pressed", SFX.on);
    if (SFX.on) SFX.toggle();
    toast(SFX.on ? "Sound effects on" : "Sound effects off", 1400);
  });

  const grid = $("#grid");
  grid.addEventListener("click", e => {
    const card = e.target.closest(".card"); if (!card) return;
    const v = byPath(card.dataset.path); if (v) openPlayer(v, card);
  });
  grid.addEventListener("pointerover", e => {
    const card = e.target.closest(".card");
    if (card && !card.contains(e.relatedTarget)) SFX.hover();
  });
  tilt(grid);

  $("#chips").addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c) return;
    state.cat = c.dataset.cat; SFX.chip();
    document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === c));
    render();
  });

  let st;
  $("#search").addEventListener("input", e => {
    clearTimeout(st); st = setTimeout(() => { state.filter = e.target.value; render(); }, 120);
  });

  $("#shuffle").addEventListener("click", () => {
    const cards = [...grid.querySelectorAll(".card")];
    if (!cards.length) { SFX.error(); return toast("No videos to shuffle yet"); }
    const card = cards[Math.floor(Math.random() * cards.length)];
    card.scrollIntoView({ block: "center", behavior: REDUCED ? "auto" : "smooth" });
    setTimeout(() => openPlayer(byPath(card.dataset.path), card), REDUCED ? 0 : 350);
  });

  document.addEventListener("pointerover", e => {
    if (e.target.closest(".icon, .chip, .themes button") && !e.target.closest(".icon, .chip, .themes button").contains(e.relatedTarget)) SFX.hover();
  });

  $("#grid").innerHTML = Array.from({ length: 8 }, (_, i) =>
    `<div class="card" style="--i:${i}"><div class="thumb"><div class="ph"></div></div><div class="meta"><h3>&nbsp;</h3><p>&nbsp;</p></div></div>`).join("");

  loadVideos().then(items => {
    state.all = items.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title, undefined, { numeric: true }));
    buildChips();
    render();
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash) {
      const v = byPath(hash);
      if (v) openPlayer(v, document.querySelector(`.card[data-path="${CSS.escape(v.path)}"]`));
    }
  }).catch(err => {
    $("#grid").innerHTML = "";
    $("#empty").hidden = false;
    toast("Couldn't reach GitHub to list videos. Try again in a minute.", 5000);
    console.error(err);
  });
}

init();
})();
