// My projects: each maker's design saved to the signed-in account, in the ACCOUNTS KV namespace.
//
//   projidx:<user id>          [{ id, maker, mode, name, updatedAt, createdAt, size }]  newest first
//   proj:<user id>:<id>        { id, maker, mode, name, data, createdAt, updatedAt }
//   projthumb:<user id>:<id>   the thumbnail as a data URL (kept apart so the list stays small)
//
// GET    /api/projects               the list
// POST   /api/projects               save a new one   { maker, mode?, name, data, thumb? }
// GET    /api/projects/:id           one, with its design data
// PUT    /api/projects/:id           change name, data, mode or thumb
// DELETE /api/projects/:id
// POST   /api/projects/:id/duplicate
// GET    /api/projects/:id/thumb     the thumbnail picture
// Everything is scoped to the signed-in user: another account's id reads as "not found".
import { ApiError, json, readJson, randomId, cleanText } from "./http.mjs";
import { requireUser } from "./accounts.mjs";

export const MAKERS = ["lightbox", "license-plate", "nameplate", "hype-chain"];
export const MODES = { lightbox: ["lightbox", "keychain", "nametag", "sign", "litho", "relief", "bookmark", "ornament", "coaster", "magnet"] };
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024; // one project's whole request (pictures inside are data URLs)
export const MAX_PROJECTS = 50;
export const MAX_THUMB_CHARS = 300 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const THUMB_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const idxKey = (u) => `projidx:${u.id}`;
const projKey = (u, id) => `proj:${u.id}:${id}`;
const thumbKey = (u, id) => `projthumb:${u.id}:${id}`;
const loadIdx = async (kv, u) => (await kv.get(idxKey(u), "json")) ?? [];
const saveIdx = (kv, u, idx) => kv.put(idxKey(u), JSON.stringify(idx));
const metaOf = (p, size) => ({ id: p.id, maker: p.maker, mode: p.mode ?? null, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, size });
const view = (m) => ({ ...m, createdAt: new Date(m.createdAt).toISOString(), updatedAt: new Date(m.updatedAt).toISOString(), thumbUrl: `/api/projects/${m.id}/thumb?v=${m.updatedAt}` });

function cleanMaker(maker, mode) {
  if (!MAKERS.includes(maker)) throw new ApiError(400, "bad_maker", "That maker isn't one of ours.");
  if (mode == null || mode === "") return null;
  if (!(MODES[maker] ?? []).includes(mode)) throw new ApiError(400, "bad_mode", "That mode isn't one of this maker's.");
  return mode;
}
function cleanThumb(t) {
  if (t == null || t === "") return null;
  if (typeof t !== "string" || t.length > MAX_THUMB_CHARS || !THUMB_RE.test(t)) throw new ApiError(400, "bad_thumb", "The thumbnail must be a small JPEG, PNG or WebP picture.");
  return t;
}
const cleanName = (n, fallback) => cleanText(n, 80) || fallback;
function sizeOf(data) {
  const s = JSON.stringify(data ?? null);
  if (s.length > MAX_PROJECT_BYTES) throw new ApiError(413, "too_big", "This design is too big to save (2 MB). Use smaller pictures.");
  return s.length;
}

export async function handleProjects(req, kv, { now = Date.now() } = {}) {
  const user = await requireUser(req, kv);
  const parts = new URL(req.url).pathname.split("/").filter(Boolean).slice(2); // after api/projects
  const [id, sub] = parts;
  if (id && !ID_RE.test(id)) throw new ApiError(404, "not_found", "That project wasn't found.");

  if (!id) {
    if (req.method === "GET") return json({ items: (await loadIdx(kv, user)).map(view), max: MAX_PROJECTS });
    if (req.method !== "POST") throw new ApiError(405, "method", "Not allowed.");
    const body = await readJson(req, MAX_PROJECT_BYTES);
    const mode = cleanMaker(body.maker, body.mode);
    if (body.data == null) throw new ApiError(400, "no_data", "There's no design to save.");
    const size = sizeOf(body.data);
    const thumb = cleanThumb(body.thumb);
    const idx = await loadIdx(kv, user);
    if (idx.length >= MAX_PROJECTS) throw new ApiError(409, "too_many", `You can keep ${MAX_PROJECTS} projects. Delete one first.`);
    const p = { id: randomId(12), maker: body.maker, mode, name: cleanName(body.name, "Untitled design"), data: body.data, createdAt: now, updatedAt: now };
    await kv.put(projKey(user, p.id), JSON.stringify(p));
    if (thumb) await kv.put(thumbKey(user, p.id), thumb);
    idx.unshift(metaOf(p, size)); await saveIdx(kv, user, idx);
    return json({ project: view(metaOf(p, size)) }, 201);
  }

  const idx = await loadIdx(kv, user);
  const at = idx.findIndex((m) => m.id === id);
  const p = at >= 0 ? await kv.get(projKey(user, id), "json") : null;
  if (!p) throw new ApiError(404, "not_found", "That project wasn't found.");

  if (sub === "thumb") {
    if (req.method !== "GET") throw new ApiError(405, "method", "Not allowed.");
    const t = await kv.get(thumbKey(user, id));
    if (!t) return new Response(null, { status: 404 });
    const [, type, b64] = t.match(/^data:(image\/[a-z]+);base64,(.*)$/) ?? [];
    return new Response(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { headers: { "content-type": type, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
  }
  if (sub === "duplicate") {
    if (req.method !== "POST") throw new ApiError(405, "method", "Not allowed.");
    if (idx.length >= MAX_PROJECTS) throw new ApiError(409, "too_many", `You can keep ${MAX_PROJECTS} projects. Delete one first.`);
    const copy = { ...p, id: randomId(12), name: cleanText(`${p.name} copy`, 80), createdAt: now, updatedAt: now };
    await kv.put(projKey(user, copy.id), JSON.stringify(copy));
    const t = await kv.get(thumbKey(user, id)); if (t) await kv.put(thumbKey(user, copy.id), t);
    idx.unshift(metaOf(copy, idx[at].size)); await saveIdx(kv, user, idx);
    return json({ project: view(metaOf(copy, idx[0].size)) }, 201);
  }
  if (sub) throw new ApiError(404, "not_found", "Not found");

  if (req.method === "GET") return json({ project: { ...view(metaOf(p, idx[at].size)), data: p.data } });
  if (req.method === "DELETE") {
    await kv.delete(projKey(user, id)); await kv.delete(thumbKey(user, id));
    idx.splice(at, 1); await saveIdx(kv, user, idx);
    return json({ ok: true });
  }
  if (req.method === "PUT") {
    const body = await readJson(req, MAX_PROJECT_BYTES);
    let size = idx[at].size;
    if ("name" in body) p.name = cleanName(body.name, p.name);
    if ("mode" in body) p.mode = cleanMaker(p.maker, body.mode);
    if ("data" in body) { if (body.data == null) throw new ApiError(400, "no_data", "There's no design to save."); size = sizeOf(body.data); p.data = body.data; }
    if ("thumb" in body) { const t = cleanThumb(body.thumb); if (t) await kv.put(thumbKey(user, id), t); }
    p.updatedAt = Math.max(now, p.updatedAt + 1);
    await kv.put(projKey(user, id), JSON.stringify(p));
    idx.splice(at, 1); idx.unshift(metaOf(p, size)); await saveIdx(kv, user, idx);
    return json({ project: view(metaOf(p, size)) });
  }
  throw new ApiError(405, "method", "Not allowed.");
}
