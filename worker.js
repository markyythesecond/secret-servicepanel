/**
 * pinboard-api — the server half of the pinboard.
 *
 * Everything that must not be forgeable lives here: the GitHub token, the
 * admin password, and every check that decides whether a delete is allowed.
 * The browser never sees any of it.
 *
 * Public:
 *   GET    /pins                       list every pin
 *   POST   /pins                       create a pin  -> returns a one-time ownerToken
 *   POST   /pins/:id/like              bump the like counter
 *   GET    /pins/:id/comments          list comments
 *   POST   /pins/:id/comments          add a comment
 *
 * Requires authorization:
 *   DELETE /pins/:id                   admin, or the uploader's ownerToken
 *   DELETE /pins/:id/comments/:cid     admin only
 *
 * Admin:
 *   POST   /auth/admin                 { password } -> { token, expires }
 *   GET    /auth/check                 confirms a token is still valid
 *
 * Deploy:
 *   npx wrangler deploy
 *   npx wrangler secret put GITHUB_TOKEN      fine-grained PAT, Contents: read+write, that repo only
 *   npx wrangler secret put ADMIN_PASSWORD    long and random
 *   npx wrangler secret put SESSION_SECRET    32+ random chars, signs admin tokens
 *
 * wrangler.toml:
 *   name = "pinboard-api"
 *   main = "worker.js"
 *   compatibility_date = "2026-01-01"
 *   [vars]
 *   GITHUB_REPO   = "markyythesecond/secret-servicepanel"
 *   GITHUB_BRANCH = "main"
 *   DATA_DIR      = "data"
 *   ALLOW_ORIGIN  = "https://secretservicepanel.xyz"
 */

const API = "https://api.github.com";
const CATS = ["recipes", "home", "fashion", "creative"];
const MAX_IMAGE_CHARS = 2_800_000;   // ~2MB of binary once base64 is unwound
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || "*";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    try {
      const url = new URL(request.url);
      const seg = url.pathname.split("/").filter(Boolean);
      const m = request.method;

      // --- admin auth ---
      if (seg[0] === "auth" && seg[1] === "admin" && m === "POST") {
        const { password } = await body(request);
        if (!password || !(await sameSecret(password, env.ADMIN_PASSWORD))) {
          await sleep(400 + Math.random() * 300);          // blunt the guessing rate
          return err(401, "Wrong password.", origin);
        }
        const expires = Date.now() + TOKEN_TTL_MS;
        return json({ token: await sign(String(expires), env.SESSION_SECRET), expires }, origin);
      }

      if (seg[0] === "auth" && seg[1] === "check" && m === "GET") {
        return json({ admin: await isAdmin(request, env) }, origin);
      }

      // --- images (served as real bytes so the browser can cache them) ---
      if (seg[0] === "images" && seg[1] && m === "GET") {
        const f = await readFile(env, `${dir(env)}/images/${seg[1].replace(/\.[a-z]+$/i, "")}.txt`);
        if (!f) return err(404, "No such image.", origin);
        const comma = f.content.indexOf(",");
        const type = (f.content.slice(0, comma).match(/data:([^;]+)/) || [])[1] || "image/jpeg";
        const bin = atob(f.content.slice(comma + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, {
          headers: { ...cors(origin), "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" }
        });
      }

      // --- pins ---
      if (seg[0] === "pins" && seg.length === 1) {
        if (m === "GET")  return json({ pins: await readIndex(env) }, origin);
        if (m === "POST") return json(await createPin(env, await body(request)), origin);
        return err(405, "Method not allowed.", origin);
      }

      if (seg[0] === "pins" && seg[1] && seg.length === 2) {
        if (m !== "DELETE") return err(405, "Method not allowed.", origin);
        return json(await deletePin(request, env, seg[1]), origin);
      }

      if (seg[0] === "pins" && seg[2] === "like" && m === "POST") {
        return json(await likePin(env, seg[1], (await body(request)).undo === true), origin);
      }

      // --- comments ---
      if (seg[0] === "pins" && seg[2] === "comments" && seg.length === 3) {
        if (m === "GET")  return json({ comments: await readComments(env, seg[1]) }, origin);
        if (m === "POST") return json(await addComment(env, seg[1], await body(request)), origin);
        return err(405, "Method not allowed.", origin);
      }

      if (seg[0] === "pins" && seg[2] === "comments" && seg[3] && m === "DELETE") {
        if (!(await isAdmin(request, env))) return err(403, "Admins only.", origin);
        return json(await deleteComment(env, seg[1], seg[3]), origin);
      }

      return err(404, "Unknown route.", origin);
    } catch (e) {
      const status = e.status || 500;
      return err(status, status === 500 ? "Something went wrong." : e.message, origin);
    }
  }
};

/* ==========================================================
   AUTH
   ========================================================== */

// Compare digests rather than strings so the comparison can't be timed.
async function sameSecret(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  return x === y;
}

async function digest(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(n => n.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(payload, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(payload) + "." + b64url(String.fromCharCode(...new Uint8Array(sig)));
}

async function verify(token, secret) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const payload = unb64url(token.split(".")[0]);
  if (!/^\d+$/.test(payload)) return false;
  if (Number(payload) < Date.now()) return false;              // expired
  return await sameSecret(token, await sign(payload, secret));
}

async function isAdmin(request, env) {
  const h = request.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return false;
  return verify(h.slice(7), env.SESSION_SECRET);
}

/* ==========================================================
   PINS
   ========================================================== */

async function createPin(env, data) {
  const title = clean(data.title, 90);
  const desc  = clean(data.desc, 400);
  const by    = clean(data.by, 40);
  const cat   = CATS.includes(data.cat) ? data.cat : "creative";
  const image = typeof data.image === "string" ? data.image : "";

  if (!title) throw bad("A pin needs a title.");
  if (!by)    throw bad("A pin needs an author name.");
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)) throw bad("That is not a valid image.");
  if (image.length > MAX_IMAGE_CHARS) throw bad("That image is too large.");

  const w = int(data.w, 1, 6000), h = int(data.h, 1, 6000);
  if (!w || !h) throw bad("Missing image dimensions.");

  const id = rand(12);
  const ownerToken = rand(32);

  await writeFile(env, `${dir(env)}/images/${id}.txt`, image, `add image ${id}`);

  const pin = {
    id, title, desc, by, cat, w, h,
    likes: 0, comments: 0, at: Date.now(),
    owner: await digest(ownerToken)                  // store the hash, never the token
  };

  await updateIndex(env, list => [pin, ...list].slice(0, 2000), `add pin ${id}`);
  return { pin: strip(pin), ownerToken };            // the token is shown exactly once
}

async function deletePin(request, env, id) {
  const list = await readIndex(env, true);
  const pin = list.find(p => p.id === id);
  if (!pin) throw bad("That pin no longer exists.", 404);

  const admin = await isAdmin(request, env);
  const owner = admin ? false : await matchOwner(request, pin);

  if (!admin && !owner) throw bad("You cannot delete that pin.", 403);

  await updateIndex(env, l => l.filter(p => p.id !== id), `delete pin ${id}`);
  await Promise.all([
    deleteFile(env, `${dir(env)}/images/${id}.txt`, `remove image ${id}`),
    deleteFile(env, `${dir(env)}/comments/${id}.json`, `remove comments ${id}`)
  ]);
  return { id, deleted: true, by: admin ? "admin" : "owner" };
}

async function matchOwner(request, pin) {
  const t = request.headers.get("X-Owner-Token");
  if (!t || !pin.owner) return false;
  return (await digest(t)) === pin.owner;
}

async function likePin(env, id, undo) {
  let likes = 0;
  await updateIndex(env, list => list.map(p => {
    if (p.id !== id) return p;
    likes = Math.max(0, (p.likes || 0) + (undo ? -1 : 1));
    return { ...p, likes };
  }), `like ${id}`);
  return { id, likes };
}

/* ==========================================================
   COMMENTS
   ========================================================== */

async function readComments(env, id) {
  const f = await readFile(env, `${dir(env)}/comments/${id}.json`);
  if (!f) return [];
  try { return JSON.parse(f.content); } catch { return []; }
}

async function addComment(env, id, data) {
  const name = clean(data.name, 40);
  const text = clean(data.text, 500);
  if (!name) throw bad("Add a name before commenting.");
  if (!text) throw bad("The comment is empty.");

  const list = await readComments(env, id);
  if (list.length >= 500) throw bad("This pin has too many comments.");

  const comment = { id: rand(10), name, text, at: Date.now() };
  list.push(comment);

  await writeFile(env, `${dir(env)}/comments/${id}.json`, JSON.stringify(list), `comment on ${id}`);
  await updateIndex(env, l => l.map(p => p.id === id ? { ...p, comments: list.length } : p), `count ${id}`);
  return { comment };
}

async function deleteComment(env, id, cid) {
  const list = (await readComments(env, id)).filter(c => c.id !== cid);
  await writeFile(env, `${dir(env)}/comments/${id}.json`, JSON.stringify(list), `remove comment ${cid}`);
  await updateIndex(env, l => l.map(p => p.id === id ? { ...p, comments: list.length } : p), `count ${id}`);
  return { id: cid, deleted: true };
}

/* ==========================================================
   INDEX  (read / modify / write against one JSON file)
   ========================================================== */

const dir = env => env.DATA_DIR || "data";
const strip = p => { const { owner, ...rest } = p; return rest; };   // never leak owner hashes

async function readIndex(env, withOwner = false) {
  const f = await readFile(env, `${dir(env)}/index.json`);
  if (!f) return [];
  let list;
  try { list = JSON.parse(f.content); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return withOwner ? list : list.map(strip);
}

async function updateIndex(env, mutate, message, attempt = 0) {
  const path = `${dir(env)}/index.json`;
  const existing = await readFile(env, path);
  let list = [];
  if (existing) { try { list = JSON.parse(existing.content) || []; } catch { list = []; } }

  const next = mutate(list);
  const r = await ghWrite(env, path, JSON.stringify(next), message, existing && existing.sha);

  // 409 means another request committed between our read and our write.
  if (r.status === 409 && attempt < 4) {
    await sleep(150 * (attempt + 1) + Math.random() * 150);
    return updateIndex(env, mutate, message, attempt + 1);
  }
  if (!r.ok) throw new Error("index write failed " + r.status);
  return next;
}

/* ==========================================================
   GITHUB
   ========================================================== */

function gh(env, path, init = {}) {
  return fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "pinboard-api",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {})
    }
  });
}

async function readFile(env, path) {
  const r = await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodeURI(path)}?ref=${env.GITHUB_BRANCH || "main"}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read failed ${r.status}`);
  const d = await r.json();
  return { sha: d.sha, content: b64decode(d.content.replace(/\n/g, "")) };
}

function ghWrite(env, path, content, message, sha) {
  return gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodeURI(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message, content: b64encode(content),
      branch: env.GITHUB_BRANCH || "main",
      ...(sha ? { sha } : {})
    })
  });
}

async function writeFile(env, path, content, message) {
  const existing = await readFile(env, path);
  const r = await ghWrite(env, path, content, message, existing && existing.sha);
  if (!r.ok) throw new Error(`GitHub write failed ${r.status}`);
}

async function deleteFile(env, path, message) {
  const existing = await readFile(env, path);
  if (!existing) return;
  await gh(env, `/repos/${env.GITHUB_REPO}/contents/${encodeURI(path)}`, {
    method: "DELETE",
    body: JSON.stringify({ message, sha: existing.sha, branch: env.GITHUB_BRANCH || "main" })
  });
}

/* ==========================================================
   HELPERS
   ========================================================== */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = (v, max) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : 0; };
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

function rand(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map(x => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
}

async function body(request) {
  try { return await request.json(); } catch { throw bad("Expected JSON."); }
}

const b64url   = s => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = s => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const cors = origin => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Owner-Token",
  "Access-Control-Max-Age": "86400"
});

const json = (obj, origin) =>
  new Response(JSON.stringify(obj), { headers: { ...cors(origin), "Content-Type": "application/json" } });

const err = (status, message, origin) =>
  new Response(JSON.stringify({ error: message }), {
    status, headers: { ...cors(origin), "Content-Type": "application/json" }
  });
