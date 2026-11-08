// Browser test for epix3d.com: the real Worker (worker/index.mjs) serving dist/ with in-memory KV
// (IMAGES and ACCOUNTS), driven by Playwright at desktop (1280) and phone (390) widths.
// Run: npm run build && npm run test:ui
// Playwright is not a repo dependency: it comes from PLAYWRIGHT_PATH (a folder holding node_modules/playwright),
// NODE_PATH, or the global npm folder (npm root -g), so this runs the same on Windows, macOS and Linux.
// SHOTS=/path/to/dir saves a screenshot of every page.
const path = require("node:path");
const pw = (() => {
  if (process.env.PLAYWRIGHT_PATH) return require(path.join(process.env.PLAYWRIGHT_PATH, "node_modules", "playwright"));
  try {
    return require("playwright");
  } catch (err) {
    if (err.code !== "MODULE_NOT_FOUND") throw err;
    const root = require("node:child_process").execSync("npm root -g", { encoding: "utf8" }).trim();
    return require(path.join(root, "playwright"));
  }
})();
const { chromium } = pw;
const http = require("node:http");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SHOTS = process.env.SHOTS || "";
const KEY = "ui-test-key-0123456789";
const QUOTE_VARIANT = 67895111745723;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".xml": "application/xml" };

// Polls a page function with evaluate. (waitForFunction evaluates a string, which the makers' policy blocks.)
async function until(page, fn, arg, { timeout = 30000 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    try { if (await page.evaluate(fn, arg)) return; } catch (e) { if (!/context was destroyed|navigation/i.test(e.message)) throw e; }
    if (Date.now() > end) throw new Error("timed out waiting for " + String(fn).slice(0, 120));
    await new Promise((r) => setTimeout(r, 100));
  }
}

let failures = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${String(e.stack || e).split("\n").slice(0, 6).join("\n  ")}`); }
};

function memoryKV() {
  const m = new Map();
  return {
    async list({ prefix = "" } = {}) { return { keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata })), list_complete: true }; },
    async getWithMetadata(k) { const v = m.get(k); return v ? { value: v.value, metadata: v.metadata } : { value: null, metadata: null }; },
    async get(k, type) { const v = m.get(k); return v == null ? null : type === "json" ? JSON.parse(v.value) : v.value; },
    async put(k, value, { metadata } = {}) { m.set(k, { value, metadata }); },
    async delete(k) { m.delete(k); },
  };
}
// Workers static assets: a folder serves its index.html, a missing file serves 404.html.
const ASSETS = { async fetch(req) {
  let p = decodeURIComponent(new URL(req.url).pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(DIST, path.normalize(p));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    return new Response(fs.readFileSync(path.join(DIST, "404.html")), { status: 404, headers: { "content-type": TYPES[".html"] } });
  return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" } });
} };

const PAGES = ["/", "/makers/", "/pricing/", "/faq/", "/account/", "/projects/", "/privacy/", "/terms/", "/no-such-page/"];

(async () => {
  const { handleRequest } = await import(pathToFileURL(path.join(ROOT, "worker/index.mjs")).href);
  const env = { IMAGES: memoryKV(), ACCOUNTS: memoryKV(), CONSOLE_KEY: KEY, SHOPIFY_WEBHOOK_SECRET: "whsec-ui-test", ASSETS };
  // The Charleston3D store's product feed, with only its free custom request product (quote mode).
  const storeFetch = async () => Object.defineProperty(new Response(JSON.stringify({ products: [
    { id: 15442527223995, handle: "custom-request", title: "Custom request", tags: ["request-product"], variants: [{ id: QUOTE_VARIANT, title: "Default Title", price: "0.00", available: true }] },
  ] }), { headers: { "content-type": "application/json" } }), "url", { value: "https://charleston3d.com/products.json" });
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handleRequest(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, duplex: "half" }), env, storeFetch);
    const h = {}; r.headers.forEach((v, k) => { if (k !== "set-cookie") h[k] = v; });
    // The test server is plain http, so the Secure flag is dropped here or the browser would ignore the cookie.
    const sc = r.headers.getSetCookie(); if (sc.length) h["set-cookie"] = sc.map((c) => c.replace("; Secure", ""));
    res.writeHead(r.status, h);
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  for (const [width, label] of [[1280, "desktop"], [390, "phone"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 800 : 844 }, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|Failed to load resource|vendor\/|cdnjs|jsdelivr/.test(m.text())) errors.push(m.text()); });
    const shot = async (name, full = true) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`), fullPage: full }); };
    const email = `maker-${width}@example.com`;

    await step(`${label}: every page loads with its title, no sideways scroll`, async () => {
      for (const p of PAGES) {
        const r = await page.goto(BASE + p, { waitUntil: "networkidle" });
        assert.equal(r.status(), p === "/no-such-page/" ? 404 : 200, p);
        assert.match(await page.title(), /EPIX3D/, p);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `${p} scrolls sideways by ${over}px`);
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
        await until(page, () => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
        await shot((p.replace(/\//g, "-").replace(/^-|-$/g, "") || "home") + "-signed-out");
      }
    });

    await step(`${label}: home lists every maker with its own picture; SEO tags are there`, async () => {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      assert.equal(await page.locator(".makers .mk").count(), 9);
      for (const href of ["/makers/lightbox/", "/makers/lightbox/?mode=keychain", "/makers/lightbox/?mode=nametag", "/makers/lightbox/?mode=sign", "/makers/lightbox/?mode=litho", "/makers/license-plate/", "/makers/nameplate/", "/makers/hype-chain/", "/makers/ai3d/"])
        assert.equal(await page.locator(`.makers a[href="${href}"]`).count(), 1, href);
      for (const img of await page.locator(".makers img").all()) await img.scrollIntoViewIfNeeded(); // lazy images load as they come into view
      await until(page, () => [...document.querySelectorAll(".makers img")].every((i) => i.complete && i.naturalWidth > 0));
      assert.equal(await page.locator('meta[property="og:image"]').getAttribute("content"), "https://epix3d.com/assets/img/og.jpg");
      const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
      assert.match(ld, /"OnlineStore"/); assert.match(ld, /"WebSite"/); assert.match(ld, /"priceRange":"\$\$"/); assert.doesNotMatch(ld, /streetAddress|telephone|postalCode/);
      for (const f of ["/sitemap.xml", "/robots.txt", "/llms.txt", "/assets/img/og.jpg"]) assert.equal((await page.request.get(BASE + f)).status(), 200, f);
      const body = await page.locator("body").innerText();
      assert.doesNotMatch(body, /Design Studio|Elevated Designs|Creative Lab|Netlify/i);
      const links = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      assert.ok(!links.some((h) => /^\/#(home|library|designer|makers)/.test(h)), "no links to the old studio pages");
    });

    await step(`${label}: sign up from the account page`, async () => {
      await page.goto(BASE + "/account/?mode=signup", { waitUntil: "networkidle" });
      await page.waitForSelector("[data-form=signup]:not([hidden])");
      await page.fill("#su-email", email);
      await page.fill("#su-pass", "short");
      await page.click("[data-form=signup] button[type=submit]");
      assert.match(await page.locator("[data-form=signup] .form-msg").innerText(), /10 characters/);
      await page.fill("#su-pass", "a-good-long-password");
      await page.click("[data-form=signup] button[type=submit]");
      await page.waitForSelector("[data-account]:not([hidden])");
      assert.equal(await page.locator("[data-me-email]").innerText(), email);
      assert.equal(await page.locator("[data-member-title]").innerText(), "Free account");
      const cookie = (await ctx.cookies()).find((c) => c.name === "epx_session");
      assert.ok(cookie && cookie.httpOnly && cookie.sameSite === "Lax", "HttpOnly, SameSite=Lax session cookie");
      await shot("account-signed-in");
    });

    let projectId;
    await step(`${label}: save a light box design to My projects`, async () => {
      await page.goto(BASE + "/makers/lightbox/", { waitUntil: "load" });
      await until(page, () => document.documentElement.dataset.epixReady === "1");
      assert.match(await page.locator("[data-epix-account]").innerText(), /My projects/);
      await page.evaluate(() => {
        MK.els = [
          { id: "u1", type: "shape", kind: "heart", x: 0.3, y: 0.5, w: 0.3, ar: 1, rot: 0, color: "#c8202c" },
          { id: "u2", type: "text", text: "TEST", font: "Archivo Black", weight: 400, size: 0.2, align: "center", x: 0.66, y: 0.5, rot: 0, color: "#1f5fbf", spacing: 0, stroke: 0, strokeColor: "#1d1d1f" },
        ];
        MK.name = "Heart box"; mkRemount(); mkCommitNow();
      });
      await page.waitForTimeout(600);
      await page.click("[data-epix-save]");
      await until(page, () => new URL(location.href).searchParams.get("project"));
      projectId = new URL(page.url()).searchParams.get("project");
      assert.match(await page.locator("#epx-toast").innerText(), /Saved to My projects/);
      await shot("maker-lightbox", false);
    });

    await step(`${label}: the project shows in My projects and opens again`, async () => {
      await page.goto(BASE + "/projects/", { waitUntil: "networkidle" });
      await page.waitForSelector(".proj");
      assert.equal(await page.locator(".proj").count(), 1);
      assert.equal(await page.locator(".proj-name").innerText(), "Heart box");
      await until(page, () => { const i = document.querySelector(".proj-pic img"); return i && i.complete && i.naturalWidth > 0; });
      await shot("projects-signed-in");
      await page.locator(".proj .btn", { hasText: "Duplicate" }).click();
      await until(page, () => document.querySelectorAll(".proj").length === 2);
      page.once("dialog", (d) => d.accept());
      await page.locator(".proj").first().locator(".btn", { hasText: "Delete" }).click();
      await until(page, () => document.querySelectorAll(".proj").length === 1);
      await page.locator(".proj a.btn", { hasText: "Open" }).click();
      await until(page, () => document.documentElement.dataset.epixReady === "1");
      assert.equal(new URL(page.url()).searchParams.get("project"), projectId);
      assert.equal(await page.evaluate(() => MK.els.length), 2);
      assert.equal(await page.evaluate(() => MK.name), "Heart box");
    });

    await step(`${label}: a Free member sees the Platinum prompt on Download`, async () => {
      let downloaded = false; page.once("download", () => { downloaded = true; });
      await page.click("#mkExport");
      await page.waitForSelector("#epx-dialog");
      assert.match(await page.locator("#epx-dialog h2").innerText(), /Platinum/);
      assert.equal(await page.locator("#mkPrinterDlg").count(), 0, "the export didn't start");
      await shot("upgrade-prompt", false);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#epx-dialog").count(), 0);
      // The license plate's download buttons are gated the same way.
      await page.goto(BASE + "/makers/license-plate/", { waitUntil: "load" });
      await until(page, () => document.documentElement.dataset.epixReady === "1");
      await page.evaluate(() => document.querySelector("[data-download='3mf']").click());
      await page.waitForSelector("#epx-dialog");
      await page.keyboard.press("Escape");
      assert.equal(downloaded, false);
    });

    await step(`${label}: Platinum (set with the admin key) can download`, async () => {
      const r = await page.request.post(BASE + "/api/admin/platinum", { data: { email, days: 35 }, headers: { "x-console-key": KEY } });
      assert.equal(r.status(), 200);
      await page.goto(`${BASE}/makers/lightbox/?project=${projectId}`, { waitUntil: "load" });
      await until(page, () => document.documentElement.dataset.epixReady === "1" && document.documentElement.dataset.epixDownloads === "on");
      assert.match(await page.locator("[data-epix-account]").textContent(), /Platinum/i);
      const dl = page.waitForEvent("download", { timeout: 60000 });
      await page.click("#mkExport");
      const tip = page.locator("#mkHoleGo"); if (await tip.count()) await tip.click();
      await page.waitForSelector("#mkPrinterDlg");
      await page.click("#mkPrGo");
      const file = await dl;
      assert.match(file.suggestedFilename(), /heart-box-print-files\.zip$/);
      assert.equal(await page.locator("#epx-dialog").count(), 0);
      await page.goto(BASE + "/account/", { waitUntil: "networkidle" });
      await page.waitForSelector("[data-account]:not([hidden])");
      assert.equal(await page.locator("[data-member-title]").innerText(), "Platinum member");
    });

    await step(`${label}: Order a print stores the 3MF and hands off to the Charleston3D cart`, async () => {
      let post = null;
      await page.route("https://charleston3d.com/cart/add", async (r) => { post = r.request(); await r.fulfill({ status: 200, contentType: "text/html", body: "<p>cart</p>" }); });
      await page.goto(`${BASE}/makers/lightbox/?project=${projectId}`, { waitUntil: "load" });
      await until(page, () => document.documentElement.dataset.epixReady === "1");
      await page.click("[data-epix-order]");
      await page.waitForSelector("#epx-dialog");
      await shot("order-dialog", false);
      await page.locator("#epx-dialog .epx-primary").click();
      await page.waitForURL("https://charleston3d.com/cart/add", { timeout: 60000 });
      const form = new URLSearchParams(post.postData());
      assert.equal(form.get("id"), String(QUOTE_VARIANT));
      assert.equal(form.get("properties[Project]"), "Heart box");
      assert.equal(form.get("properties[Item]"), "EPIX3D Light box");
      assert.equal(form.get("properties[_EPIX3D account]"), email);
      const link = form.get("properties[_Print file]");
      assert.match(link, /\/files\/[A-Za-z0-9_-]{32}\/heart-box\.3mf$/);
      const f = await page.request.get(link.replace(/^https?:\/\/[^/]+/, BASE));
      assert.equal(f.status(), 200);
      const bytes = await f.body();
      assert.deepEqual([...bytes.subarray(0, 2)], [0x50, 0x4b], "the stored file is the 3MF (a zip)");
      await page.unroute("https://charleston3d.com/cart/add");
    });

    await step(`${label}: signed out, Save asks them to sign in and keeps the design`, async () => {
      await page.goto(BASE + "/account/", { waitUntil: "networkidle" });
      await page.click("[data-signout]");
      await page.waitForSelector("[data-auth]:not([hidden])");
      await page.goto(BASE + "/makers/lightbox/?mode=keychain", { waitUntil: "load" });
      await until(page, () => document.documentElement.dataset.epixReady === "1");
      assert.equal(await page.evaluate(() => MK.mode), "keychain", "?mode= picks the light box mode");
      await page.evaluate(() => { MK.els = [{ id: "k1", type: "text", text: "KEY", font: "Archivo Black", weight: 400, size: 0.3, align: "center", x: 0.5, y: 0.5, rot: 0, color: "#1f5fbf", spacing: 0, stroke: 0, strokeColor: "#1d1d1f" }]; MK.name = "Key tag"; mkRemount(); mkCommitNow(); });
      await page.click("[data-epix-save]");
      await page.waitForSelector("#epx-dialog");
      assert.match(await page.locator("#epx-dialog h2").innerText(), /Sign in to save/);
      await page.locator("#epx-dialog a", { hasText: "Sign in" }).click();
      await page.waitForURL(/\/account\/\?next=/);
      await page.fill("#si-email", email);
      await page.fill("#si-pass", "a-good-long-password");
      await page.click("[data-form=signin] button[type=submit]");
      await page.waitForURL(/\/makers\/lightbox\//);
      await until(page, () => new URL(location.href).searchParams.get("project"), null, { timeout: 30000 });
      assert.equal(await page.evaluate(() => MK.name), "Key tag", "the design came back and was saved");
      const list = await (await page.request.get(BASE + "/api/projects")).json();
      assert.ok(list.items.some((p) => p.name === "Key tag" && p.mode === "keychain"));
    });

    await step(`${label}: the Name tag maker starts with a name badge and builds a 3MF`, async () => {
      await page.goto(BASE + "/makers/lightbox/?mode=nametag", { waitUntil: "load" });
      await until(page, () => document.documentElement.dataset.epixReady === "1");
      const st = await page.evaluate(() => ({ mode: MK.mode, w: MK.width, h: MK.height, ring: MK.ring, text: MK.els[0] && MK.els[0].text, title: EPIX_MAKER.title() }));
      assert.deepEqual(st, { mode: "nametag", w: 76, h: 26, ring: false, text: "YOUR NAME", title: "Name tag maker" });
      const parts = await page.evaluate(async () => (await lbBuild({ collect: true })).map((p) => [p.name, p.blob.size]));
      const f = parts.find(([n]) => /\.3mf$/.test(n));
      assert.ok(f && f[1] > 2000, "a real 3MF: " + JSON.stringify(parts));
      await shot("maker-nametag", false);
    });

    await step(`${label}: "All makers" on every maker lists the whole studio and moves between makers`, async () => {
      for (const m of ["/makers/lightbox/?mode=nametag", "/makers/license-plate/"]) {
        await page.goto(BASE + m, { waitUntil: "load" });
        await until(page, () => document.documentElement.dataset.epixReady === "1");
        await page.click(".epx-switch");
        await page.waitForSelector(".epx-switch-menu:not([hidden]) li a");
        assert.equal(await page.locator(".epx-switch-menu li a").count(), 9, m);
        assert.equal(await page.locator('.epx-switch-menu [aria-current="page"] b').innerText(), m.includes("nametag") ? "Name tag" : "License plate");
      }
      await shot("maker-switcher", false);
      await page.locator(".epx-switch-menu li a", { hasText: "Hype chain" }).click();
      await page.waitForURL(/\/makers\/hype-chain\/$/);
    });

    await step(`${label}: the other makers load with the EPIX3D bar and their gate`, async () => {
      for (const m of ["license-plate", "nameplate", "hype-chain", "ai3d"]) {
        const r = await page.goto(`${BASE}/makers/${m}/`, { waitUntil: "load" });
        assert.equal(r.status(), 200);
        await until(page, () => document.documentElement.dataset.epixReady === "1", null, { timeout: 30000 });
        assert.equal(await page.locator("[data-epix-save]").count(), 1, m);
        assert.equal(await page.locator("[data-epix-order], [data-order]").count() >= 1, true, m);
        assert.match(await page.title(), /EPIX3D/);
        assert.match(r.headers()["content-security-policy"], /form-action 'self' https:\/\/charleston3d\.com/);
        await page.waitForTimeout(m === "license-plate" ? 300 : 2500);
        if (m === "nameplate") { await until(page, () => !!document.querySelector("#arrange svg")); const th = await page.evaluate(() => window.EPIX_MAKER.thumb()); assert.ok(th.startsWith("data:image/jpeg;base64,") && th.length > 8000, "the nameplate thumbnail is a real picture"); }
        await shot(`maker-${m}`, false);
      }
    });

    await step(`${label}: no script errors`, async () => { assert.deepEqual(errors, []); });
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} UI step(s) failed` : "\nAll UI steps passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
