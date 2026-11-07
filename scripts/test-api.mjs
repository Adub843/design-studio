// API tests for the Design Studio Worker: routing, the studio key, brands on images, and the rule that
// keeps Elevated Designs (shirt) art out of the studio: epix3d.com is for 3D designs only. Runs with plain Node (npm test), no network.
import assert from "node:assert/strict";
import { handleRequest, SITE_HEADERS, HQ_URL } from "../worker/index.mjs";
import { requireKey, MIN_KEY_LENGTH } from "../lib/auth.mjs";
import { brandOf, canBePublic, inStudio, BRANDS } from "../lib/images.mjs";
import { pickPlateOrder, variantFor, STORE } from "../lib/plate-order.mjs";

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

await test("brands: old images count as Elevated Designs, which the studio leaves out", () => {
  assert.equal(brandOf({}), "ed"); assert.equal(brandOf(null), "ed"); assert.equal(brandOf({ brand: "nope" }), "ed");
  assert.equal(brandOf({ brand: "c3d" }), "c3d"); assert.equal(brandOf({ brand: "epix3d" }), "epix3d");
  assert.deepEqual(BRANDS, ["c3d", "epix3d"]);
  assert.equal(inStudio({}), false); assert.equal(inStudio({ brand: "ed" }), false); assert.equal(inStudio({ brand: "epix3d" }), true);
  assert.equal(canBePublic("c3d"), false); assert.equal(canBePublic("epix3d"), true);
});

await test("requireKey: unset, short, wrong and right keys", () => {
  const req = (k) => ({ header: () => k });
  assert.throws(() => requireKey(req(KEY), () => undefined), { code: "key_not_set" });
  assert.throws(() => requireKey(req("short"), () => "x".repeat(MIN_KEY_LENGTH - 1)), { code: "key_too_short" });
  assert.throws(() => requireKey(req("wrong-key-wrong-key"), () => KEY), { code: "bad_key", status: 401 });
  assert.throws(() => requireKey(req(null), () => KEY), { code: "bad_key" });
  assert.doesNotThrow(() => requireKey(req(KEY), () => KEY));
});

await test("uploads need the key, keep their brand, are private, and can't be Elevated Designs", async () => {
  const e = env();
  assert.equal((await post(e, { "x-console-key": "wrong-key-wrong-key" })).status, 401);
  for (const b of ["c3d", "epix3d"]) {
    const r = await post(e, { "x-brand": b, "x-public": "1" });
    assert.equal(r.status, 201);
    const { item } = await r.json();
    assert.equal(item.brand, b);
    assert.equal(item.public, false, `${b} uploads are private`);
  }
  for (const b of ["ed", "bogus"]) assert.equal((await (await post(e, { "x-brand": b })).json()).item.brand, "epix3d");
});

// Puts an image straight into the shared namespace, the way the Business Console saves shirt art.
const seed = (e, key, metadata) => e.IMAGES.put(`image:${key}`, PNG, { metadata: { name: `${key}.png`, type: "image/png", added: 1, ...metadata } });

await test("Elevated Designs shirt art in the shared library is invisible here", async () => {
  const e = env();
  await seed(e, "aaaa-00000001", { brand: "ed", public: true });
  await seed(e, "aaaa-00000002", { public: true }); // old, no brand: Elevated Designs
  await seed(e, "aaaa-00000003", { brand: "epix3d", public: true });
  const h = { "x-console-key": KEY };
  const names = async (path, headers = {}) => (await (await call(e, path, { headers })).json()).items.map((i) => i.key);
  assert.deepEqual(await names("/api/images?public=1"), ["aaaa-00000003"]);
  assert.deepEqual(await names("/api/images", h), ["aaaa-00000003"]);
  assert.equal((await call(e, "/api/images?public=1&brand=ed")).status, 400);
  for (const k of ["aaaa-00000001", "aaaa-00000002"]) {
    assert.equal((await call(e, `/api/images/${k}`)).status, 404, "no file");
    assert.equal((await call(e, `/api/images/${k}`, { headers: h })).status, 404, "not even with the key");
    assert.equal((await call(e, `/api/images/${k}`, { method: "PATCH", body: "{}", headers: h })).status, 404, "can't change it");
    assert.equal((await call(e, `/api/images/${k}`, { method: "DELETE", headers: h })).status, 404, "can't delete it");
  }
  assert.equal(e.IMAGES.m.size, 3, "the console's shirt art is untouched");
});

await test("public list hides private and C3D art, and filters by brand", async () => {
  const e = env();
  await seed(e, "bbbb-00000001", { brand: "epix3d", public: true });
  await seed(e, "bbbb-00000002", { brand: "c3d", public: true });
  await seed(e, "bbbb-00000003", { brand: "epix3d" });
  const all = (await (await call(e, "/api/images?public=1")).json()).items;
  assert.deepEqual(all.map((i) => i.key), ["bbbb-00000001"]);
  assert.deepEqual((await (await call(e, "/api/images?public=1&brand=c3d")).json()).items, []);
  assert.equal((await call(e, "/api/images?public=1&brand=nope")).status, 400);
  assert.equal(all[0].url, undefined, "public items carry no signed link");
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

await test("PATCH moves brands, never to Elevated Designs, and never sets public", async () => {
  const e = env();
  await seed(e, "cccc-00000001", { brand: "epix3d", public: true });
  const item = { key: "cccc-00000001" };
  const patch = (body, key = KEY) => call(e, `/api/images/${item.key}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-console-key": key } });
  assert.equal((await patch({ name: "x" }, "wrong-key-wrong-key")).status, 401);
  let out = (await (await patch({ name: "Renamed", tags: "a, b", category: "Holidays", brand: "epix3d" })).json()).item;
  assert.deepEqual([out.name, out.tags, out.category, out.brand, out.public], ["Renamed", "a, b", "Holidays", "epix3d", true]);
  out = (await (await patch({ brand: "c3d" })).json()).item;
  assert.deepEqual([out.brand, out.public], ["c3d", false]);
  out = (await (await patch({ brand: "epix3d", public: true })).json()).item;
  assert.equal(out.public, false, "the studio doesn't set public");
  assert.equal((await patch({ brand: "nope" })).status, 400);
  assert.equal((await patch({ brand: "ed" })).status, 400, "can't hand art to the shirt brand");
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
  assert.equal((await call(e, "/api/library-sync")).status, 404, "the shirt art sync isn't here");
  const page = await call(e, "/");
  assert.equal(page.status, 200);
  for (const [k, v] of Object.entries(SITE_HEADERS)) assert.equal(page.headers.get(k), v, k);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  // Maker Studio frames the makers and the studio frames Maker Studio: this site only, nobody else.
  const maker = await call(e, "/makers/hype-chain/");
  assert.equal(maker.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(maker.headers.get("content-security-policy"), /frame-ancestors 'self'/);
});

await test("no CORS for anyone: the shirt app never reads from here", async () => {
  const e = env();
  for (const origin of ["https://design.elevatedshirts.com", "https://evil.example"]) {
    const r = await call(e, "/api/images?public=1", { headers: { origin } });
    assert.equal(r.headers.get("access-control-allow-origin"), null, origin);
  }
});


// ----- E: drive library (lib/drive.mjs), checked against the PC side's own signature check -----
const { handleDrive } = await import("../lib/drive.mjs");
const { verifySig, driveSig: driveSigFor } = await import("../drive-server/lib.mjs");
const ID = "0123456789abcdef0123";
function fakePC(seen) {
  return async (u, init) => {
    const url = new URL(u);
    seen.push({ path: url.pathname + url.search, ok: verifySig(KEY, init.headers["x-drive-exp"], init.headers["x-drive-sig"], url.pathname + url.search) });
    if (url.pathname === "/search") return Response.json({ total: 1, items: [{ id: ID, name: "skull.stl", thumb: true, src: "e", brand: "c3d" }] });
    if (url.pathname === "/stats") return Response.json({ kinds: [{ brand: "c3d", kind: "3d", n: 4 }, { brand: "ed", kind: "dtf", n: 9 }] });
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
  assert.equal(seen[0].path, "/search?brand=c3d&q=skull", "3D files only: the shirt brand can't be asked for");
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

await test("drive: no shirt feed: /public is gone, stats show 3D files only", async () => {
  const seen = [];
  assert.equal((await dcall("/api/drive/public", { headers: { origin: "https://design.elevatedshirts.com" } }, { fetchImpl: fakePC(seen) })).status, 404);
  assert.equal(seen.length, 0, "the PC is never asked");
  const st = await (await dcall("/api/drive/stats", { headers: { "x-console-key": KEY } }, { fetchImpl: fakePC(seen) })).json();
  assert.deepEqual(st.kinds.map((k) => k.brand), ["c3d"]);
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

const feed = (products, url = "https://charleston3d.com/products.json") => async () => Object.defineProperty(new Response(JSON.stringify({ products })), "url", { value: url });
const requestProduct = { id: 1, handle: "custom-request", title: "Custom request", tags: [], variants: [{ id: 11, title: "Default Title", price: "0.00", available: true }] };

await test("plate order: quote through the free request product, never a priced product by handle", () => {
  assert.deepEqual(pickPlateOrder([requestProduct], STORE), { mode: "quote", store: STORE, title: "Custom request", variants: [{ id: 11, title: "", price: 0 }] });
  const priced = { ...requestProduct, variants: [{ id: 12, price: "5.00" }] };
  assert.equal(pickPlateOrder([priced], STORE).mode, "none");
  assert.equal(pickPlateOrder([], STORE).mode, "none");
});

await test("plate order: a plate-maker product sells at the store's own prices", () => {
  const sale = { id: 2, handle: "anything", title: "License plate print", tags: "Plate-Maker, c3d", variants: [
    { id: 21, title: "Frame", price: "34.00", available: true }, { id: 22, title: "Novelty plate", price: "29.50", available: true }, { id: 23, title: "Gone", price: "9.00", available: false }] };
  const o = pickPlateOrder([requestProduct, sale], STORE);
  assert.equal(o.mode, "buy");
  assert.deepEqual(o.variants.map((v) => [v.id, v.price]), [[21, 3400], [22, 2950]]);
  assert.equal(variantFor(o, "frame").id, 21);
  assert.equal(variantFor(o, "plate").id, 22);
});

await test("/api/plate-order reads the store feed and follows its primary domain", async () => {
  const r = await handleRequest(new Request("https://studio.test/api/plate-order"), env(), feed([requestProduct], "https://www.charleston3d.com/products.json?limit=250&page=1"));
  const o = await r.json();
  assert.equal(o.mode, "quote"); assert.equal(o.store, "https://www.charleston3d.com");
  const down = await handleRequest(new Request("https://studio.test/api/plate-order"), env(), async () => new Response("no", { status: 503 }));
  assert.equal((await down.json()).mode, "none");
  // Shopify returns 403 when no User-Agent is sent, so the feed request must carry one.
  let sent;
  await handleRequest(new Request("https://studio.test/api/plate-order"), env(), async (url, init) => { sent = init?.headers ?? {}; return feed([requestProduct])(); });
  assert.match(String(sent["user-agent"] ?? ""), /\S/);
});

await test("the license plate and nameplate makers may post to the Charleston3D cart; other pages may not", async () => {
  const e = env();
  for (const p of ["/makers/license-plate/", "/makers/nameplate/"])
    assert.match((await call(e, p)).headers.get("content-security-policy"), /form-action 'self' https:\/\/charleston3d\.com https:\/\/www\.charleston3d\.com/);
  for (const p of ["/makers/lightbox/", "/"]) assert.match((await call(e, p)).headers.get("content-security-policy"), /form-action 'self'$/);
});

await test("/api/nameplate-order sells a nameplate-maker product, never the plate product", async () => {
  const plateSale = { id: 3, handle: "plate", title: "License plate print", tags: "plate-maker", variants: [{ id: 31, title: "Frame", price: "15.00" }] };
  const nameSale = { id: 4, handle: "nameplate", title: "Custom nameplate", tags: "nameplate-maker", variants: [{ id: 41, title: "Default Title", price: "20.00" }] };
  const only = await (await handleRequest(new Request("https://studio.test/api/nameplate-order"), env(), feed([requestProduct, plateSale]))).json();
  assert.equal(only.mode, "quote"); // no nameplate product yet: it comes in as a free request
  const both = await (await handleRequest(new Request("https://studio.test/api/nameplate-order"), env(), feed([requestProduct, plateSale, nameSale]))).json();
  assert.deepEqual([both.mode, both.variants[0].id], ["buy", 41]);
  const twoWay = { ...nameSale, variants: [{ id: 42, title: "Nameplate", price: "24.99" }, { id: 43, title: "Nameplate with desk stand", price: "29.99" }] };
  const two = await (await handleRequest(new Request("https://studio.test/api/nameplate-order"), env(), feed([requestProduct, twoWay]))).json();
  assert.deepEqual(two.variants.map((v) => [v.id, v.title, v.price]), [[42, "Nameplate", 2499], [43, "Nameplate with desk stand", 2999]]);
});

await test("only the Photo to 3D Maker may compile WebAssembly (its 3D engine runs in the browser)", async () => {
  const e = env();
  const p3d = await call(e, "/makers/ai3d/");
  assert.match(p3d.headers.get("content-security-policy"), /script-src 'self' 'wasm-unsafe-eval' /);
  assert.equal(p3d.headers.get("x-frame-options"), "SAMEORIGIN");
  for (const p of ["/makers/nameplate/", "/makers/license-plate/", "/"]) assert.doesNotMatch((await call(e, p)).headers.get("content-security-policy"), /wasm-unsafe-eval/);
});

await test("print prep turns a density field into one watertight part at the asked size", async () => {
  const { prepareFromField } = await import("../makers/ai3d/print-prep.js");
  const r = 40, field = new Float32Array(r * r * r);
  for (let k = 0; k < r; k++) for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) field[i + r * (j + r * k)] = 25 * Math.exp(8 * (0.6 - Math.hypot(i - 20, j - 20, k - 20) / 20));
  const { report } = prepareFromField({ field, res: [r, r, r], threshold: 25 }, { sizeMm: 30 });
  assert.ok(report.ok && report.watertight && report.manifold);
  assert.ok(Math.abs(Math.max(...report.sizeMm) - 30) < 0.01);
});

console.log(`\n${passed} API tests passed`);
