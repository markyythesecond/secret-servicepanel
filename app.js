(function(){
"use strict";

/* ======================================================================
   CONFIG
   apiBase must point at the deployed worker for uploads to be shared and
   for admin moderation to mean anything. Left null, the site runs in a
   single-browser preview mode with no real admin.
   ====================================================================== */
const CONFIG = { apiBase: null };  // <-- put your worker URL here

/* ======================================================================
   DATA LAYER
   Two backends, one interface. LocalData keeps everything in this browser.
   ApiData talks to the worker, which is the only place deletes can be
   authorised. Admin mode is real only on ApiData.
   ====================================================================== */

const OWNER_KEY = "pb:owners";     // pinId -> ownerToken, proves we uploaded it
const ADMIN_KEY = "pb:admin";      // { token, expires }

function ownerTokens(){ try { return JSON.parse(localStorage.getItem(OWNER_KEY)) || {}; } catch(e){ return {}; } }
function rememberOwner(id, token){
  const m = ownerTokens(); m[id] = token;
  try { localStorage.setItem(OWNER_KEY, JSON.stringify(m)); } catch(e){}
}
function forgetOwner(id){
  const m = ownerTokens(); delete m[id];
  try { localStorage.setItem(OWNER_KEY, JSON.stringify(m)); } catch(e){}
}
function adminSession(){
  try {
    const a = JSON.parse(localStorage.getItem(ADMIN_KEY));
    return (a && a.expires > Date.now()) ? a : null;
  } catch(e){ return null; }
}

const LocalData = {
  name: "local",
  canAdmin: false,
  _read(k, f){ try { const v = localStorage.getItem("pb:"+k); return v ? JSON.parse(v) : f; } catch(e){ return f; } },
  _write(k, v){
    try { localStorage.setItem("pb:"+k, JSON.stringify(v)); }
    catch(e){ throw new Error("This browser's storage is full. Delete a pin to free up room."); }
  },
  async listPins(){ return this._read("index", []); },
  async image(id){ return localStorage.getItem("pb:img:"+id) || ""; },
  async createPin(p, image){
    const pin = { ...p, id: uid(), likes:0, comments:0, at: Date.now() };
    try { localStorage.setItem("pb:img:"+pin.id, image); }
    catch(e){ throw new Error("This browser's storage is full. Delete a pin to free up room."); }
    this._write("index", [pin, ...this._read("index", [])]);
    rememberOwner(pin.id, "local");
    return pin;
  },
  async deletePin(id){
    this._write("index", this._read("index", []).filter(p => p.id !== id));
    localStorage.removeItem("pb:img:"+id);
    localStorage.removeItem("pb:cmt:"+id);
    forgetOwner(id);
  },
  async like(id, undo){
    let likes = 0;
    this._write("index", this._read("index", []).map(p => {
      if (p.id !== id) return p;
      likes = Math.max(0, (p.likes||0) + (undo ? -1 : 1));
      return { ...p, likes };
    }));
    return likes;
  },
  async comments(id){ return this._read("cmt:"+id, []); },
  async addComment(id, name, text){
    const list = this._read("cmt:"+id, []);
    const c = { id: uid(), name, text, at: Date.now() };
    list.push(c);
    this._write("cmt:"+id, list);
    this._write("index", this._read("index", []).map(p => p.id === id ? { ...p, comments:list.length } : p));
    return c;
  },
  async deleteComment(id, cid){
    const list = this._read("cmt:"+id, []).filter(c => c.id !== cid);
    this._write("cmt:"+id, list);
    this._write("index", this._read("index", []).map(p => p.id === id ? { ...p, comments:list.length } : p));
  },
  async adminLogin(){ throw new Error("Admin needs the server. Set CONFIG.apiBase first."); },
  canDelete(pin){ return !!ownerTokens()[pin.id]; }
};

const ApiData = {
  name: "api",
  canAdmin: true,
  async _call(path, opts = {}){
    const headers = { ...(opts.headers || {}) };
    if (opts.body) headers["Content-Type"] = "application/json";
    const a = adminSession();
    if (a) headers["Authorization"] = "Bearer " + a.token;
    const r = await fetch(CONFIG.apiBase + path, { ...opts, headers });
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch(e){}
    if (!r.ok) throw new Error(data.error || "Request failed (" + r.status + ")");
    return data;
  },
  async listPins(){ return (await this._call("/pins")).pins || []; },
  async image(id){ return CONFIG.apiBase + "/images/" + id; },
  async createPin(p, image){
    const r = await this._call("/pins", {
      method:"POST",
      body: JSON.stringify({ ...p, image })
    });
    if (r.ownerToken) rememberOwner(r.pin.id, r.ownerToken);
    return r.pin;
  },
  async deletePin(id){
    const t = ownerTokens()[id];
    await this._call("/pins/"+id, { method:"DELETE", headers: t ? { "X-Owner-Token": t } : {} });
    forgetOwner(id);
  },
  async like(id, undo){
    return (await this._call("/pins/"+id+"/like", { method:"POST", body: JSON.stringify({ undo }) })).likes;
  },
  async comments(id){ return (await this._call("/pins/"+id+"/comments")).comments || []; },
  async addComment(id, name, text){
    return (await this._call("/pins/"+id+"/comments", { method:"POST", body: JSON.stringify({ name, text }) })).comment;
  },
  async deleteComment(id, cid){
    await this._call("/pins/"+id+"/comments/"+cid, { method:"DELETE" });
  },
  async adminLogin(password){
    const r = await fetch(CONFIG.apiBase + "/auth/admin", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ password })
    });
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.error || "Could not log in.");
    localStorage.setItem(ADMIN_KEY, JSON.stringify({ token:d.token, expires:d.expires }));
    return true;
  },
  canDelete(pin){ return state.admin || !!ownerTokens()[pin.id]; }
};

const Data = CONFIG.apiBase ? ApiData : LocalData;

const CATEGORIES = [
  { id:"all",      label:"All ideas" },
  { id:"recipes",  label:"Recipes" },
  { id:"home",     label:"Home ideas" },
  { id:"fashion",  label:"Fashion" },
  { id:"creative", label:"Creative projects" },
  { id:"saved",    label:"Saved" },
  { id:"mine",     label:"My uploads" }
];

const CYCLE_WORDS = [
  { word:"dinner ideas", cat:"recipes"  },
  { word:"home ideas",   cat:"home"     },
  { word:"outfit ideas", cat:"fashion"  },
  { word:"craft ideas",  cat:"creative" }
];

/* ======================================================================
   STATE
   ====================================================================== */
const state = {
  pins: [],
  blobs: {},           // id -> data url, for uploaded pins
  commentCache: {},    // id -> array
  admin: false,
  profile: null,
  social: { likes:[], saves:[] },
  filter: "all",
  query: "",
  openPin: null,
  pending: null,       // staged upload
  authMode: "login"
};

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const AV_COLORS = ["#e60023","#f08196","#211922","#6b5a69","#b8474d","#4f6b5e","#8a6a3f"];
function avatarColor(name){
  let h = 0;
  for (let i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function initial(name){ return (name||"?").trim().charAt(0).toUpperCase() || "?"; }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function slug(s){ return (s||"pin").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60) || "pin"; }
function ago(ts){
  const d = Math.floor((Date.now()-ts)/1000);
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d/60)+"m ago";
  if (d < 86400) return Math.floor(d/3600)+"h ago";
  if (d < 604800) return Math.floor(d/86400)+"d ago";
  return new Date(ts).toLocaleDateString(undefined,{month:"short",day:"numeric"});
}
function srcOf(p){ return state.blobs[p.id] || ""; }

let toastTimer;
function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 2600);
}

/* ======================================================================
   PERSISTENCE
   ====================================================================== */
const PROFILE_KEY = "pb:profile";
const SOCIAL_KEY  = "pb:social";

function loadLocal(key, fallback){
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch(e){ return fallback; }
}
function storeLocal(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); } catch(e){}
}
const saveSocial = () => storeLocal(SOCIAL_KEY, state.social);

async function loadImages(){
  await Promise.all(state.pins.map(async p => {
    if (state.blobs[p.id]) return;
    try { state.blobs[p.id] = await Data.image(p.id); } catch(e){ state.blobs[p.id] = ""; }
  }));
}

async function refresh(){
  state.pins = await Data.listPins();
  await loadImages();
  renderChips(); render();
}

async function boot(){
  state.profile = loadLocal(PROFILE_KEY, null);
  state.social  = loadLocal(SOCIAL_KEY, { likes:[], saves:[] });
  state.social.likes = state.social.likes || [];
  state.social.saves = state.social.saves || [];
  state.admin = Data.canAdmin && !!adminSession();

  paintProfile(); paintAdmin();
  renderChips(); render();

  try { await refresh(); }
  catch(e){ toast("Could not load pins. " + e.message); }
}

/* ======================================================================
   MASONRY
   ====================================================================== */
function visiblePins(){
  const q = state.query.trim().toLowerCase();
  return state.pins.filter(p => {
    if (state.filter === "mine"  && !ownerTokens()[p.id]) return false;
    if (state.filter === "saved" && !state.social.saves.includes(p.id)) return false;
    if (!["all","mine","saved"].includes(state.filter) && p.cat !== state.filter) return false;
    if (!q) return true;
    return (p.title+" "+p.desc+" "+p.by+" "+p.cat).toLowerCase().includes(q);
  });
}

function columnCount(w){
  if (w < 540)  return 2;
  if (w < 860)  return 3;
  if (w < 1180) return 4;
  if (w < 1520) return 5;
  return 6;
}

function render(){
  const grid = $("#grid");
  const pins = visiblePins();
  grid.innerHTML = "";

  if (!pins.length){ grid.appendChild(emptyState()); return; }

  const cols = columnCount(grid.clientWidth || window.innerWidth);
  const heights = new Array(cols).fill(0);
  const colEls = [];
  for (let i=0;i<cols;i++){
    const d = document.createElement("div");
    d.className = "col";
    grid.appendChild(d);
    colEls.push(d);
  }
  pins.forEach(p => {
    let k = 0;
    for (let i=1;i<cols;i++) if (heights[i] < heights[k]) k = i;
    colEls[k].appendChild(card(p));
    heights[k] += (p.h / p.w) + 0.22; // image ratio plus the meta block
  });
}

function emptyState(){
  const d = document.createElement("div");
  d.className = "empty";
  const searching = state.query.trim();
  const heading = searching ? "Nothing matches “"+esc(searching)+"”"
                : state.filter === "mine"  ? "You have not uploaded anything yet"
                : state.filter === "saved" ? "No saved pins yet"
                : "This board is empty";
  const body = searching ? "Try a shorter word, or a different board."
             : state.filter === "saved" ? "Hover any pin and press Save to keep it here."
             : "Upload an image and it shows up in the feed straight away.";
  d.innerHTML = "<h3>"+heading+"</h3><p>"+body+"</p>";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Create a pin";
  btn.onclick = openUpload;
  d.appendChild(btn);
  return d;
}

function card(p){
  const liked = state.social.likes.includes(p.id);
  const saved = state.social.saves.includes(p.id);
  const el = document.createElement("article");
  el.className = "pin";

  el.innerHTML =
    '<div class="pin-media" style="aspect-ratio:'+p.w+'/'+p.h+'">'+
      '<img alt="'+esc(p.title)+'" loading="lazy">'+
      '<div class="pin-overlay">'+
        '<div class="pin-overlay-top">'+
          '<button class="save-btn'+(saved?" saved":"")+'" data-act="save">'+(saved?"Saved":"Save")+'</button>'+
        '</div>'+
        '<div class="pin-overlay-bottom">'+
          '<button class="round-btn'+(liked?" liked":"")+'" data-act="like" aria-label="Like">'+
            '<svg width="19" height="19" viewBox="0 0 24 24" fill="'+(liked?"currentColor":"none")+'" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M12 20.2S3.8 15.3 3.8 9.6A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.2 2.7c0 5.7-8.2 10.6-8.2 10.6z"/></svg>'+
          '</button>'+
          '<button class="round-btn" data-act="download" aria-label="Download">'+
            '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5M4.5 19.5h15"/></svg>'+
          '</button>'+
        '</div>'+
        '<span class="pin-badge">'+esc((CATEGORIES.find(c=>c.id===p.cat)||{label:"Idea"}).label)+'</span>'+
      '</div>'+
    '</div>'+
    '<div class="pin-meta">'+
      '<div class="pin-title">'+esc(p.title)+'</div>'+
      '<div class="pin-by">'+
        '<span class="avatar" style="background:'+avatarColor(p.by)+'">'+esc(initial(p.by))+'</span>'+
        '<span>'+esc(p.by)+'</span>'+
        '<span class="pin-stats"><span>'+(p.likes||0)+' likes</span></span>'+
      '</div>'+
    '</div>';

  const img = el.querySelector("img");
  const src = srcOf(p);
  if (src){
    img.src = src;
    if (img.complete) img.classList.add("loaded");
    img.addEventListener("load", ()=>img.classList.add("loaded"));
    img.addEventListener("error", ()=>{
      img.remove();
      el.querySelector(".pin-media").style.background =
        "linear-gradient(135deg,"+avatarColor(p.title)+"22,"+avatarColor(p.by)+"33)";
    });
  }

  el.addEventListener("click", e => {
    const btn = e.target.closest("[data-act]");
    if (!btn) { openDetail(p.id); return; }
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === "save")     toggleSave(p.id);
    if (act === "like")     toggleLike(p.id);
    if (act === "download") downloadPin(p);
  });

  return el;
}

/* ======================================================================
   SAVE / LIKE / DOWNLOAD
   ====================================================================== */
function toggleSave(id){
  const i = state.social.saves.indexOf(id);
  if (i > -1){ state.social.saves.splice(i,1); toast("Removed from your saved pins"); }
  else { state.social.saves.push(id); toast("Saved"); }
  saveSocial();
  renderChips(); render();
  if (state.openPin === id) paintDetail();
}

async function toggleLike(id){
  const p = state.pins.find(x=>x.id===id);
  if (!p) return;
  const i = state.social.likes.indexOf(id);
  const undo = i > -1;
  if (undo) state.social.likes.splice(i,1); else state.social.likes.push(id);
  p.likes = Math.max(0, (p.likes||0) + (undo ? -1 : 1));   // optimistic
  saveSocial(); render();
  if (state.openPin === id) paintDetail();
  try {
    const likes = await Data.like(id, undo);
    if (typeof likes === "number"){ p.likes = likes; render(); if (state.openPin === id) paintDetail(); }
  } catch(e){ /* count re-syncs on the next load */ }
}

async function downloadPin(p){
  const src = srcOf(p);
  if (!src) return toast("That image is not available");
  toast("Preparing download…");
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = slug(p.title) + (blob.type.includes("png") ? ".png" : ".jpg");
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
    toast("Downloaded");
  } catch(e){
    window.open(src, "_blank", "noopener");
    toast("Opened the image in a new tab");
  }
}

/* ======================================================================
   DETAIL + COMMENTS
   ====================================================================== */
async function openDetail(id){
  state.openPin = id;
  await paintDetail();
  openScrim("#detailScrim");
  $("#dInput").value = "";
}

async function paintDetail(){
  const p = state.pins.find(x=>x.id===state.openPin);
  if (!p) return;
  const liked = state.social.likes.includes(p.id);
  const saved = state.social.saves.includes(p.id);

  $("#dImg").src = srcOf(p);
  $("#dImg").alt = p.title;
  $("#dTitle").textContent = p.title;
  $("#dDesc").textContent = p.desc || "";
  $("#dDesc").style.display = p.desc ? "" : "none";
  $("#dAuthor").textContent = p.by;
  $("#dAvatar").textContent = initial(p.by);
  $("#dAvatar").style.background = avatarColor(p.by);
  $("#dSub").textContent = (p.likes||0) + " likes · " +
    (CATEGORIES.find(c=>c.id===p.cat)||{label:"Ideas"}).label;

  const sv = $("#dSave");
  sv.textContent = saved ? "Saved" : "Save";
  sv.className = "btn btn-sm " + (saved ? "btn-secondary" : "btn-primary");

  const lk = $("#dLike");
  lk.querySelector("svg").setAttribute("fill", liked ? "#e60023" : "none");
  lk.querySelector("svg").setAttribute("stroke", liked ? "#e60023" : "currentColor");

  const canDel = Data.canDelete(p);
  $("#dDelete").style.display = canDel ? "" : "none";
  $("#dDelete").title = state.admin && !ownerTokens()[p.id] ? "Delete as admin" : "Delete this pin";

  const me = state.profile;
  $("#dMeAvatar").textContent = initial(me ? me.name : "?");
  $("#dMeAvatar").style.background = me ? avatarColor(me.name) : "#c9c9c2";

  await paintComments(p.id);
}

async function loadComments(id){
  if (state.commentCache[id]) return state.commentCache[id];
  const list = await Data.comments(id);
  state.commentCache[id] = list;
  return list;
}

async function paintComments(id){
  const box = $("#dComments");
  box.innerHTML = '<h3>Comments</h3><p class="no-comments">Loading…</p>';
  const list = await loadComments(id);
  if (state.openPin !== id) return;

  let html = '<h3>Comments' + (list.length ? " · " + list.length : "") + '</h3>';
  if (!list.length){
    html += '<p class="no-comments">No comments yet. Say what you would change, or what worked.</p>';
  } else {
    html += list.map(c =>
      '<div class="comment">'+
        '<span class="avatar" style="background:'+avatarColor(c.name)+';width:32px;height:32px;font-size:13px;flex:none">'+esc(initial(c.name))+'</span>'+
        '<div class="body">'+
          '<div><span class="who">'+esc(c.name)+'</span><span class="when">'+ago(c.at)+'</span></div>'+
          '<div class="text">'+esc(c.text)+'</div>'+
        '</div>'+
        (state.admin ? '<button class="cmt-del" data-cid="'+esc(c.id)+'" aria-label="Delete comment" title="Delete comment">'+
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : '')+
      '</div>').join("");
  }
  box.innerHTML = html;
  box.querySelectorAll(".cmt-del").forEach(b =>
    b.addEventListener("click", () => removeComment(id, b.dataset.cid)));
}

async function postComment(){
  const p = state.pins.find(x=>x.id===state.openPin);
  const input = $("#dInput");
  const text = input.value.trim();
  if (!p || !text) return;

  if (!state.profile){
    closeScrim("#detailScrim");
    openAuth("signup", "Add a name so people know who commented.");
    return;
  }

  input.value = "";
  input.style.height = "auto";
  try {
    const c = await Data.addComment(p.id, state.profile.name, text);
    const list = await loadComments(p.id);
    list.push(c);
    state.commentCache[p.id] = list;
    p.comments = list.length;
    await paintComments(p.id);
    $("#dComments").scrollTop = $("#dComments").scrollHeight;
  } catch(e){
    input.value = text;
    toast(e.message || "Could not post that comment.");
  }
}

async function deletePin(){
  const p = state.pins.find(x=>x.id===state.openPin);
  if (!p || !Data.canDelete(p)) return;
  const who = state.admin && !ownerTokens()[p.id] ? " as an admin" : "";
  if (!confirm("Delete “"+p.title+"”"+who+"? This cannot be undone.")) return;

  try { await Data.deletePin(p.id); }
  catch(e){ return toast(e.message || "Could not delete that pin."); }

  state.pins = state.pins.filter(x=>x.id!==p.id);
  state.social.saves = state.social.saves.filter(x=>x!==p.id);
  state.social.likes = state.social.likes.filter(x=>x!==p.id);
  delete state.blobs[p.id];
  delete state.commentCache[p.id];
  saveSocial();

  closeScrim("#detailScrim");
  renderChips(); render();
  toast("Pin deleted");
}

async function removeComment(pinId, cid){
  if (!state.admin) return;
  if (!confirm("Delete this comment?")) return;
  try { await Data.deleteComment(pinId, cid); }
  catch(e){ return toast(e.message || "Could not delete that comment."); }
  state.commentCache[pinId] = (state.commentCache[pinId]||[]).filter(c=>c.id!==cid);
  const p = state.pins.find(x=>x.id===pinId);
  if (p) p.comments = state.commentCache[pinId].length;
  await paintComments(pinId);
  toast("Comment deleted");
}

/* ======================================================================
   UPLOAD
   ====================================================================== */
function openUpload(){
  resetUpload();
  $("#storageNote").textContent = Data.name === "api"
    ? "Your pin goes live for everyone. Admins can remove anything that does not belong."
    : "Saved in this browser only. Nobody else sees it until the server is connected.";
  openScrim("#uploadScrim");
}

function resetUpload(){
  state.pending = null;
  $("#file").value = "";
  $("#preview").style.display = "none";
  $("#dropzone").style.display = "";
  $("#uTitle").value = "";
  $("#uDesc").value = "";
  $("#uCat").value = state.filter === "all" || state.filter === "mine" || state.filter === "saved"
    ? "recipes" : state.filter;
  $("#uTitleHint").textContent = "Give it a name people can search for.";
  $("#uTitleHint").className = "hint";
  syncPublish();
}

function syncPublish(){
  $("#uPublish").disabled = !(state.pending && $("#uTitle").value.trim());
}

function processImage(file){
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Choose an image file."));
    if (file.size > 12 * 1024 * 1024) return reject(new Error("That file is over 12 MB. Try a smaller one."));

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image we can read."));
      img.onload = () => {
        const tight = Data.name === "local";      // localStorage is only ~5MB total
        const MAX = tight ? 1100 : 1400;
        const BUDGET = tight ? 700_000 : 4_200_000;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);        // flatten transparency so JPEG does not go black
        ctx.drawImage(img, 0, 0, w, h);

        let q = tight ? 0.78 : 0.82, url = c.toDataURL("image/jpeg", q);
        while (url.length > BUDGET && q > 0.38){ q -= 0.1; url = c.toDataURL("image/jpeg", q); }
        if (url.length > BUDGET * 1.5) return reject(new Error("That image is too large to store. Try a smaller one."));

        resolve({ dataUrl:url, w, h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function stageFile(file){
  if (!file) return;
  try {
    const out = await processImage(file);
    state.pending = out;
    $("#previewImg").src = out.dataUrl;
    $("#preview").style.display = "";
    $("#dropzone").style.display = "none";
    if (!$("#uTitle").value) $("#uTitle").focus();
    syncPublish();
  } catch(e){
    toast(e.message);
  }
}

async function publish(){
  if (!state.pending) return;
  const title = $("#uTitle").value.trim();
  if (!title){
    $("#uTitleHint").textContent = "A pin needs a title before it can be published.";
    $("#uTitleHint").className = "hint error";
    $("#uTitle").focus();
    return;
  }
  if (!state.profile){
    closeScrim("#uploadScrim");
    openAuth("signup", "Add a name so your pin has an author.");
    return;
  }

  const btn = $("#uPublish");
  btn.disabled = true; btn.textContent = "Publishing…";

  const draft = {
    w: state.pending.w,
    h: state.pending.h,
    cat: $("#uCat").value,
    title,
    desc: $("#uDesc").value.trim(),
    by: state.profile.name
  };

  try {
    const pin = await Data.createPin(draft, state.pending.dataUrl);
    state.blobs[pin.id] = Data.name === "local" ? state.pending.dataUrl : await Data.image(pin.id);
    state.pins.unshift(pin);

    closeScrim("#uploadScrim");
    state.filter = "all"; state.query = ""; $("#search").value = "";
    $("#searchWrap").classList.remove("filled");
    renderChips(); render();
    window.scrollTo({ top:0, behavior:"smooth" });
    toast("Published to " + (CATEGORIES.find(c=>c.id===pin.cat)||{label:"your board"}).label);
  } catch(e){
    console.error(e);
    toast(e.message || "Could not save that pin. Try again.");
  } finally {
    btn.textContent = "Publish";
    syncPublish();
  }
}

/* ======================================================================
   PROFILE
   ====================================================================== */
function paintProfile(){
  const me = state.profile;
  $("#loginBtn").style.display  = me ? "none" : "";
  $("#signupBtn").style.display = me ? "none" : "";
  $("#profileChip").classList.toggle("on", !!me);
  if (me){
    $("#profileAvatar").textContent = initial(me.name);
    $("#profileAvatar").style.background = avatarColor(me.name);
    $("#profileName").textContent = me.name;
  }
}

function openAuth(mode, message){
  state.authMode = mode;
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === mode));
  $("#authTitle").textContent = mode === "login" ? "Log in" : "Sign up";
  $("#aSubmit").textContent = mode === "login" ? "Log in" : "Create account";
  $("#emailField").style.display = mode === "signup" ? "" : "none";
  $("#aLogout").style.display = state.profile ? "" : "none";
  $("#aName").value = state.profile ? state.profile.name : "";
  $("#aNameHint").textContent = message || "This is the name shown on your pins and comments.";
  $("#aNameHint").className = message ? "hint error" : "hint";
  openScrim("#authScrim");
  setTimeout(()=>$("#aName").focus(), 120);
}

async function submitAuth(){
  const name = $("#aName").value.trim();
  if (!name){
    $("#aNameHint").textContent = "Enter a name to continue.";
    $("#aNameHint").className = "hint error";
    $("#aName").focus();
    return;
  }
  state.profile = { name, email: $("#aEmail").value.trim() || null, at: Date.now() };
  storeLocal(PROFILE_KEY, state.profile);
  paintProfile();
  closeScrim("#authScrim");
  toast("Signed in as " + name);
}

async function logout(){
  state.profile = null;
  try { localStorage.removeItem(PROFILE_KEY); } catch(e){}
  paintProfile();
  closeScrim("#authScrim");
  toast("Logged out");
}

/* ======================================================================
   ADMIN
   The password is checked by the worker, never here. All this code does
   is hold a signed session token and show the extra controls.
   ====================================================================== */
function paintAdmin(){
  $("#adminBar").style.display = state.admin ? "" : "none";
  if (state.admin){
    const a = adminSession();
    const mins = a ? Math.max(0, Math.round((a.expires - Date.now())/60000)) : 0;
    $("#adminUntil").textContent = mins > 90
      ? "Session ends in " + Math.round(mins/60) + "h"
      : "Session ends in " + mins + "m";
  }
}

function openAdmin(){
  if (!Data.canAdmin){
    return toast("Admin needs the server. Set CONFIG.apiBase in app.js first.");
  }
  $("#adminPass").value = "";
  $("#adminHint").textContent = "Ask the site owner if you do not have this.";
  $("#adminHint").className = "hint";
  openScrim("#adminScrim");
  setTimeout(()=>$("#adminPass").focus(), 120);
}

async function submitAdmin(){
  const pass = $("#adminPass").value;
  const btn = $("#adminSubmit");
  if (!pass) return;
  btn.disabled = true; btn.textContent = "Checking\u2026";
  try {
    await Data.adminLogin(pass);
    state.admin = true;
    paintAdmin();
    closeScrim("#adminScrim");
    render();
    toast("Admin mode on");
  } catch(e){
    $("#adminHint").textContent = e.message || "Could not log in.";
    $("#adminHint").className = "hint error";
    $("#adminPass").select();
  } finally {
    btn.disabled = false; btn.textContent = "Log in as admin";
  }
}

function adminLogout(){
  try { localStorage.removeItem(ADMIN_KEY); } catch(e){}
  state.admin = false;
  paintAdmin(); render();
  if (state.openPin) paintDetail();
  toast("Admin mode off");
}

/* ======================================================================
   CHIPS + SCRIMS
   ====================================================================== */
function renderChips(){
  const box = $("#chips");
  box.innerHTML = "";
  const hidden = id =>
    (id === "mine"  && !state.pins.some(p=>ownerTokens()[p.id])) ||
    (id === "saved" && !state.social.saves.length);
  if (hidden(state.filter)) state.filter = "all";
  CATEGORIES.forEach(c => {
    if (hidden(c.id)) return;
    const b = document.createElement("button");
    b.className = "chip" + (state.filter === c.id ? " active" : "");
    b.textContent = c.label;
    b.setAttribute("role","tab");
    b.setAttribute("aria-selected", state.filter === c.id);
    b.onclick = () => { state.filter = c.id; renderChips(); render(); };
    box.appendChild(b);
  });
}

let lastFocus = null;
function openScrim(sel){
  lastFocus = document.activeElement;
  $(sel).classList.add("open");
  document.body.classList.add("locked");
}
function closeScrim(sel){
  $(sel).classList.remove("open");
  if (!$$(".scrim.open").length) document.body.classList.remove("locked");
  if (sel === "#detailScrim") state.openPin = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
function closeAll(){ $$(".scrim.open").forEach(s => closeScrim("#"+s.id)); }

/* ======================================================================
   EVENTS
   ====================================================================== */
$("#markBtn").addEventListener("click", e => {
  e.preventDefault();
  state.filter = "all"; state.query = "";
  $("#search").value = ""; $("#searchWrap").classList.remove("filled");
  renderChips(); render();
  window.scrollTo({ top:0, behavior:"smooth" });
});

$$("[data-nav]").forEach(b => b.addEventListener("click", () => {
  const which = b.dataset.nav;
  if (which === "create") return openUpload();
  $$("[data-nav]").forEach(x => x.classList.toggle("active", x === b));
  if (which === "home"){ state.filter = "all"; }
  renderChips(); render();
  if (which === "explore") document.querySelector(".chips-wrap").scrollIntoView({ behavior:"smooth", block:"start" });
  else window.scrollTo({ top:0, behavior:"smooth" });
}));

let searchTimer;
$("#search").addEventListener("input", e => {
  $("#searchWrap").classList.toggle("filled", !!e.target.value);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = e.target.value; render(); }, 130);
});
$("#searchClear").addEventListener("click", () => {
  $("#search").value = ""; state.query = "";
  $("#searchWrap").classList.remove("filled");
  render(); $("#search").focus();
});

$("#createBtn").addEventListener("click", openUpload);
$("#createCta").addEventListener("click", openUpload);
$("#fab").addEventListener("click", openUpload);
$("#exploreCta").addEventListener("click", () => {
  document.querySelector(".chips-wrap").scrollIntoView({ behavior:"smooth", block:"start" });
});

$("#loginBtn").addEventListener("click", () => openAuth("login"));
$("#signupBtn").addEventListener("click", () => openAuth("signup"));
$("#profileChip").addEventListener("click", () => openAuth("login"));
$("#aSubmit").addEventListener("click", submitAuth);
$("#aLogout").addEventListener("click", logout);
$("#aClose").addEventListener("click", () => closeScrim("#authScrim"));
$$(".tab").forEach(t => t.addEventListener("click", () => openAuth(t.dataset.tab)));
$("#aName").addEventListener("keydown", e => { if (e.key === "Enter") submitAuth(); });

$("#adminLink").addEventListener("click", e => { e.preventDefault(); closeAll(); openAdmin(); });
$("#adminClose").addEventListener("click", () => closeScrim("#adminScrim"));
$("#adminSubmit").addEventListener("click", submitAdmin);
$("#adminPass").addEventListener("keydown", e => { if (e.key === "Enter") submitAdmin(); });
$("#adminExit").addEventListener("click", adminLogout);
$("#adminRefresh").addEventListener("click", async () => {
  toast("Reloading\u2026");
  try { await refresh(); toast("Up to date"); }
  catch(e){ toast(e.message || "Could not reload."); }
});
if (location.hash === "#admin") setTimeout(openAdmin, 400);

$("#uClose").addEventListener("click", () => closeScrim("#uploadScrim"));
$("#uCancel").addEventListener("click", () => closeScrim("#uploadScrim"));
$("#uPublish").addEventListener("click", publish);
$("#uTitle").addEventListener("input", () => {
  $("#uTitleHint").textContent = "Give it a name people can search for.";
  $("#uTitleHint").className = "hint";
  syncPublish();
});
$("#dropzone").addEventListener("click", () => $("#file").click());
$("#dropzone").addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " "){ e.preventDefault(); $("#file").click(); }
});
$("#swapBtn").addEventListener("click", () => $("#file").click());
$("#file").addEventListener("change", e => stageFile(e.target.files[0]));

["dragenter","dragover"].forEach(ev => $("#dropzone").addEventListener(ev, e => {
  e.preventDefault(); $("#dropzone").classList.add("hot");
}));
["dragleave","drop"].forEach(ev => $("#dropzone").addEventListener(ev, e => {
  e.preventDefault(); $("#dropzone").classList.remove("hot");
}));
$("#dropzone").addEventListener("drop", e => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) stageFile(f);
});
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => e.preventDefault());

$("#dClose").addEventListener("click", () => closeScrim("#detailScrim"));
$("#dSave").addEventListener("click", () => toggleSave(state.openPin));
$("#dLike").addEventListener("click", () => toggleLike(state.openPin));
$("#dDelete").addEventListener("click", deletePin);
$("#dDownload").addEventListener("click", () => {
  const p = state.pins.find(x=>x.id===state.openPin);
  if (p) downloadPin(p);
});
$("#dSend").addEventListener("click", postComment);
$("#dInput").addEventListener("input", e => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(120, e.target.scrollHeight) + "px";
});
$("#dInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); postComment(); }
});

$$(".scrim").forEach(s => s.addEventListener("mousedown", e => {
  if (e.target === s) closeScrim("#"+s.id);
}));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });

function syncPlaceholder(){
  $("#search").placeholder = window.innerWidth < 700
    ? "Search ideas" : "Search for recipes, home ideas, outfits\u2026";
}
syncPlaceholder();

let raf;
window.addEventListener("resize", () => {
  syncPlaceholder();
  cancelAnimationFrame(raf); raf = requestAnimationFrame(render);
});
window.addEventListener("scroll", () => {
  document.querySelector(".chips-wrap").classList.toggle("stuck", window.scrollY > 8);
}, { passive:true });

/* headline word cycle */
(function cycle(){
  const el = $("#cycle");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let i = 0;
  setInterval(() => {
    el.classList.add("out");
    setTimeout(() => {
      i = (i + 1) % CYCLE_WORDS.length;
      el.textContent = CYCLE_WORDS[i].word;
      el.style.color = i % 2 ? "var(--blush)" : "var(--red)";
      el.classList.remove("out");
    }, 320);
  }, 2800);
})();

boot();
})();
