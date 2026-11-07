// The image library calls the Home, Library and jump pages share. The studio shows Charleston 3D and EPIX3D
// art only (epix3d.com is for 3D work, never shirts). Anyone can browse the public images
// (GET /api/images?public=1, no key); the studio key adds private images and is needed to upload, change or
// delete. Images live online (Cloudflare Workers KV). If that API can't be reached, uploads are kept in this browser.
import { consoleKey } from "./api.js";
import { uploadBrand, BRANDS } from "./brands.js";

const API = "/api/images";

// ---------- storage ----------
const keyHeader = () => { const k = consoleKey.get(); return k ? { "x-console-key": k } : {}; };

let localDb;
const db = () => localDb ??= new Promise((ok, fail) => {
  const req = indexedDB.open("bc-images", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("images", { keyPath: "key" });
  req.onsuccess = () => ok(req.result);
  req.onerror = () => fail(req.error);
});
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction("images", mode);
    const r = fn(t.objectStore("images"));
    t.oncomplete = () => ok(r?.result);
    t.onerror = () => fail(t.error);
  });
};
const localUrls = new Map();

async function listLocal() {
  try {
    const rows = (await tx("readonly", (s) => s.getAll())) ?? [];
    return rows.map(({ blob, ...m }) => {
      if (!localUrls.has(m.key)) localUrls.set(m.key, URL.createObjectURL(blob));
      return { ...m, local: true };
    });
  } catch { return []; }
}

// The online list can lag a minute behind uploads and deletes (Workers KV is eventually
// consistent), so this tab remembers its own recent changes and applies them to the list.
const RECENT_MS = 5 * 60 * 1000;
const recentAdds = new Map(), recentDeletes = new Map(); // key -> { item?, at }
const fresh = (m) => { for (const [k, v] of m) if (Date.now() - v.at > RECENT_MS) m.delete(k); return m; };

// "all" with a working console key, "public" (the public images) without one.
export let libraryScope = "public";
async function fetchList(withKey) {
  const res = await fetch(withKey ? API : `${API}?public=1`, { headers: { accept: "application/json", ...(withKey ? keyHeader() : {}) } });
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) return { status: res.status, items: null };
  return { status: res.status, items: (await res.json()).items ?? [] };
}
export async function listImages() {
  let cloud = null;
  try {
    if (consoleKey.get()) {
      const r = await fetchList(true);
      if (r.items) { cloud = r.items; libraryScope = "all"; }
      else if (r.status === 401 || r.status === 403) consoleKey.clear(); // a wrong key: fall back to the public list
    }
    if (!cloud) { const r = await fetchList(false); cloud = r.items; libraryScope = "public"; }
  } catch { /* offline or not deployed */ }
  cloud = (cloud ?? []).filter((i) => !fresh(recentDeletes).has(i.key));
  const seen = new Set(cloud.map((i) => i.key));
  for (const [k, { item }] of fresh(recentAdds)) if (!seen.has(k)) cloud.push(item);
  const local = await listLocal();
  return [...cloud, ...local].filter((i) => Object.hasOwn(BRANDS, i.brand ?? "ed")).sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
}

// Private items carry a signed link from the API; public ones load from /api/images/:key without the key.
export const imageUrl = (item) => item.local ? localUrls.get(item.key) : item.url ?? `${API}/${encodeURIComponent(item.key)}`;

export async function upload(file, tags, brand = uploadBrand()) {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": file.type, "x-filename": file.name, "x-tags": tags, "x-brand": brand, ...keyHeader() },
      body: file,
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(res.status === 401 ? "Wrong or missing studio key." : "Uploads are off until CONSOLE_KEY is set for the studio."), { stop: true, key: res.status === 401 });
    if (res.ok) {
      const { item } = await res.json();
      recentAdds.set(item.key, { item, at: Date.now() });
      return { saved: "cloud", item };
    }
    if (res.status === 413 || res.status === 415) throw Object.assign(new Error((await res.json().catch(() => ({}))).error ?? res.statusText), { stop: true });
  } catch (e) { if (e.stop) throw e; }
  const item = { key: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name, type: file.type, size: file.size, tags, brand, added: Date.now() };
  await tx("readwrite", (s) => s.put({ ...item, blob: file }));
  return { saved: "local", item };
}

export async function remove(item) {
  if (item.local) {
    await tx("readwrite", (s) => s.delete(item.key));
    URL.revokeObjectURL(localUrls.get(item.key));
    localUrls.delete(item.key);
    return;
  }
  const res = await fetch(`${API}/${encodeURIComponent(item.key)}`, { method: "DELETE", headers: keyHeader() });
  if (!res.ok) throw new Error(res.status === 401 ? "Wrong or missing studio key." : "Couldn't delete that image.");
  recentAdds.delete(item.key);
  recentDeletes.set(item.key, { at: Date.now() });
}

// Changes an online image's name, tags, category or brand.
export async function patchImage(item, patch) {
  if (item.local) throw new Error("This image is only in this browser. Upload it again to change it.");
  const res = await fetch(`${API}/${encodeURIComponent(item.key)}`, {
    method: "PATCH", headers: { "content-type": "application/json", accept: "application/json", ...keyHeader() }, body: JSON.stringify(patch),
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401) { consoleKey.clear(); throw Object.assign(new Error("Wrong or missing studio key."), { key: true }); }
  if (!res.ok) throw new Error(out.error ?? "Couldn't save that change.");
  recentAdds.set(item.key, { item: out.item, at: Date.now() });
  return out.item;
}
