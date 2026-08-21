(function(){
"use strict";

/* ======================================================================
   CONFIG
   Leave apiBase as null to keep everything in the built-in store.
   Set it to a deployed worker URL to use a GitHub repo as the database.
   ====================================================================== */
const CONFIG = { apiBase: null };

/* ======================================================================
   STORAGE ADAPTERS
   Every adapter exposes the same four async methods, so swapping the
   backend never touches the app code below.
   ====================================================================== */
const memoryStore = (() => {
  const m = new Map();
  return {
    name: "memory",
    async get(k){ return m.has(k) ? {key:k,value:m.get(k)} : null; },
    async set(k,v){ m.set(k,v); return {key:k,value:v}; },
    async del(k){ m.delete(k); return true; },
    async list(prefix){ return [...m.keys()].filter(k=>k.startsWith(prefix||"")); }
  };
})();

const claudeStore = {
  name: "claude",
  async get(k){ try { return await window.storage.get(k,false); } catch(e){ return null; } },
  async set(k,v){ return await window.storage.set(k,v,false); },
  async del(k){ try { return await window.storage.delete(k,false); } catch(e){ return false; } },
  async list(prefix){ try { const r = await window.storage.list(prefix,false); return (r&&r.keys)||[]; } catch(e){ return []; } }
};

const apiStore = {
  name: "github",
  async get(k){
    const r = await fetch(CONFIG.apiBase+"/kv/"+encodeURIComponent(k));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("read failed");
    return { key:k, value: await r.text() };
  },
  async set(k,v){
    const r = await fetch(CONFIG.apiBase+"/kv/"+encodeURIComponent(k),
      { method:"PUT", headers:{"Content-Type":"text/plain"}, body:v });
    if (!r.ok) throw new Error("write failed");
    return { key:k, value:v };
  },
  async del(k){
    const r = await fetch(CONFIG.apiBase+"/kv/"+encodeURIComponent(k),{method:"DELETE"});
    return r.ok;
  },
  async list(prefix){
    const r = await fetch(CONFIG.apiBase+"/kv?prefix="+encodeURIComponent(prefix||""));
    if (!r.ok) return [];
    return (await r.json()).keys || [];
  }
};

const store = CONFIG.apiBase ? apiStore
            : (typeof window !== "undefined" && window.storage) ? claudeStore
            : memoryStore;

const K_INDEX   = "pins:index";
const K_PROFILE = "profile:me";
const K_SOCIAL  = "social:me";
const blobKey   = id => "pinblob:" + id;
const cmtKey    = id => "comments:" + id;
const SEED_VERSION = 1;

/* ======================================================================
   SEED CONTENT
   ====================================================================== */
const PHOTO = "https://images.unsplash.com/photo-";
function shot(id, ar){
  const w = 640, h = Math.round(640 / ar);
  return { src: PHOTO+id+"?auto=format&fit=crop&w="+w+"&h="+h+"&q=80", w, h };
}
function S(id, ar, cat, title, desc, by){
  const s = shot(id, ar);
  return { id:"s"+id.slice(0,8), kind:"seed", src:s.src, w:s.w, h:s.h,
           cat, title, desc, by, likes:0, comments:0 };
}

const SEED = [
  // recipes
  S("1504674900247-0877df9cc836",4/5,"recipes","Herb-crusted steak with charred peppers","Rest it a full ten minutes. That is the whole trick.","Mara Ellis"),
  S("1490645935967-10de6ba17061",1/1,"recipes","The ten-minute breakfast bowl I make every day","Soft egg, avocado, blistered tomatoes, whatever greens are left.","Jonah Reyes"),
  S("1476224203421-9ac39bcb3327",3/4,"recipes","Crispy buttermilk chicken with honey mustard","Overnight buttermilk soak, then straight into the flour. No batter.","Priya Nair"),
  S("1565299624946-b28f40a0ae38",4/5,"recipes","Weeknight sheet-pan pizza","Cold ferment the dough two days and bake it as hot as your oven goes.","Tomás Vidal"),
  S("1540189549336-e6e99c3679fe",1/1,"recipes","Charred greens salad, no sad lunch","Char the lettuce. It sounds wrong and it is completely right.","Sena Kaya"),
  S("1466637574441-749b8f19452f",3/2,"recipes","Sunday prep: five lunches, one board","Everything chopped at once, portioned once, done for the week.","Ida Brandt"),
  S("1467003909585-2f8a72700288",4/5,"recipes","Slow-roasted salmon in broth","Low oven, lots of butter, and a broth you will want to drink.","Kofi Mensah"),
  S("1493770348161-369560ae357d",3/4,"recipes","Brunch spread for six","Three bowls, one bake, and a fruit plate. Nothing needs to be hot.","Lena Moreau"),
  S("1519864600265-abb23847ef2c",1/1,"recipes","Latte art, finally getting the hang of it","Steam colder, pour lower. Took about forty tries.","Ravi Shah"),
  S("1509440159596-0249088772ff",4/5,"recipes","Sourdough with a seeded crust","Roll the shaped loaf in seeds before the final proof.","Nora Beck"),
  S("1551024506-0bccd828d307",2/3,"recipes","Salted caramel over vanilla","Warm the caramel just enough that it pours in a thread.","Emre Doğan"),
  S("1414235077428-338989a2e8c0",3/4,"recipes","Plating like a restaurant at home","Sauce first, protein second, herbs last. Wipe the rim.","Ayla Kurt"),
  S("1517248135467-4c7edcad34c4",3/2,"recipes","Big table brunch, everything at once","Bring it all out together and let people build their own plate.","Mara Ellis"),

  // home
  S("1521017432531-fbd92d768814",3/4,"home","White walls, one red chair","One saturated object in a neutral room does more than a whole palette.","Ida Brandt"),
  S("1522708323590-d24dbb6b0267",4/5,"home","Mustard armchair against dark panelling","Paint the panelling the darkest colour you are brave enough for.","Lena Moreau"),
  S("1586023492125-27b2c045efd7",3/4,"home","Bare floors, big light, nothing extra","Took out half the furniture and the room finally worked.","Tomás Vidal"),
  S("1493809842364-78817add7ffb",3/2,"home","Green velvet sofa, the only thing in the room","Everything else stays quiet so this can be loud.","Sena Kaya"),
  S("1555041469-a586c61ea9bc",1/1,"home","Rust and teal, an unexpected pair","Warm orange against cool blue-green. Adds a blush pillow to soften it.","Priya Nair"),
  S("1567016432779-094069958ea5",4/5,"home","Neutral living room that still feels warm","Layer four shades of the same beige and add texture, not colour.","Nora Beck"),
  S("1616486338812-3dadae4b4ace",3/4,"home","Gallery wall, finally hung straight","Lay the whole thing out on the floor first and photograph it.","Kofi Mensah"),
  S("1600210492486-724fe5c67fb0",4/5,"home","Plants doing the decorating","Six plants, three heights, one corner with real afternoon light.","Ravi Shah"),
  S("1502672260266-1c1ef2d93688",3/2,"home","Small kitchen, dark floors, more counter","Lost the island, gained a run of worktop along the wall.","Jonah Reyes"),
  S("1484154218962-a197022b5858",3/4,"home","Navy sofa and dried pampas","Deep blue reads as a neutral once there is enough wood in the room.","Ayla Kurt"),
  S("1513694203232-719a280e022f",4/5,"home","Knit poufs and round wood tables","No sharp corners anywhere. The room feels calmer for it.","Emre Doğan"),
  S("1560448204-e02f11c3d0e2",3/4,"home","Macramé wall hanging over a tan sofa","Made this over three evenings from about forty metres of cotton cord.","Mara Ellis"),
  S("1556228453-efd6c1ff04f6",4/5,"home","Rattan headboard, linen everything","Washed linen only gets better. Do not iron it.","Ida Brandt"),

  // fashion
  S("1483985988355-763728e1935b",3/4,"fashion","Autumn rack: layering starts here","Build around one heavy coat and keep everything under it thin.","Lena Moreau"),
  S("1490481651871-ab68de25d43d",1/1,"fashion","Yellow wall, gold hoops","Match the metal to the wall and the whole photo locks together.","Sena Kaya"),
  S("1529139574466-a303027c1d8b",4/5,"fashion","A rail of neutrals I actually wear","Cut the wardrobe to twelve pieces that all go together.","Nora Beck"),
  S("1515886657613-9f3515b0c78f",3/4,"fashion","Red graphic tee under black leather","One bright piece, everything else black. Never fails.","Ravi Shah"),
  S("1496747611176-843222e1e57c",2/3,"fashion","Head to toe yellow, no notes","Monochrome is easier than it looks if the textures differ.","Kofi Mensah"),
  S("1479064555552-3ef4979f8908",3/4,"fashion","Floral wrap dress for the coast","Wrap dresses travel well. Roll, do not fold.","Priya Nair"),
  S("1434389677669-e08b4cac3105",1/1,"fashion","Flat lay: boots, belt, grey knit","Brown leather and grey wool is the pairing I keep coming back to.","Tomás Vidal"),
  S("1485462537746-965f33f7f6a7",4/5,"fashion","Fringed cream poncho","Knit on 8mm needles over two weeks of evenings.","Ayla Kurt"),
  S("1441984904996-e0b6ba687e04",2/3,"fashion","Pink coat in the colonnade","Find repeating architecture and stand where the light breaks through.","Jonah Reyes"),
  S("1503342217505-b0a15ec3261c",3/4,"fashion","Black tee, high waist, pink wall","The wall is doing most of the work here and that is fine.","Emre Doğan"),
  S("1487222477894-8943e31ef7b2",4/5,"fashion","Tan leather jacket with a tie","Formal on top, relaxed jacket. It should not work but it does.","Mara Ellis"),
  S("1516762689617-e1cffcef479d",1/1,"fashion","Denim, cream knit, tan boots","The uniform. Three pieces, works nine months of the year.","Ida Brandt"),

  // creative
  S("1459156212016-c812468e2115",1/1,"creative","Repotting the whole windowsill","Terracotta breathes, so water more often than you think.","Nora Beck"),
  S("1452860606245-08befc0ff44b",3/2,"creative","Washi tape and wooden dowels","Everything on this desk cost less than a coffee and lasts for years.","Sena Kaya"),
  S("1493925410384-84f842e616fb",1/1,"creative","Everyday makeup, five products","Cream blush over powder. Everything else is optional.","Lena Moreau"),
  S("1462927114214-6956d2fddd4e",3/2,"creative","Sneaker pile, sorted by nothing","Clean the midsoles with a magic eraser and they look new.","Ravi Shah"),
  S("1544441893-675973e31985",4/5,"creative","Grey sweats and white leather","Wash the sweats cold and hang dry or they lose their shape.","Kofi Mensah"),
  S("1495474472287-4d71bcdd2085",3/2,"creative","Cafe with the long communal table","Copying this exact table length for the studio.","Priya Nair"),
  S("1445205170230-053b83016050",3/4,"creative","Store lighting I want to copy","Warm pendants low over the rail, nothing overhead.","Tomás Vidal"),
  S("1469334031218-e382a71b716b",3/2,"creative","Green tiled bar, brass everything","Glossy tile plus unlacquered brass that is allowed to patina.","Ayla Kurt")
];

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
function srcOf(p){ return p.kind === "upload" ? (state.blobs[p.id] || "") : p.src; }

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
async function readJSON(key, fallback){
  try {
    const r = await store.get(key);
    if (!r || r.value == null) return fallback;
    return JSON.parse(r.value);
  } catch(e){ return fallback; }
}
async function writeJSON(key, value){
  try { await store.set(key, JSON.stringify(value)); return true; }
  catch(e){ console.error("write failed", key, e); return false; }
}
const saveIndex  = () => writeJSON(K_INDEX,  { v:SEED_VERSION, pins:state.pins });
const saveSocial = () => writeJSON(K_SOCIAL, state.social);

async function boot(){
  const idx = await readJSON(K_INDEX, null);

  if (idx && Array.isArray(idx.pins) && idx.pins.length){
    state.pins = idx.pins;
    const have = new Set(state.pins.map(p=>p.id));
    const missing = SEED.filter(s => !have.has(s.id));
    if (missing.length){ state.pins = state.pins.concat(missing); await saveIndex(); }
  } else {
    state.pins = SEED.map(p => ({...p, likes: 6 + (p.title.length * 7) % 180 }));
    await saveIndex();
  }

  state.profile = await readJSON(K_PROFILE, null);
  state.social  = await readJSON(K_SOCIAL, { likes:[], saves:[] });
  state.social.likes = state.social.likes || [];
  state.social.saves = state.social.saves || [];

  // pull image data for uploaded pins in parallel
  const uploads = state.pins.filter(p => p.kind === "upload");
  await Promise.all(uploads.map(async p => {
    try {
      const r = await store.get(blobKey(p.id));
      if (r && r.value) state.blobs[p.id] = r.value;
    } catch(e){ /* blob missing; card falls back to placeholder */ }
  }));

  paintProfile();
  renderChips();
  render();
}

/* ======================================================================
   MASONRY
   ====================================================================== */
function visiblePins(){
  const q = state.query.trim().toLowerCase();
  return state.pins.filter(p => {
    if (state.filter === "mine"  && p.kind !== "upload") return false;
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

function toggleLike(id){
  const p = state.pins.find(x=>x.id===id);
  if (!p) return;
  const i = state.social.likes.indexOf(id);
  if (i > -1){ state.social.likes.splice(i,1); p.likes = Math.max(0,(p.likes||0)-1); }
  else { state.social.likes.push(id); p.likes = (p.likes||0)+1; }
  saveSocial(); saveIndex();
  render();
  if (state.openPin === id) paintDetail();
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

  $("#dDelete").style.display = p.kind === "upload" ? "" : "none";

  const me = state.profile;
  $("#dMeAvatar").textContent = initial(me ? me.name : "?");
  $("#dMeAvatar").style.background = me ? avatarColor(me.name) : "#c9c9c2";

  await paintComments(p.id);
}

async function loadComments(id){
  if (state.commentCache[id]) return state.commentCache[id];
  const list = await readJSON(cmtKey(id), []);
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
      '</div>').join("");
  }
  box.innerHTML = html;
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

  const list = await loadComments(p.id);
  list.push({ id:uid(), name:state.profile.name, text, at:Date.now() });
  state.commentCache[p.id] = list;
  input.value = "";
  input.style.height = "auto";

  p.comments = list.length;
  await Promise.all([ writeJSON(cmtKey(p.id), list), saveIndex() ]);
  await paintComments(p.id);
  $("#dComments").scrollTop = $("#dComments").scrollHeight;
}

async function deletePin(){
  const p = state.pins.find(x=>x.id===state.openPin);
  if (!p || p.kind !== "upload") return;
  if (!confirm("Delete “"+p.title+"”? This cannot be undone.")) return;

  state.pins = state.pins.filter(x=>x.id!==p.id);
  state.social.saves = state.social.saves.filter(x=>x!==p.id);
  state.social.likes = state.social.likes.filter(x=>x!==p.id);
  delete state.blobs[p.id];
  delete state.commentCache[p.id];

  closeScrim("#detailScrim");
  await Promise.all([ saveIndex(), saveSocial(), store.del(blobKey(p.id)), store.del(cmtKey(p.id)) ]);
  renderChips(); render();
  toast("Pin deleted");
}

/* ======================================================================
   UPLOAD
   ====================================================================== */
function openUpload(){
  resetUpload();
  $("#storageNote").textContent = store.name === "github"
    ? "Pins are written to your GitHub repo through the configured API."
    : "Pins are stored with this app and stay available next time you open it.";
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
        const MAX = 1400;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);        // flatten transparency so JPEG does not go black
        ctx.drawImage(img, 0, 0, w, h);

        let q = 0.82, url = c.toDataURL("image/jpeg", q);
        while (url.length > 4_200_000 && q > 0.4){ q -= 0.12; url = c.toDataURL("image/jpeg", q); }
        if (url.length > 4_800_000) return reject(new Error("That image is too large to store. Try a smaller one."));

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

  const pin = {
    id: uid(),
    kind: "upload",
    src: "",
    w: state.pending.w,
    h: state.pending.h,
    cat: $("#uCat").value,
    title,
    desc: $("#uDesc").value.trim(),
    by: state.profile.name,
    likes: 0,
    comments: 0,
    at: Date.now()
  };

  try {
    await store.set(blobKey(pin.id), state.pending.dataUrl);
    state.blobs[pin.id] = state.pending.dataUrl;
    state.pins.unshift(pin);
    await saveIndex();

    closeScrim("#uploadScrim");
    state.filter = "all"; state.query = ""; $("#search").value = "";
    $("#searchWrap").classList.remove("filled");
    renderChips(); render();
    window.scrollTo({ top:0, behavior:"smooth" });
    toast("Published to " + (CATEGORIES.find(c=>c.id===pin.cat)||{label:"your board"}).label);
  } catch(e){
    console.error(e);
    toast("Could not save that pin. Try again.");
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
  await writeJSON(K_PROFILE, state.profile);
  paintProfile();
  closeScrim("#authScrim");
  toast("Signed in as " + name);
}

async function logout(){
  state.profile = null;
  await store.del(K_PROFILE);
  paintProfile();
  closeScrim("#authScrim");
  toast("Logged out");
}

/* ======================================================================
   CHIPS + SCRIMS
   ====================================================================== */
function renderChips(){
  const box = $("#chips");
  box.innerHTML = "";
  const hidden = id =>
    (id === "mine"  && !state.pins.some(p=>p.kind==="upload")) ||
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
