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

// Puts an image straight into the shared namespace, the way the Creative Lab engine saves shirt art.
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

await test("pages may post to the Charleston3D cart (orders, Platinum); nowhere else", async () => {
  const e = env();
  for (const p of ["/makers/license-plate/", "/makers/lightbox/", "/makers/nameplate/", "/", "/pricing/"]) {
    const csp = (await call(e, p)).headers.get("content-security-policy");
    assert.match(csp, /form-action 'self' https:\/\/charleston3d\.com https:\/\/www\.charleston3d\.com$/, p);
  }
  assert.match((await call(e, "/")).headers.get("content-security-policy"), /script-src 'self' https:\/\/static\.cloudflareinsights\.com https:\/\/connect\.facebook\.net https:\/\/analytics\.tiktok\.com;/, "site pages run no inline script: only the analytics beacon and the ad pixels (after Allow)");
  assert.equal((await call(e, "/makers/")).headers.get("x-frame-options"), "DENY", "the makers list is a normal page");
});

await test("only the Photo to 3D Maker may compile WebAssembly (its 3D engine runs in the browser)", async () => {
  const e = env();
  const p3d = await call(e, "/makers/ai3d/");
  assert.match(p3d.headers.get("content-security-policy"), /script-src 'self' 'wasm-unsafe-eval' /);
  assert.match(p3d.headers.get("content-security-policy"), /form-action 'self' https:\/\/charleston3d\.com/, "it can order a print too");
  assert.equal(p3d.headers.get("x-frame-options"), "SAMEORIGIN");
  for (const p of ["/makers/nameplate/", "/makers/license-plate/", "/makers/lightbox/", "/"]) assert.doesNotMatch((await call(e, p)).headers.get("content-security-policy"), /wasm-unsafe-eval/);
});

await test("print prep turns a density field into one watertight part at the asked size", async () => {
  const { prepareFromField } = await import("../makers/ai3d/print-prep.js");
  const r = 40, field = new Float32Array(r * r * r);
  for (let k = 0; k < r; k++) for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) field[i + r * (j + r * k)] = 25 * Math.exp(8 * (0.6 - Math.hypot(i - 20, j - 20, k - 20) / 20));
  const { report } = prepareFromField({ field, res: [r, r, r], threshold: 25 }, { sizeMm: 30 });
  assert.ok(report.ok && report.watertight && report.manifold);
  assert.ok(Math.abs(Math.max(...report.sizeMm) - 30) < 0.01);
});

// ----- EPIX3D accounts, projects, orders and Platinum -----
const { PBKDF2_ITERATIONS, hashPassword, SIGNIN_LIMIT } = await import("../lib/accounts.mjs");
const { shopifyHmac } = await import("../lib/webhook.mjs");
const shop = await import("../lib/shop-config.mjs");
const ORIGIN = "https://studio.test";
const siteEnv = (extra = {}) => env({ ACCOUNTS: memoryKV(), SHOPIFY_WEBHOOK_SECRET: "whsec-test-0123456789", ...extra });
const jcall = (e, path, { method = "GET", body, cookie, headers = {} } = {}) => call(e, path, {
  method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), origin: ORIGIN, ...headers },
});
const cookieOf = (res) => (res.headers.get("set-cookie") ?? "").split(";")[0];
async function signUp(e, email = "Maker@Example.com", password = "a-good-long-password") {
  const r = await jcall(e, "/api/auth/signup", { method: "POST", body: { email, password } });
  assert.equal(r.status, 201, `sign up ${email}`);
  return cookieOf(r);
}
const me = async (e, c) => (await (await jcall(e, "/api/me", { cookie: c })).json()).user;

await test("accounts: sign up sets a secure session cookie and normalizes the email", async () => {
  const e = siteEnv();
  const r = await jcall(e, "/api/auth/signup", { method: "POST", body: { email: "  Maker@Example.COM ", password: "a-good-long-password" } });
  assert.equal(r.status, 201);
  const sc = r.headers.get("set-cookie");
  assert.match(sc, /^epx_session=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  const { user } = await r.json();
  assert.deepEqual([user.email, user.platinum, user.platinumUntil], ["maker@example.com", false, null]);
  const stored = JSON.parse(e.ACCOUNTS.m.get("user:maker@example.com").value);
  assert.equal(stored.iter, PBKDF2_ITERATIONS); assert.ok(stored.iter >= 100000);
  assert.ok(!JSON.stringify(stored).includes("a-good-long-password"), "the password itself is never stored");
  assert.equal(stored.hash, await hashPassword("a-good-long-password", stored.salt));
  const sessions = [...e.ACCOUNTS.m.keys()].filter((k) => k.startsWith("session:"));
  assert.equal(sessions.length, 1);
  assert.ok(!sessions[0].includes(sc.split(";")[0].split("=")[1]), "the session token is stored only as a hash");
  assert.equal((await me(e, cookieOf(r))).email, "maker@example.com");
  assert.equal(await me(e), null);
});

await test("accounts: duplicate email, bad email and short password are refused with plain messages", async () => {
  const e = siteEnv();
  await signUp(e);
  const dup = await jcall(e, "/api/auth/signup", { method: "POST", body: { email: "maker@EXAMPLE.com", password: "another-long-password" } });
  assert.equal(dup.status, 409);
  assert.doesNotMatch((await dup.json()).error, /exists|taken/i);
  assert.equal((await jcall(e, "/api/auth/signup", { method: "POST", body: { email: "not-an-email", password: "a-good-long-password" } })).status, 400);
  const short = await jcall(e, "/api/auth/signup", { method: "POST", body: { email: "b@example.com", password: "123456789" } });
  assert.equal(short.status, 400); assert.equal((await short.json()).code, "weak_password");
});

await test("accounts: sign in, wrong password, unknown email (same answer), sign out", async () => {
  const e = siteEnv();
  await signUp(e);
  const bad = await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "maker@example.com", password: "wrong-password-123" } });
  const none = await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "nobody@example.com", password: "wrong-password-123" } });
  assert.equal(bad.status, 401); assert.equal(none.status, 401);
  assert.equal((await bad.json()).error, (await none.json()).error, "no hint about which emails have accounts");
  const ok = await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "MAKER@example.com", password: "a-good-long-password" } });
  assert.equal(ok.status, 200);
  const c = cookieOf(ok);
  assert.equal((await me(e, c)).email, "maker@example.com");
  const out = await jcall(e, "/api/auth/signout", { method: "POST", cookie: c });
  assert.match(out.headers.get("set-cookie"), /epx_session=; .*Max-Age=0/);
  assert.equal(await me(e, c), null, "the old cookie no longer works");
});

await test("accounts: sign-in attempts are rate limited per email", async () => {
  const e = siteEnv();
  await signUp(e);
  for (let i = 0; i < SIGNIN_LIMIT.perEmail; i++)
    assert.equal((await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "maker@example.com", password: `wrong-password-${i}` } })).status, 401);
  const blocked = await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "maker@example.com", password: "a-good-long-password" } });
  assert.equal(blocked.status, 429, "even the right password waits once the limit is hit");
  assert.equal((await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "other@example.com", password: "x-long-password" } })).status, 401, "other emails aren't blocked");
});

await test("accounts: sign-in attempts are rate limited per IP across emails", async () => {
  const e = siteEnv();
  let last;
  for (let i = 0; i <= SIGNIN_LIMIT.perIp; i++)
    last = await jcall(e, "/api/auth/signin", { method: "POST", body: { email: `guess${i}@example.com`, password: "wrong-password" }, headers: { "cf-connecting-ip": "203.0.113.9" } });
  assert.equal(last.status, 429);
  assert.equal((await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "x@example.com", password: "wrong-password" }, headers: { "cf-connecting-ip": "203.0.113.10" } })).status, 401);
});

await test("accounts: change password signs out other devices; writes from other sites are refused", async () => {
  const e = siteEnv();
  const a = await signUp(e);
  const b = cookieOf(await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "maker@example.com", password: "a-good-long-password" } }));
  assert.equal((await jcall(e, "/api/auth/password", { method: "POST", cookie: a, body: { current: "nope-nope-nope", next: "a-new-long-password" } })).status, 401);
  assert.equal((await jcall(e, "/api/auth/password", { method: "POST", cookie: a, body: { current: "a-good-long-password", next: "short" } })).status, 400);
  const r = await jcall(e, "/api/auth/password", { method: "POST", cookie: a, body: { current: "a-good-long-password", next: "a-new-long-password" } });
  assert.equal(r.status, 200);
  const a2 = cookieOf(r);
  assert.equal(await me(e, b), null, "the other device is signed out");
  assert.equal((await me(e, a2)).email, "maker@example.com");
  assert.equal((await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "maker@example.com", password: "a-new-long-password" } })).status, 200);
  const cross = await jcall(e, "/api/projects", { method: "POST", cookie: a2, body: { maker: "lightbox", name: "x", data: {} }, headers: { origin: "https://evil.example" } });
  assert.equal(cross.status, 403);
  assert.equal((await jcall(siteEnv({ ACCOUNTS: undefined }), "/api/me")).status, 503);
});

const THUMB = "data:image/png;base64," + Buffer.from(PNG).toString("base64");
await test("projects: save, list, open, rename, duplicate, thumbnail, delete", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  assert.equal((await jcall(e, "/api/projects")).status, 401, "signed out: no projects");
  const made = await jcall(e, "/api/projects", { method: "POST", cookie: c, body: { maker: "lightbox", mode: "keychain", name: "Boat tag", data: { state: "{}", pics: { p1: "data:image/png;base64,AAAA" } }, thumb: THUMB } });
  assert.equal(made.status, 201);
  const { project } = await made.json();
  assert.deepEqual([project.maker, project.mode, project.name], ["lightbox", "keychain", "Boat tag"]);
  const list = await (await jcall(e, "/api/projects", { cookie: c })).json();
  assert.equal(list.items.length, 1); assert.equal(list.max, 50);
  const one = await (await jcall(e, `/api/projects/${project.id}`, { cookie: c })).json();
  assert.equal(one.project.data.pics.p1, "data:image/png;base64,AAAA");
  const th = await jcall(e, project.thumbUrl, { cookie: c });
  assert.equal(th.status, 200); assert.equal(th.headers.get("content-type"), "image/png");
  const ren = await (await jcall(e, `/api/projects/${project.id}`, { method: "PUT", cookie: c, body: { name: "Boat tag, blue" } })).json();
  assert.equal(ren.project.name, "Boat tag, blue");
  const upd = await (await jcall(e, `/api/projects/${project.id}`, { method: "PUT", cookie: c, body: { data: { state: "{\"w\":2}" }, mode: "lightbox" } })).json();
  assert.equal(upd.project.mode, "lightbox");
  const dup = await jcall(e, `/api/projects/${project.id}/duplicate`, { method: "POST", cookie: c });
  assert.equal(dup.status, 201); assert.equal((await dup.json()).project.name, "Boat tag, blue copy");
  assert.equal((await (await jcall(e, "/api/projects", { cookie: c })).json()).items.length, 2);
  assert.equal((await jcall(e, `/api/projects/${project.id}`, { method: "DELETE", cookie: c })).status, 200);
  assert.equal((await jcall(e, `/api/projects/${project.id}`, { cookie: c })).status, 404);
  assert.equal((await (await jcall(e, "/api/projects", { cookie: c })).json()).items.length, 1);
  const tag = await jcall(e, "/api/projects", { method: "POST", cookie: c, body: { maker: "lightbox", mode: "nametag", name: "Maya badge", data: { state: "{}" } } });
  assert.equal(tag.status, 201, "the Name tag maker saves like the other light box modes");
});

await test("projects: bad maker or mode, oversized designs and bad thumbnails are refused", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  assert.equal((await jcall(e, "/api/projects", { method: "POST", cookie: c, body: { maker: "shirts", name: "x", data: {} } })).status, 400);
  assert.equal((await jcall(e, "/api/projects", { method: "POST", cookie: c, body: { maker: "nameplate", mode: "keychain", name: "x", data: {} } })).status, 400);
  const big = await jcall(e, "/api/projects", { method: "POST", cookie: c, body: { maker: "nameplate", name: "x", data: { pic: "A".repeat(2 * 1024 * 1024 + 10) } } });
  assert.equal(big.status, 413);
  assert.equal((await jcall(e, "/api/projects", { method: "POST", cookie: c, body: { maker: "nameplate", name: "x", data: {}, thumb: "javascript:alert(1)" } })).status, 400);
  // A design under the cap with a picture inside still saves.
  const ok = await jcall(e, "/api/projects", { method: "POST", cookie: c, body: { maker: "hype-chain", name: "Chain", data: { img: "data:image/png;base64," + "A".repeat(1_500_000) } } });
  assert.equal(ok.status, 201);
});

await test("projects: 50 per account, and one account can't see or touch another's", async () => {
  const e = siteEnv();
  const a = await signUp(e, "a@example.com"), b = await signUp(e, "b@example.com");
  let first;
  for (let i = 0; i < 50; i++) {
    const r = await jcall(e, "/api/projects", { method: "POST", cookie: a, body: { maker: "nameplate", name: `Plate ${i}`, data: { i } } });
    assert.equal(r.status, 201); if (!i) first = (await r.json()).project.id;
  }
  assert.equal((await jcall(e, "/api/projects", { method: "POST", cookie: a, body: { maker: "nameplate", name: "one more", data: {} } })).status, 409);
  assert.equal((await jcall(e, `/api/projects/${first}/duplicate`, { method: "POST", cookie: a })).status, 409);
  assert.equal((await (await jcall(e, "/api/projects", { cookie: b })).json()).items.length, 0);
  for (const [m, p] of [["GET", `/api/projects/${first}`], ["PUT", `/api/projects/${first}`], ["DELETE", `/api/projects/${first}`], ["GET", `/api/projects/${first}/thumb`], ["POST", `/api/projects/${first}/duplicate`]])
    assert.equal((await jcall(e, p, { method: m, cookie: b, body: m === "PUT" ? { name: "mine now" } : undefined })).status, 404, `${m} ${p}`);
  assert.equal((await (await jcall(e, `/api/projects/${first}`, { cookie: a })).json()).project.name, "Plate 0");
});

// A zip's first bytes are what the server checks a 3MF for.
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
function orderForm(fields = {}, file = new File([ZIP], "boat-tag.3mf")) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ maker: "lightbox", mode: "keychain", project: "Boat tag", details: "Keychain, 60 x 40 mm, Teal and White", ...fields })) fd.append(k, v);
  if (file) fd.append("file", file);
  fd.append("preview", new File([PNG], "preview.png", { type: "image/png" }));
  return fd;
}
const orderReq = (body, c) => new Request(`${ORIGIN}/api/orders`, { method: "POST", body, headers: { ...(c ? { cookie: c } : {}), origin: ORIGIN } });

await test("orders: the print file is stored under an unguessable id and the cart post adds the $0 quote line", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  assert.equal((await handleRequest(orderReq(orderForm()), e, feed([requestProduct]))).status, 401, "orders need an account");
  const r = await handleRequest(orderReq(orderForm(), c), e, feed([requestProduct]));
  assert.equal(r.status, 201);
  const o = await r.json();
  assert.match(o.orderId, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(o.cart.action, "https://charleston3d.com/cart/add");
  assert.equal(o.cart.fields.id, "11", "the store feed's free request product");
  assert.equal(o.cart.fields["properties[Item]"], "EPIX3D Keychain");
  assert.equal(o.cart.fields["properties[Project]"], "Boat tag");
  assert.equal(o.cart.fields["properties[_EPIX3D account]"], "maker@example.com");
  assert.equal(o.cart.fields["properties[_Print file]"], `${ORIGIN}/files/${o.orderId}/boat-tag.3mf`);
  assert.equal(o.priced, false);
  const f = await call(e, `/files/${o.orderId}/boat-tag.3mf`);
  assert.equal(f.status, 200, "anyone with the link (Aaron, from the Shopify order) can open it");
  assert.match(f.headers.get("content-disposition"), /attachment; filename="boat-tag\.3mf"/);
  assert.deepEqual(new Uint8Array(await f.arrayBuffer()), ZIP);
  assert.equal((await call(e, `/files/${o.orderId}/preview`)).headers.get("content-type"), "image/png");
  assert.equal((await call(e, `/files/${o.orderId}/other.3mf`)).status, 404);
  assert.equal((await call(e, `/files/${"x".repeat(32)}/boat-tag.3mf`)).status, 404);
  const mine = await (await jcall(e, "/api/orders", { cookie: c })).json();
  assert.deepEqual([mine.items.length, mine.items[0].project], [1, "Boat tag"]);
});

await test("orders: falls back to the configured request variant, and refuses non-print files", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  const down = async () => new Response("no", { status: 503 });
  const o = await (await handleRequest(orderReq(orderForm({ maker: "nameplate" }), c), e, down)).json();
  assert.equal(o.cart.fields.id, String(shop.QUOTE_VARIANT_ID));
  assert.equal(o.cart.action, `${shop.STORE}/cart/add`);
  assert.equal(o.cart.fields["properties[Item]"], "EPIX3D Nameplate");
  assert.equal((await handleRequest(orderReq(orderForm({}, new File([PNG], "x.3mf")), c), e, down)).status, 400);
  assert.equal((await handleRequest(orderReq(orderForm({}, null), c), e, down)).status, 400);
  assert.equal((await handleRequest(orderReq(orderForm({ maker: "shirt" }), c), e, down)).status, 400);
});

await test("orders: a priced plate-maker product sells license plates at the store's price", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  const sale = { id: 2, handle: "plates", title: "License plate print", tags: ["plate-maker"], variants: [{ id: 21, title: "Frame", price: "34.00" }, { id: 22, title: "Novelty plate", price: "29.50" }] };
  const o = await (await handleRequest(orderReq(orderForm({ maker: "license-plate", product: "plate" }), c), e, feed([requestProduct, sale]))).json();
  assert.deepEqual([o.cart.fields.id, o.priced], ["22", true]);
});

const { handleWebhook } = await import("../lib/webhook.mjs");
async function hook(e, payload, { secret = "whsec-test-0123456789", topic = "orders/paid", shopDomain = shop.SHOP_DOMAIN } = {}, ids = { variant: 777, product: null }) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const req = new Request(`${ORIGIN}/api/shopify/webhook`, { method: "POST", body, headers: { "x-shopify-hmac-sha256": await shopifyHmac(secret, body), "x-shopify-topic": topic, "x-shopify-shop-domain": shopDomain } });
  try { return await handleWebhook(req, e.ACCOUNTS, (k) => e[k], { ids }); } catch (err) { return new Response(JSON.stringify({ code: err.code }), { status: err.status }); }
}
const paidOrder = (email, extra = {}) => ({ id: 9001, email: "checkout@example.com", processed_at: "2026-11-07T15:00:00Z", line_items: [{ variant_id: 777, product_id: 55, quantity: 1, properties: email ? [{ name: "_EPIX3D account", value: email }] : [] }], ...extra });
const days35 = (iso) => new Date(Date.parse(iso) + 35 * 86400000).toISOString();

await test("webhook: a good signature on a paid Platinum order gives 35 days from the payment date", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  assert.equal((await hook(e, paidOrder("Maker@example.com"))).status, 200);
  assert.equal((await me(e, c)).platinumUntil, days35("2026-11-07T15:00:00Z"));
  await hook(e, paidOrder("maker@example.com")); // Shopify retries deliveries: the same order doesn't stack
  assert.equal((await me(e, c)).platinumUntil, days35("2026-11-07T15:00:00Z"));
  await hook(e, paidOrder("maker@example.com", { id: 9002, processed_at: "2026-12-07T15:00:00Z" })); // next month's renewal
  assert.equal((await me(e, c)).platinumUntil, days35("2026-12-07T15:00:00Z"));
  await hook(e, paidOrder("maker@example.com", { id: 9000, processed_at: "2026-10-01T15:00:00Z" })); // a late, older one never shortens it
  assert.equal((await me(e, c)).platinumUntil, days35("2026-12-07T15:00:00Z"));
  // The real route reaches the same handler (here with no Platinum product configured yet, so nothing changes).
  const body = JSON.stringify(paidOrder("maker@example.com"));
  const routed = await handleRequest(new Request(`${ORIGIN}/api/shopify/webhook`, { method: "POST", body, headers: { "x-shopify-hmac-sha256": await shopifyHmac("whsec-test-0123456789", new TextEncoder().encode(body)), "x-shopify-topic": "orders/paid" } }), e);
  assert.equal(routed.status, 200);
});

await test("webhook: bad or missing signatures, other stores and other products change nothing", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  assert.equal((await hook(e, paidOrder("maker@example.com"), { secret: "wrong-secret-0123456" })).status, 401);
  assert.equal((await hook(e, paidOrder("maker@example.com"), { shopDomain: "someone-else.myshopify.com" })).status, 401);
  const unsigned = await handleRequest(new Request(`${ORIGIN}/api/shopify/webhook`, { method: "POST", body: JSON.stringify(paidOrder("maker@example.com")), headers: { "x-shopify-topic": "orders/paid" } }), e);
  assert.equal(unsigned.status, 401);
  assert.equal((await hook(e, paidOrder("maker@example.com"), { topic: "orders/create" })).status, 200);
  assert.equal((await (await hook(e, { ...paidOrder("maker@example.com"), line_items: [{ variant_id: 123, quantity: 1 }] })).json()).ignored, "no platinum line");
  assert.equal((await me(e, c)).platinum, false);
  assert.equal((await handleRequest(new Request(`${ORIGIN}/api/shopify/webhook`, { method: "POST", body: "{}" }), siteEnv({ SHOPIFY_WEBHOOK_SECRET: undefined }))).status, 503);
  assert.equal((await (await hook(e, paidOrder("maker@example.com"), {}, { variant: null, product: null })).json()).ignored, "no platinum line", "no Platinum product configured: ignored");
});

await test("webhook: a membership bought before the account exists is applied at sign-up; falls back to the order email", async () => {
  const e = siteEnv();
  const r = await (await hook(e, paidOrder(null, { email: "Later@Example.com" }))).json();
  assert.equal(r.account, "pending");
  const c = await signUp(e, "later@example.com");
  assert.equal((await me(e, c)).platinum, true);
});

await test("admin: setting Platinum by hand needs the console key", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  const admin = (body, key = KEY) => call(e, "/api/admin/platinum", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(key ? { "x-console-key": key } : {}) } });
  assert.equal((await admin({ email: "maker@example.com", days: 30 }, null)).status, 401);
  assert.equal((await admin({ email: "maker@example.com", days: 30 }, "wrong-key-wrong-key")).status, 401);
  assert.equal((await jcall(e, "/api/admin/platinum", { method: "POST", cookie: c, body: { email: "maker@example.com", days: 30 } })).status, 401, "a session is not the key");
  const r = await admin({ email: "MAKER@example.com", days: 30 });
  assert.equal(r.status, 200); assert.equal((await r.json()).user.platinum, true);
  assert.equal((await me(e, c)).platinum, true);
  assert.equal((await (await call(e, "/api/admin/platinum?email=maker@example.com", { headers: { "x-console-key": KEY } })).json()).user.platinum, true);
  assert.equal((await admin({ email: "nobody@example.com", days: 30 })).status, 404);
  await admin({ email: "maker@example.com", clear: true });
  assert.equal((await me(e, c)).platinum, false);
});

await test("downloads: the export check says yes only to signed-in Platinum members", async () => {
  const e = siteEnv();
  assert.equal((await jcall(e, "/api/exports/check", { method: "POST" })).status, 401);
  const c = await signUp(e);
  const free = await jcall(e, "/api/exports/check", { method: "POST", cookie: c });
  assert.equal(free.status, 403); assert.equal((await free.json()).code, "platinum_required");
  await call(e, "/api/admin/platinum", { method: "POST", body: JSON.stringify({ email: "maker@example.com", days: 1 }), headers: { "content-type": "application/json", "x-console-key": KEY } });
  assert.equal((await jcall(e, "/api/exports/check", { method: "POST", cookie: c })).status, 200);
});

await test("config: Platinum shows as not open until its Shopify ids are set", async () => {
  const cfg = await (await call(siteEnv(), "/api/config")).json();
  assert.equal(cfg.platinum.price, "$15 a month");
  assert.equal(cfg.platinum.available, shop.platinumReady());
  assert.equal(cfg.accounts, true);
});

await test("accounts: password reset by email: same answer for any address, one-use link, signs other devices out", async () => {
  const sent = [];
  const e = siteEnv({ EMAIL: { send: async (m) => { sent.push(m); return { messageId: "m1" }; } } });
  const old = await signUp(e);
  const r1 = await jcall(e, "/api/auth/forgot", { method: "POST", body: { email: " MAKER@example.com " } });
  const r2 = await jcall(e, "/api/auth/forgot", { method: "POST", body: { email: "nobody@example.com" } });
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  assert.deepEqual(await r1.json(), await r2.json(), "no hint about which emails have accounts");
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.equal(m.to, "maker@example.com"); assert.equal(m.from.email, "noreply@epix3d.com"); assert.equal(m.replyTo, "hello@charleston3d.com");
  assert.ok(m.text && m.html && m.subject);
  const token = m.text.match(/https:\/\/epix3d\.com\/account\/\?reset=([A-Za-z0-9_-]+)/)[1];
  assert.ok(m.html.includes(token));
  assert.equal((await jcall(e, "/api/auth/reset", { method: "POST", body: { token, password: "short" } })).status, 400, "weak password refused");
  const ok = await jcall(e, "/api/auth/reset", { method: "POST", body: { token, password: "a-brand-new-password" } });
  assert.equal(ok.status, 200); const fresh = cookieOf(ok); assert.ok(fresh);
  assert.equal((await me(e, fresh)).email, "maker@example.com");
  assert.equal(await me(e, old), null, "the old session is signed out");
  const again = await jcall(e, "/api/auth/reset", { method: "POST", body: { token, password: "another-long-password" } });
  assert.equal(again.status, 400); assert.equal((await again.json()).code, "reset_invalid");
  assert.equal((await jcall(e, "/api/auth/signin", { method: "POST", body: { email: "maker@example.com", password: "a-brand-new-password" } })).status, 200);
  assert.equal((await jcall(e, "/api/auth/reset", { method: "POST", body: { token: "x".repeat(40), password: "a-brand-new-password" } })).status, 400);
});

await test("accounts: reset requests are rate limited and work without the email binding", async () => {
  const sent = [];
  const e = siteEnv({ EMAIL: { send: async (m) => { sent.push(m); } } });
  await signUp(e);
  for (let i = 0; i < 5; i++) assert.equal((await jcall(e, "/api/auth/forgot", { method: "POST", body: { email: "maker@example.com" } })).status, 200);
  assert.equal(sent.length, 3, "at most 3 emails an hour per address");
  const noMail = siteEnv(); await signUp(noMail);
  assert.equal((await jcall(noMail, "/api/auth/forgot", { method: "POST", body: { email: "maker@example.com" } })).status, 200);
  assert.equal((await jcall(noMail, "/api/auth/forgot", { method: "POST", body: { email: "not-an-email" } })).status, 400);
});

await test("accounts: reset emails go through Resend when RESEND_API_KEY is set", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); };
  const e = siteEnv({ RESEND_API_KEY: "re_test_key", EMAIL: { send: async () => { throw new Error("binding should not be used"); } } });
  await signUp(e);
  const r = await handleRequest(new Request("https://studio.test/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email: "maker@example.com" }) }), e, fetchImpl);
  assert.equal(r.status, 200);
  const sent = calls.filter((c) => c.url === "https://api.resend.com/emails");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.headers.authorization, "Bearer re_test_key");
  const b = JSON.parse(sent[0].init.body);
  assert.equal(b.from, "EPIX3D <noreply@epix3d.com>"); assert.deepEqual(b.to, ["maker@example.com"]); assert.equal(b.reply_to, "hello@charleston3d.com");
  assert.ok(/\/account\/\?reset=[A-Za-z0-9_-]+/.test(b.text) && b.html && b.subject);
  const failing = siteEnv({ RESEND_API_KEY: "re_test_key" }); await signUp(failing);
  const r2 = await handleRequest(new Request("https://studio.test/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email: "maker@example.com" }) }), failing, async () => new Response("no", { status: 403 }));
  assert.equal(r2.status, 200, "a Resend error never changes the answer");
});

await test("SEO: each Light box mode is served from its own page copy, and other addresses are untouched", async () => {
  const seen = [];
  const e = env({ ASSETS: { fetch: async (r) => { seen.push(new URL(r.url).pathname); return new Response("<!doctype html>", { headers: { "content-type": "text/html" } }); } } });
  for (const mode of ["keychain", "nametag", "sign", "litho", "relief", "bookmark", "ornament", "coaster", "magnet", "lantern", "stamp", "qr"]) await call(e, `/makers/lightbox/?mode=${mode}`);
  await call(e, "/makers/lightbox/?mode=lightbox"); await call(e, "/makers/lightbox/?mode=../../x"); await call(e, "/makers/nameplate/?mode=sign");
  assert.deepEqual(seen, ["/makers/lightbox/m/keychain/", "/makers/lightbox/m/nametag/", "/makers/lightbox/m/sign/", "/makers/lightbox/m/litho/", "/makers/lightbox/m/relief/", "/makers/lightbox/m/bookmark/", "/makers/lightbox/m/ornament/", "/makers/lightbox/m/coaster/", "/makers/lightbox/m/magnet/", "/makers/lightbox/m/lantern/", "/makers/lightbox/m/stamp/", "/makers/lightbox/m/qr/", "/makers/lightbox/", "/makers/lightbox/", "/makers/nameplate/"]);
});

await test("SEO: the IndexNow key file is served only for the INDEXNOW_KEY secret", async () => {
  const k = "0123456789abcdef0123456789abcdef";
  const r = await call(env({ INDEXNOW_KEY: k }), `/${k}.txt`);
  assert.equal(r.status, 200); assert.equal(await r.text(), k);
  assert.equal(await (await call(env(), `/${k}.txt`)).text(), "<!doctype html>");
});

await test("SEO: build output has robots groups for AI crawlers, every maker in the sitemap, and maker tags", async () => {
  const { robotsTxt, makerSeo, MAKER_SEO, makerUrl } = await import("./build.mjs");
  const robots = robotsTxt();
  for (const ua of ["*", "Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "PerplexityBot", "Google-Extended", "CCBot"]) assert.match(robots, new RegExp(`User-agent: ${ua.replace("*", "\\*")}\nAllow: /\nDisallow: /api/`));
  assert.match(robots, /Sitemap: https:\/\/epix3d\.com\/sitemap\.xml/);
  const fs = await import("node:fs");
  for (const id of Object.keys(MAKER_SEO)) {
    const src = fs.readFileSync(new URL(`../makers/${MAKER_SEO[id].dir || id}/index.html`, import.meta.url), "utf8");
    const html = makerSeo(src, id);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.ok(head.includes(`<link rel="canonical" href="https://epix3d.com${makerUrl(id)}">`), id);
    for (const t of ["<title>", 'name="description"', 'name="geo.region"', 'name="twitter:card"', '"WebApplication"', '"BreadcrumbList"', 'name="robots"']) assert.ok(head.includes(t), `${id} ${t}`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${id} h1`);
    const d = head.match(/name="description" content="([^"]*)"/)[1]; assert.ok(d.length >= 70 && d.length <= 160, `${id} description length ${d.length}`);
    const t = head.match(/<title>([^<]*)/)[1]; assert.ok(t.length <= 60, `${id} title length ${t.length}`);
  }
});


/* ---------- live print prices, Export and the Design files plan (2026-11-15) ---------- */
const price = await import("../lib/print-price.mjs");
const printVariants = JSON.parse((await import("node:fs")).readFileSync(new URL("../lib/print-variants.json", import.meta.url), "utf8"));
const { deflateRawSync, crc32 } = await import("node:zlib");
// A real zip (deflate), the way slicers and the makers write 3MF files.
function zipOf(files) {
  const enc = new TextEncoder(); const parts = []; const cent = []; let off = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text), comp = deflateRawSync(data), n = enc.encode(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, n, comp); cent.push(ch, n); off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(cent), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}
// A closed box mesh, s mm on each side (12 triangles, outward facing).
function boxXml(s, { colours = [] } = {}) {
  const v = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const t = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const mats = colours.length ? `<basematerials id="9">${colours.map((c) => `<base name="c" displaycolor="${c}"/>`).join("")}</basematerials>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter"><resources>${mats}<object id="1" type="model"><mesh><vertices>${v.map(([x, y, z]) => `<vertex x="${x}" y="${y}"\n z="${z}"/>`).join("")}</vertices><triangles>${t.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join("")}</triangles></mesh></object></resources></model>`;
}
const box3mf = (s, opts) => zipOf([["3D/3dmodel.model", boxXml(s, opts)]]);
function boxStl(s) {
  const v = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const t = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const b = Buffer.alloc(84 + t.length * 50); b.writeUInt32LE(t.length, 80);
  t.forEach((tri, i) => tri.forEach((k, j) => v[k].forEach((c, a) => b.writeFloatLE(c, 84 + i * 50 + 12 + j * 12 + a * 4))));
  return new Uint8Array(b);
}

await test("print price: the calculator's minimum, rounding up to the dollar, and more for bigger, longer and more colours", () => {
  const small = price.priceFor({ grams: 10, hours: 0.5 });
  assert.equal(small.total, price.RATES.minJob, "small prints cost the $18 minimum");
  const big = price.priceFor({ grams: 400, hours: 18 });
  assert.ok(Number.isInteger(big.total) && big.total > 60, `a big print costs more (${big.total})`);
  assert.ok(price.priceFor({ grams: 400, hours: 18, colours: 4 }).total > big.total, "extra colours add purge filament");
  assert.ok(price.priceFor({ grams: 400, hours: 20 }).total > big.total, "longer prints cost more");
  // Worked by hand from the calculator's defaults: 200 g and 9 h.
  const g = 200, h = 9, R = price.RATES;
  const cost = g / 1000 * R.kgPrice * (1 + R.fail / 100) + R.watts / 1000 * h * R.kwh + (R.printerCost / R.life + R.upkeep) * h + R.pack;
  assert.equal(price.priceFor({ grams: g, hours: h }).total, Math.ceil(cost * 2 + h * R.timeRate));
});

await test("print price: 3MF and STL files are measured the same, with colours from the 3MF", async () => {
  const m = await price.measure3MF(box3mf(20, { colours: ["#FF0000", "#00ff00", "#ff0000"] }));
  assert.equal(Math.round(m.volume), 8000); assert.equal(Math.round(m.area), 2400);
  assert.deepEqual(m.size, [20, 20, 20]); assert.equal(m.tris, 12); assert.equal(m.colours, 2);
  const s = price.measureSTL(boxStl(20));
  assert.equal(Math.round(s.volume), 8000); assert.deepEqual(s.size, [20, 20, 20]);
  const a = await price.quoteFile(box3mf(40), "a.3mf"), b = await price.quoteFile(boxStl(40), "a.stl");
  assert.equal(a.total, b.total, "same shape, same price");
  await assert.rejects(price.measure3MF(box3mf(20), { max: 100 }), { code: "too_big" });
});

const printForm = (file, fields = {}) => orderForm({ maker: "lightbox", mode: "keychain", ...fields }, file);
await test("orders: the price is worked out again from the file and the cart gets the matching Custom Print step", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  const file = new File([box3mf(60)], "cube.3mf");
  const want = (await price.quoteFile(box3mf(60), "cube.3mf")).total;
  const o = await (await handleRequest(orderReq(printForm(file, { price: "1" }), c), e, feed([requestProduct]))).json();
  const step = printVariants.variants.find(([p]) => p >= want);
  assert.equal(o.price, step[0], "a changed page price is ignored");
  assert.equal(o.cart.fields.id, String(step[1]));
  assert.equal(o.priced, true);
  assert.equal(o.cart.fields["properties[_Price check]"], "worked out from the file");
  assert.match(o.cart.fields["properties[_Estimate]"], /^\d+(\.\d)? g, .*60 x 60 x 60 mm$/);
  const mine = await (await jcall(e, "/api/orders", { cookie: c })).json();
  assert.equal(mine.items[0].price, step[0]);
});

await test("orders: a file too big to measure online keeps the page price (never under $18) and is marked for a check", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  const big = new File([zipOf([["3D/3dmodel.model", boxXml(30) + " ".repeat(price.MAX_MODEL_CHARS)]])], "big.3mf");
  const o = await (await handleRequest(orderReq(printForm(big, { price: "41.2" }), c), e, feed([requestProduct]))).json();
  assert.equal(o.price, 42);
  assert.match(o.cart.fields["properties[_Price check]"], /check before printing/);
  const low = await (await handleRequest(orderReq(printForm(big, { price: "3" }), c), e, feed([requestProduct]))).json();
  assert.equal(low.price, 18);
  const none = await (await handleRequest(orderReq(printForm(big), c), e, feed([requestProduct]))).json();
  assert.deepEqual([none.price, none.cart.fields.id], [null, "11"], "no price at all: the free quote line");
  const tagged = await (await handleRequest(orderReq(printForm(new File([box3mf(20)], "c.3mf"), { source: "utm_source=holo&utm_campaign=xmas" }), c), e, feed([requestProduct]))).json();
  assert.equal(tagged.cart.fields["properties[_Campaign]"], "utm_source=holo&utm_campaign=xmas", "ad and Holo post tags reach the order");
});

await test("config: both plans, live pricing, and ad pixels only when set and well formed", async () => {
  const cfg = await (await call(siteEnv(), "/api/config")).json();
  assert.equal(cfg.printPricing, shop.PRINT_PRICING);
  assert.deepEqual([cfg.designs.price, cfg.designs.available, cfg.designs.store], ["$15 a month", true, shop.STORE]);
  assert.equal(String(cfg.designs.variant), String(shop.DESIGNS_VARIANT_ID));
  assert.deepEqual(cfg.ads, { meta: null, tiktok: null });
  const on = await (await call(siteEnv({ META_PIXEL_ID: "123456789012345", TIKTOK_PIXEL_ID: "C1ABCDEF23456789" }), "/api/config")).json();
  assert.deepEqual(on.ads, { meta: "123456789012345", tiktok: "C1ABCDEF23456789" });
  const bad = await (await call(siteEnv({ META_PIXEL_ID: "<script>", TIKTOK_PIXEL_ID: "x" }), "/api/config")).json();
  assert.deepEqual(bad.ads, { meta: null, tiktok: null });
});

await test("webhook: a paid Design files order turns on Design files only, not Platinum", async () => {
  const e = siteEnv();
  const c = await signUp(e);
  const order = paidOrder("maker@example.com", { line_items: [{ variant_id: shop.DESIGNS_VARIANT_ID, product_id: shop.DESIGNS_PRODUCT_ID, quantity: 1, properties: [{ name: "_EPIX3D account", value: "maker@example.com" }] }] });
  assert.equal((await hook(e, order)).status, 200);
  const u = await me(e, c);
  assert.deepEqual([u.designs, u.platinum, u.designsUntil], [true, false, days35("2026-11-07T15:00:00Z")]);
});

const DRIVE = "https://library.test";
const designEnv = () => siteEnv({ DRIVE_ORIGIN: DRIVE });
const id20 = (n) => String(n).padStart(20, "a").replace(/[^0-9a-f]/g, "a");
function fakePc(seen = []) {
  return async (url, init) => {
    const u = new URL(url); seen.push(u.pathname + u.search);
    assert.ok(init.headers["x-drive-sig"], "every request to the PC is signed");
    return new Response(JSON.stringify({ total: 3, items: [
      { id: id20(1), name: "Merry Christmas.svg", kind: "svg", ext: ".svg", size: 2048, brand: "ed", src: "drive", thumb: true },
      { id: id20(2), name: "Logo.png", kind: "logo", ext: ".png", size: 1, brand: "ed", src: "drive" },
      { id: id20(3), name: "Kittl piece", kind: "image", ext: ".png", size: 1, brand: "ed", src: "kittl" },
      { id: id20(4), name: "Cube.png", kind: "image", ext: ".png", size: 1, brand: "c3d", src: "drive" },
      { id: id20(5), name: "Shirt.ai", kind: "source", ext: ".ai", size: 1, brand: "ed", src: "drive" },
    ] }), { headers: { "content-type": "application/json" } });
  };
}
await test("design files: members only; finished ED art only; downloads need the library's tag and are capped daily", async () => {
  const e = designEnv();
  assert.equal((await jcall(e, "/api/designs/search")).status, 401);
  const c = await signUp(e);
  const free = await handleRequest(new Request(`${ORIGIN}/api/designs/search`, { headers: { cookie: c } }), e, fakePc());
  assert.equal(free.status, 402);
  await call(e, "/api/admin/platinum", { method: "POST", body: JSON.stringify({ email: "maker@example.com", days: 30, plan: "designs" }), headers: { "content-type": "application/json", "x-console-key": KEY } });
  assert.equal((await me(e, c)).platinum, false, "Design files doesn't give Platinum");
  const seen = [];
  const r = await handleRequest(new Request(`${ORIGIN}/api/designs/search?q=christmas&kind=svg`, { headers: { cookie: c } }), e, fakePc(seen));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.items.map((i) => i.name), ["Merry Christmas.svg"]);
  assert.match(seen[0], /^\/search\?brand=ed&per=48&page=0&q=christmas&kind=svg$/);
  assert.match(body.items[0].thumbUrl, /^\/api\/drive\/thumb\/[0-9a-f]{20}\?exp=\d+&sig=/);
  const dl = body.items[0].downloadUrl;
  const get = (p) => handleRequest(new Request(`${ORIGIN}${p}`, { headers: { cookie: c } }), e, fakePc());
  const ok = await get(dl);
  assert.equal(ok.status, 302); assert.match(ok.headers.get("location"), /^\/api\/drive\/file\/[0-9a-f]{20}\?exp=/);
  assert.equal((await get(dl.replace(/t=.*/, "t=forged-tag-forged-tag12"))).status, 404, "only files the library showed");
  assert.equal((await get(`/api/designs/file/${id20(4)}`)).status, 404);
  for (let i = 1; i < 60; i++) assert.equal((await get(dl)).status, 302);
  assert.equal((await get(dl)).status, 429, "60 downloads a day");
  const off = await handleRequest(new Request(`${ORIGIN}/api/designs/search`, { headers: { cookie: c } }), e, async () => new Response("down", { status: 530 }));
  assert.equal(off.status, 503);
});

await test("site pages: Design files and three plans are built, linked from the menu and in the sitemap", async () => {
  const fs = await import("node:fs");
  const read = (p) => fs.readFileSync(new URL(`../dist/${p}`, import.meta.url), "utf8");
  const d = read("designs/index.html");
  assert.match(d, /<body class="page-designs">/);
  assert.match(d, /<a href="\/designs\/" aria-current="page">Design files<\/a>/);
  assert.match(read("pricing/index.html"), /data-go-designs[\s\S]*data-go-platinum|data-go-platinum[\s\S]*data-go-designs/);
  assert.match(read("sitemap.xml"), /<loc>https:\/\/epix3d\.com\/designs\/<\/loc>/);
  assert.match(read("llms.txt"), /Design files/);
  assert.ok(fs.existsSync(new URL("../dist/assets/print-price.mjs", import.meta.url)), "the makers can load the price module");
});

console.log(`\n${passed} API tests passed`);
