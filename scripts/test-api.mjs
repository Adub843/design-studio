// API tests for the Design Studio Worker: routing, the studio key, brands on images, and the rule that
// keeps Charleston 3D art out of the public shirt-app feed. Runs with plain Node (npm test), no network.
import assert from "node:assert/strict";
import { handleRequest, SITE_HEADERS } from "../worker/index.mjs";
import { requireKey, MIN_KEY_LENGTH } from "../lib/auth.mjs";
import { brandOf, canBePublic } from "../lib/images.mjs";

// A Workers KV stand-in with the calls lib/kv-store.mjs makes.
function memoryKV() {
  const m = new Map();
  return {
    m,
    async list({ prefix = "" } = {}) { return { keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata })), list_complete: true }; },
    async getWithMetadata(k) { const v = m.get(k); return v ? { value: v.value, metadata: v.metadata } : { value: null, metadata: null }; },
    async get(k, type) { const v = m.get(k); return v == null ? null : type === "json" ? JSON.parse(v.value) : v.value; },
    async put(k, value, { metadata } = {}) { m.set(k, { value, metadata }); },
    async delete(k) { m.delete(k); },
  };
}
const KEY = "a-long-test-key-1234567890";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const env = (extra = {}) => ({ IMAGES: memoryKV(), CONSOLE_KEY: KEY, ASSETS: { fetch: async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) }, ...extra });
const call = (e, path, init = {}) => handleRequest(new Request(`https://studio.test${path}`, init), e);
const post = (e, headers = {}) => call(e, "/api/images", { method: "POST", body: PNG, headers: { "content-type": "image/png", "x-filename": "art.png", "x-console-key": KEY, ...headers } });

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

await test("brandOf defaults old images to Elevated Designs", () => {
  assert.equal(brandOf({}), "ed"); assert.equal(brandOf(null), "ed"); assert.equal(brandOf({ brand: "nope" }), "ed");
  assert.equal(brandOf({ brand: "c3d" }), "c3d"); assert.equal(brandOf({ brand: "epix3d" }), "epix3d");
  assert.equal(canBePublic("c3d"), false); assert.equal(canBePublic("ed"), true); assert.equal(canBePublic("epix3d"), true);
});

await test("requireKey: unset, short, wrong and right keys", () => {
  const req = (k) => ({ header: () => k });
  assert.throws(() => requireKey(req(KEY), () => undefined), { code: "key_not_set" });
  assert.throws(() => requireKey(req("short"), () => "x".repeat(MIN_KEY_LENGTH - 1)), { code: "key_too_short" });
  assert.throws(() => requireKey(req("wrong-key-wrong-key"), () => KEY), { code: "bad_key", status: 401 });
  assert.throws(() => requireKey(req(null), () => KEY), { code: "bad_key" });
  assert.doesNotThrow(() => requireKey(req(KEY), () => KEY));
});

await test("uploads need the key and keep their brand", async () => {
  const e = env();
  assert.equal((await post(e, { "x-console-key": "wrong-key-wrong-key" })).status, 401);
  for (const b of ["c3d", "ed", "epix3d"]) {
    const r = await post(e, { "x-brand": b, "x-public": "1" });
    assert.equal(r.status, 201);
    const { item } = await r.json();
    assert.equal(item.brand, b);
    assert.equal(item.public, b !== "c3d", `${b} public flag`);
  }
  const r = await post(e, { "x-brand": "bogus" });
  assert.equal((await r.json()).item.brand, "ed");
});

await test("public feed hides private and C3D art, and filters by brand", async () => {
  const e = env();
  await post(e, { "x-brand": "ed", "x-public": "1", "x-filename": "ed.png" });
  await post(e, { "x-brand": "epix3d", "x-public": "1", "x-filename": "epix.png" });
  await post(e, { "x-brand": "c3d", "x-public": "1", "x-filename": "c3d.png" });
  await post(e, { "x-brand": "ed", "x-filename": "private.png" });
  const all = (await (await call(e, "/api/images?public=1")).json()).items.map((i) => i.name).sort();
  assert.deepEqual(all, ["ed.png", "epix.png"]);
  const ed = (await (await call(e, "/api/images?public=1&brand=ed")).json()).items;
  assert.deepEqual(ed.map((i) => i.name), ["ed.png"]);
  assert.equal((await call(e, "/api/images?public=1&brand=nope")).status, 400);
  assert.equal(ed[0].url, undefined, "public items carry no signed link");
});

await test("the full list needs the key and gives signed links", async () => {
  const e = env();
  await post(e, { "x-brand": "c3d" });
  assert.equal((await call(e, "/api/images")).status, 401);
  const { items } = await (await call(e, "/api/images", { headers: { "x-console-key": KEY } })).json();
  assert.equal(items.length, 1);
  assert.equal(items[0].brand, "c3d");
  assert.match(items[0].url, /^\/api\/images\/.+\?exp=\d+&sig=/);
  // The signed link opens the private image without the key; the bare path doesn't.
  assert.equal((await call(e, items[0].url)).status, 200);
  assert.equal((await call(e, `/api/images/${items[0].key}`)).status, 404);
});

await test("PATCH moves brands, and moving to C3D turns public off", async () => {
  const e = env();
  const { item } = await (await post(e, { "x-brand": "ed", "x-public": "1" })).json();
  const patch = (body, key = KEY) => call(e, `/api/images/${item.key}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-console-key": key } });
  assert.equal((await patch({ name: "x" }, "wrong-key-wrong-key")).status, 401);
  let out = (await (await patch({ name: "Renamed", tags: "a, b", category: "Holidays", brand: "epix3d" })).json()).item;
  assert.deepEqual([out.name, out.tags, out.category, out.brand, out.public], ["Renamed", "a, b", "Holidays", "epix3d", true]);
  out = (await (await patch({ brand: "c3d" })).json()).item;
  assert.deepEqual([out.brand, out.public], ["c3d", false]);
  out = (await (await patch({ public: true })).json()).item;
  assert.equal(out.public, false, "C3D art can't be made public");
  assert.equal((await patch({ brand: "nope" })).status, 400);
  out = (await (await patch({ category: "" })).json()).item;
  assert.equal(out.category, undefined);
});

await test("DELETE needs the key and removes the image", async () => {
  const e = env();
  const { item } = await (await post(e, {})).json();
  assert.equal((await call(e, `/api/images/${item.key}`, { method: "DELETE" })).status, 401);
  assert.equal((await call(e, `/api/images/${item.key}`, { method: "DELETE", headers: { "x-console-key": KEY } })).status, 200);
  assert.equal(e.IMAGES.m.size, 0);
});

await test("routing: unknown API paths, missing KV, sync state and site headers", async () => {
  const e = env();
  assert.equal((await call(e, "/api/nothing")).status, 404);
  assert.equal((await call(env({ IMAGES: undefined }), "/api/images?public=1")).status, 503);
  assert.equal((await (await call(e, "/api/library-sync")).json()).ok, false);
  await e.IMAGES.put("sync:kittl", JSON.stringify({ at: 1, added: ["a"], failed: [{ id: "x" }, { id: "y" }] }));
  const s = await (await call(e, "/api/library-sync")).json();
  assert.deepEqual([s.at, s.failed], [1, 2]);
  const page = await call(e, "/");
  assert.equal(page.status, 200);
  for (const [k, v] of Object.entries(SITE_HEADERS)) assert.equal(page.headers.get(k), v, k);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

await test("CORS: only the shirt app origins, only on reads", async () => {
  const e = env();
  const ok = await call(e, "/api/images?public=1", { headers: { origin: "https://design.elevatedshirts.com" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://design.elevatedshirts.com");
  const bad = await call(e, "/api/images?public=1", { headers: { origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

console.log(`\n${passed} API tests passed`);
