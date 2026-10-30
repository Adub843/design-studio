// API tests for the Design Studio Worker: routing, the studio key, brands on images, and the rule that
// keeps Charleston 3D art out of the public shirt-app feed. Runs with plain Node (npm test), no network.
import assert from "node:assert/strict";
import { handleRequest, SITE_HEADERS, HQ_URL } from "../worker/index.mjs";
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


// ----- E: drive library (lib/drive.mjs), checked against the PC side's own signature check -----
const { handleDrive } = await import("../lib/drive.mjs");
const { verifySig, driveSig: driveSigFor } = await import("../drive-server/lib.mjs");
const ID = "0123456789abcdef0123";
function fakePC(seen) {
  return async (u, init) => {
    const url = new URL(u);
    seen.push({ path: url.pathname + url.search, ok: verifySig(KEY, init.headers["x-drive-exp"], init.headers["x-drive-sig"], url.pathname + url.search) });
    if (url.pathname === "/public") return Response.json({ page: 0, per: 500, total: 2, items: [{ id: ID, name: "skull.png", folder: "DTF Ready Prints", ext: ".png", kind: "dtf", rel: "E:\\secret" }, { id: "../etc", name: "bad" }] });
    if (url.pathname === "/search") return Response.json({ total: 1, items: [{ id: ID, name: "skull.svg", thumb: true, src: "e", brand: "ed" }] });
    if (url.pathname.startsWith("/thumb/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } });
    return new Response("x", { headers: { "content-type": "model/stl", "content-disposition": "attachment; filename=a.stl" } });
  };
}
const driveEnv = (k, extra = {}) => ({ CONSOLE_KEY: KEY, DRIVE_ORIGIN: "https://library.test", ...extra })[k];
const dcall = (path, init = {}, opts = {}) => handleDrive(new Request(`https://studio.test${path}`, init), { env: driveEnv, ...opts });

await test("drive: search needs the key, and every request to the PC is signed", async () => {
  const seen = [];
  assert.equal((await dcall("/api/drive/search?q=skull", {}, { fetchImpl: fakePC(seen) })).status, 401);
  assert.equal(seen.length, 0);
  const res = await dcall("/api/drive/search?q=skull&brand=ed&evil=1", { headers: { "x-console-key": KEY } }, { fetchImpl: fakePC(seen) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(seen[0].path, "/search?q=skull&brand=ed");
  assert.equal(seen[0].ok, true);
  assert.match(body.items[0].thumbUrl, /^\/api\/drive\/thumb\/0123456789abcdef0123\?exp=\d+&sig=/);
  assert.match(body.items[0].fileUrl, /^\/api\/drive\/file\//);
});

await test("drive: signed links load previews without the key; bad or old links don't", async () => {
  const seen = [];
  const res = await dcall("/api/drive/search", { headers: { "x-console-key": KEY } }, { fetchImpl: fakePC(seen) });
  const { thumbUrl, fileUrl } = (await res.json()).items[0];
  const t = await dcall(thumbUrl, {}, { fetchImpl: fakePC(seen) });
  assert.equal(t.status, 200); assert.equal(t.headers.get("content-type"), "image/webp");
  const f = await dcall(fileUrl, {}, { fetchImpl: fakePC(seen) });
  assert.equal(f.status, 200); assert.match(f.headers.get("content-disposition"), /attachment/);
  assert.ok(seen.every((s) => s.ok));
  assert.equal((await dcall(thumbUrl.replace(/sig=.*/, "sig=forged"), {}, { fetchImpl: fakePC(seen) })).status, 404);
  assert.equal((await dcall(thumbUrl, {}, { fetchImpl: fakePC(seen), now: Date.now() + 2 * 3600_000 })).status, 404);
  assert.equal((await dcall(fileUrl.replace("/file/", "/thumb/"), {}, { fetchImpl: fakePC(seen) })).status, 404);
  assert.equal((await dcall("/api/drive/thumb/..%2f..%2fwindows", { headers: { "x-console-key": KEY } }, { fetchImpl: fakePC(seen) })).status, 404);
});

await test("drive: a switched-off PC reads as offline, and it's read only", async () => {
  const down = async () => new Response("bad gateway", { status: 530 });
  const r = await dcall("/api/drive/search", { headers: { "x-console-key": KEY } }, { fetchImpl: down });
  assert.equal(r.status, 503); assert.equal((await r.json()).code, "pc_offline");
  const thrown = await dcall("/api/drive/stats", { headers: { "x-console-key": KEY } }, { fetchImpl: async () => { throw new Error("dns"); } });
  assert.equal((await thrown.json()).code, "pc_offline");
  assert.equal((await dcall("/api/drive/search", { method: "POST", headers: { "x-console-key": KEY } })).status, 405);
  assert.equal((await handleDrive(new Request("https://studio.test/api/drive/search"), { env: (k) => k === "CONSOLE_KEY" ? KEY : undefined })).status, 503);
});

await test("drive: the shirt app's public list needs no key, has absolute signed links and CORS for the app only", async () => {
  const seen = [];
  const app = { origin: "https://design.elevatedshirts.com" };
  const res = await dcall("/api/drive/public?q=skull&brand=c3d&per=50", { headers: app }, { fetchImpl: fakePC(seen) });
  assert.equal(res.status, 200);
  assert.equal(seen[0].path, "/public?q=skull&per=50", "the brand can't be chosen from outside");
  assert.equal(seen[0].ok, true);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://design.elevatedshirts.com");
  const body = await res.json();
  assert.equal(body.items.length, 1, "bad ids are dropped");
  assert.deepEqual(Object.keys(body.items[0]).sort(), ["ext", "fileUrl", "folder", "id", "kind", "name", "thumbUrl"], "nothing about the PC's paths");
  assert.match(body.items[0].thumbUrl, /^https:\/\/studio\.test\/api\/drive\/thumb\/0123456789abcdef0123\?exp=\d+&sig=/);
  const t = await dcall(new URL(body.items[0].fileUrl).pathname + new URL(body.items[0].fileUrl).search, { headers: app }, { fetchImpl: fakePC(seen) });
  assert.equal(t.status, 200);
  assert.equal(t.headers.get("access-control-allow-origin"), "https://design.elevatedshirts.com", "the app can read the file to print it");
  const evil = await dcall("/api/drive/public", { headers: { origin: "https://evil.example" } }, { fetchImpl: fakePC(seen) });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  const search = await dcall("/api/drive/search", { headers: app }, { fetchImpl: fakePC(seen) });
  assert.equal(search.status, 401, "the full search still needs the key");
  assert.equal(search.headers.get("access-control-allow-origin"), null);
  const off = await dcall("/api/drive/public", { headers: app }, { fetchImpl: async () => new Response("", { status: 530 }) });
  assert.equal(off.status, 503);
  assert.equal(off.headers.get("access-control-allow-origin"), "https://design.elevatedshirts.com", "the app can tell the PC is off");
});

await test("drive: the shirt app only gets Elevated Designs pictures from the chosen E: folders", async () => {
  const { shirtSearch } = await import("../drive-server/lib.mjs");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, src TEXT, root INTEGER, rel TEXT, name TEXT, folder TEXT, ext TEXT, brand TEXT, kind TEXT)");
  const add = db.prepare("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const rows = [["a", 0, "DTF Ready Prints\\skull.png", ".png", "ed", "dtf"], ["b", 0, "Fraud Account\\id.png", ".png", "ed", "image"],
    ["c", 0, "SVG FILES\\boats\\anchor.svg", ".svg", "ed", "svg"], ["d", 0, "SVG FILES\\boats\\anchor.ai", ".ai", "ed", "source"],
    ["e", 0, "Design Images_old\\p.png", ".png", "ed", "image"], ["f", 1, "DTF Ready Prints\\lab.png", ".png", "ed", "image"],
    ["g", 0, "DTF Ready Prints\\boat.png", ".png", "c3d", "image"], ["h", 0, "loose.png", ".png", "ed", "image"]];
  for (const [id, root, rel, ext, brand, kind] of rows) add.run(id, root ? "lab" : "e", root, rel, rel.split("\\").at(-1), rel.split("\\").slice(0, -1).join("\\"), ext, brand, kind);
  const roots = [{ src: "e" }, { src: "lab" }];
  const got = (q = "") => shirtSearch(db, roots, ["Design Images", "DTF Ready Prints", "SVG FILES"], new URLSearchParams(q)).items.map((i) => i.id);
  assert.deepEqual(got(), ["a", "c"], "only pictures, only Elevated Designs, only inside the chosen folders on E:");
  assert.deepEqual(got("q=anchor"), ["c"]);
  assert.deepEqual(got("q=100%25"), [], "search text can't widen the match");
  assert.deepEqual(shirtSearch(db, roots, [], new URLSearchParams()).items, [], "no folders chosen: nothing is public");
});

await test("drive: the PC rejects unsigned, forged, replayed-path and stale requests", () => {
  const exp = String(Math.floor(Date.now() / 1000));
  const sig = driveSigFor(KEY, exp, "/search?q=a");
  assert.equal(verifySig(KEY, exp, sig, "/search?q=a"), true);
  assert.equal(verifySig(KEY, exp, sig, "/file/0123456789abcdef0123"), false);
  assert.equal(verifySig("another-key-123456789", exp, sig, "/search?q=a"), false);
  assert.equal(verifySig(KEY, String(Number(exp) - 3600), driveSigFor(KEY, String(Number(exp) - 3600), "/stats"), "/stats"), false);
  assert.equal(verifySig(KEY, exp, undefined, "/stats"), false);
});

await test("drive: files are sorted into the right brand and kind", async () => {
  const { classify } = await import("../drive-server/lib.mjs");
  assert.deepEqual([classify("Print files\\boat\\hull.stl").brand, classify("Print files\\boat\\hull.stl").kind], ["c3d", "3d"]);
  assert.equal(classify("Mega bundle\\x\\thing.3mf").brand, "c3d");
  assert.equal(classify("Comercial downloaded 3d print files\\a\\photo.png").brand, "c3d");
  assert.deepEqual([classify("DTF Ready Prints\\skull.png").brand, classify("DTF Ready Prints\\skull.png").kind], ["ed", "dtf"]);
  assert.equal(classify("Logo Library\\a.png").kind, "logo");
  assert.equal(classify("SVG FILES\\a\\b.svg").kind, "svg");
  assert.equal(classify("Vector files\\a.eps").kind, "source");
});

await test("/hq is a short link to the main console", async () => {
  for (const path of ["/hq", "/hq/"]) {
    const r = await call(env(), path, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), HQ_URL);
  }

});

console.log(`\n${passed} API tests passed`);
