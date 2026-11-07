// Browser test for the Design Studio: the real Worker (worker/index.mjs) serving dist/ with an in-memory
// image library, driven by Playwright at desktop (1280) and phone (390) widths, light and dark.
// Run: npm run build && NODE_PATH=$(npm root -g) node scripts/test-ui.cjs
// Optional: SCREENS=/path/to/dir saves screenshots there.
const { chromium } = require("playwright");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const SCREENS = process.env.SCREENS || "";
const KEY = "ui-test-key-0123456789";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png" };

let failures = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.log(`not ok - ${name}\n  ${String(e.stack || e).split("\n").slice(0, 6).join("\n  ")}`); }
};

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
const ASSETS = { async fetch(req) {
  let p = decodeURIComponent(new URL(req.url).pathname);
  if (p.endsWith("/")) p += "index.html"; // Workers static assets serve a folder's index.html the same way
  const file = path.join(DIST, path.normalize(p));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" } });
} };

// Print-style art with transparent backgrounds, drawn by the browser so the test needs no image files.
// The "ed" rows are Elevated Designs shirt art the Business Console saved in the shared library: the studio
// (epix3d.com, 3D only) must never show them.
const ART = [
  ["Shirt Art Sunrise", "ed", true, "Coastal", "#b8892a", "Playfair Display", "SUNRISE"],
  ["Shirt Art Script", "ed", false, "Charleston", "#15223f", "Pacifico", "Script"],
  ["Lowcountry Sunrise", "epix3d", false, "Coastal", "#b8892a", "Playfair Display", "LOWCOUNTRY"],
  ["Holy City Script", "epix3d", false, "Charleston", "#15223f", "Pacifico", "Holy City"],
  ["Pluff Mud Club", "c3d", false, "Coastal", "#3d3f43", "Oswald", "PLUFF MUD CLUB"],
  ["Rainbow Row Badge", "c3d", false, "Charleston", "#0e7c74", "Bebas Neue", "RAINBOW ROW"],
  ["Print Cube Mark", "epix3d", false, "Logos", "#15223f", "Archivo Black", "C3D"],
  ["Neon Grid Tiger", "epix3d", true, "Animals", "#5b47a8", "Anton", "EPIX"],
  ["Stay Curious", "epix3d", true, "Words", "#b3262e", "Permanent Marker", "Stay curious"],
];

(async () => {
  const { handleRequest } = await import(path.join(ROOT, "worker/index.mjs"));
  const env = { IMAGES: memoryKV(), CONSOLE_KEY: KEY, ASSETS };
  // The Charleston3D store's product feed, with only its free custom request product (quote mode).
  const storeFetch = async () => Object.defineProperty(new Response(JSON.stringify({ products: [
    { id: 7, handle: "custom-request", title: "Custom request", tags: [], variants: [{ id: 4242, title: "Default Title", price: "0.00", available: true }] },
  ] }), { headers: { "content-type": "application/json" } }), "url", { value: "https://charleston3d.com/products.json" });
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handleRequest(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, duplex: "half" }), env, storeFetch);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const shot = async (page, name) => { if (SCREENS) await page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage: false }); };

  await step("seed the library (studio art through the upload API, shirt art straight into the shared namespace)", async () => {
    const p = await browser.newPage();
    await p.route("https://fonts.googleapis.com/**", (r) => r.abort());
    for (const [name, brand, pub, cat, color, font, text] of ART) {
      await p.setContent(`<body style="margin:0;background:transparent"><div id="a" style="display:inline-block;padding:24px 32px;font:700 88px '${font}',Georgia,serif;color:${color};letter-spacing:.02em;border:6px solid ${color};border-radius:18px">${text}</div></body>`);
      const png = await p.locator("#a").screenshot({ omitBackground: true });
      if (brand === "ed") { await env.IMAGES.put(`image:shirt-0000000${env.IMAGES.m.size}`, png, { metadata: { name: `${name}.png`, type: "image/png", size: png.length, brand, category: cat, public: pub, added: Date.now() } }); continue; }
      const r = await fetch(`${BASE}api/images`, { method: "POST", body: png, headers: { "content-type": "image/png", "x-filename": `${name}.png`, "x-brand": brand, "x-category": cat, "x-console-key": KEY } });
      assert.equal(r.status, 201, name);
      if (pub) { const { item } = await r.json(); const v = env.IMAGES.m.get(`image:${item.key}`); v.metadata = { ...v.metadata, public: true }; }
    }
    await p.close();
  });

  for (const [width, label] of [[1280, "desktop"], [390, "phone"]]) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width, height: width > 500 ? 860 : 844 }, colorScheme: scheme, deviceScaleFactor: width > 500 ? 1 : 2 });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
      const tag = `${label}-${scheme}`;

      await step(`${tag}: home shows public art for all brands without a key`, async () => {
        await page.goto(BASE);
        await page.waitForSelector(".kpis");
        assert.equal(await page.locator(".bs[aria-pressed=true]").innerText().then((t) => t.trim()), width > 1100 ? "All brands" : "All");
        assert.equal(await page.locator(".kpi b").first().innerText(), "2"); // public only: 2 EPIX3D, never the public shirt art
        assert.equal(await page.locator(".start").count(), 0, "no shirt quick starts");
        if (width > 760) assert.equal(await page.locator(".bcard").count(), 2);
        assert.doesNotMatch(await page.locator("#view").innerText(), /shirt/i);
        await shot(page, `${tag}-home-locked`);
      });

      await step(`${tag}: unlocking shows private art and the C3D images`, async () => {
        await page.locator(".key-btn").click();
        await page.fill("#key-in", KEY);
        await page.click("#key-save");
        await page.waitForFunction(() => document.querySelector(".kpi b")?.textContent === "7");
        await page.waitForFunction(() => [...document.querySelectorAll(".rcard img")].every((i) => i.complete && i.naturalWidth > 0));
        await shot(page, `${tag}-home`);
      });

      await step(`${tag}: the brand switcher narrows the studio to one brand`, async () => {
        await page.locator(".bs-c3d").click();
        await page.waitForFunction(() => document.querySelector(".kpi b")?.textContent === "2");
        assert.equal(await page.evaluate(() => document.documentElement.dataset.brand), "c3d");
        assert.equal(await page.locator(".bcard").count(), 0);
        assert.equal(await page.locator(".bs-ed").count(), 0, "no Elevated Designs brand here");
        await page.locator(".bs-all").click();
        await page.waitForFunction(() => document.querySelector(".kpi b")?.textContent === "7");
      });

      await step(`${tag}: library cards, filter, search and the details sheet`, async () => {
        await page.goto(`${BASE}#library`);
        await page.waitForSelector(".acard");
        assert.equal(await page.locator(".acard").count(), 7);
        assert.equal(await page.locator(".acard", { hasText: "Shirt Art" }).count(), 0, "the shirt art never shows");
        await page.locator(".seg-btn[data-f=private]").click();
        assert.equal(await page.locator(".acard").count(), 5);
        await page.locator(".seg-btn[data-f=all]").click();
        await page.fill(".toolbar input[type=search]", "holy");
        assert.equal(await page.locator(".acard").count(), 1);
        await page.fill(".toolbar input[type=search]", "");
        await page.waitForFunction(() => [...document.querySelectorAll(".acard img")].every((i) => i.complete && i.naturalWidth > 0));
        await shot(page, `${tag}-library`);
        await page.locator(".acard", { hasText: "Lowcountry Sunrise" }).click();
        await page.waitForSelector("dialog.sheet[open]");
        await page.waitForTimeout(300); // let the slide-in finish
        await shot(page, `${tag}-library-sheet`);
        const sheet = page.locator("dialog.sheet[open]");
        assert.deepEqual(await sheet.locator("select option").evaluateAll((o) => o.map((x) => x.value)), ["c3d", "epix3d"]);
        assert.equal(await sheet.locator("input[type=checkbox]").count(), 0, "no shirt-app option");
        assert.doesNotMatch(await sheet.innerText(), /shirt|designer/i);
        await sheet.locator("select").selectOption("c3d");
        await sheet.locator("select").selectOption("epix3d");
        await sheet.locator("input.field").first().fill("Lowcountry Sunrise Plate");
        await sheet.locator("button[type=submit]").click();
        await page.waitForSelector("dialog.sheet[open]", { state: "detached", timeout: 3000 }).catch(() => {});
        await page.waitForFunction(() => [...document.querySelectorAll(".acard .a-name")].some((n) => n.textContent === "Lowcountry Sunrise Plate"));
      });

      await step(`${tag}: there is no shirt designer`, async () => {
        assert.equal(await page.locator('.nav[data-route="designer"]').count(), 0);
        assert.equal(await page.locator('.side-new').getAttribute("href"), "#makers");
        const res = await page.request.get(`${BASE}assets/blanks/blanks.json`);
        assert.equal(res.status(), 404, "no shirt photos");
      });

      await step(`${tag}: the search palette finds images and pages`, async () => {
        await page.goto(`${BASE}#home`);
        await page.waitForSelector(".kpis");
        await page.locator(".jump").click();
        await page.waitForSelector("#palette[open]");
        await page.fill("#pal-q", "pluff");
        await page.waitForFunction(() => document.querySelector("#pal-list button")?.textContent.includes("Pluff Mud Club"));
        await shot(page, `${tag}-palette`);
        await page.keyboard.press("Enter");
        await page.waitForSelector("dialog.sheet[open]");
        assert.match(await page.locator("dialog.sheet[open] h2").innerText(), /Pluff Mud Club/);
        await page.keyboard.press("Escape");
      });

      await step(`${tag}: the Go to menu reaches the console and every site from every page`, async () => {
        const want = ["claude.ai/artifact/U8rNeWMPq7NfF7f88AEuPK", "charleston3d.com", "app.charleston3d.com",
          "claude.ai/artifact/", "docs.google.com/spreadsheets/"];
        for (const r of ["home", "library", "makers"]) {
          await page.goto(`${BASE}#${r}`);
          await page.locator(".go-btn").click();
          await page.waitForSelector("#go-menu:popover-open");
          const hrefs = await page.locator("#go-menu a").evaluateAll((as) => as.map((a) => [a.href, a.target, a.rel]));
          for (const w of want) assert.ok(hrefs.some(([h]) => h.includes(w)), `${r}: Go to is missing ${w}`);
          assert.ok(!hrefs.some(([h]) => h.includes("elevatedshirts")), `${r}: Go to links a shirt site`);
          for (const [h, t, rel] of hrefs) { assert.match(h, /^https:\/\//); assert.equal(t, "_blank"); assert.match(rel, /noopener/); }
          const box = await page.locator("#go-menu").boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width, `${r}: Go to menu runs off the screen`);
          if (r === "home") await shot(page, `${tag}-go-to`);
          await page.keyboard.press("Escape");
          assert.equal(await page.locator("#go-menu:popover-open").count(), 0);
        }
        await page.locator(".jump").click();
        await page.fill("#pal-q", "order app");
        await page.waitForFunction(() => document.querySelector("#pal-list button")?.textContent.includes("Charleston 3D order app"));
        await page.keyboard.press("Escape"); // the first Escape clears the search box, the second closes the palette
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#palette[open]").count(), 0);
      });

      await step(`${tag}: Maker Studio holds every maker in tabs`, async () => {
        // Their own tab: the makers load three.js from public CDNs, which this test's sandbox may block,
        // so their script errors are not the studio's. This checks the studio, the tabs and the framing.
        const page = await ctx.newPage();
        await page.goto(`${BASE}#makers`);
        const studio = page.frameLocator("iframe.maker-frame");
        await studio.locator("#tabs a").first().waitFor();
        assert.equal(await studio.locator("#tabs a").count(), 5);
        assert.equal(await studio.locator(".back").isVisible(), false, "inside the studio, its sidebar is the way back");
        for (const [name, slug] of [["Nameplate", "nameplate"], ["Hype chain", "hype-chain"], ["Light box & keychain", "lightbox"], ["License plate", "license-plate"], ["Photo to 3D", "ai3d"]]) {
          await studio.locator("#tabs a", { hasText: name }).click();
          // The tab sets the frame's src from its click handler, so wait for it rather than read it at once.
          let src = null;
          for (let i = 0; i < 50 && src !== `${slug}/`; i++) { src = await studio.locator("#view").getAttribute("src"); if (src !== `${slug}/`) await page.waitForTimeout(100); }
          assert.equal(src, `${slug}/`);
          const maker = studio.frameLocator("#view");
          await maker.locator("body").waitFor();
          // The maker's own "Back to Design Studio" link goes once it's in the studio (polled: no page scripts under its policy).
          let gone = 0;
          for (let i = 0; i < 100 && gone < 3; i++) {
            gone = (await maker.locator("script").count()) && !(await maker.locator('a[href="/#makers"]').count()) ? gone + 1 : 0;
            await page.waitForTimeout(100);
          }
          assert.equal(gone, 3, `${slug}: the maker's back link still shows inside Maker Studio`);
          const res = await page.request.get(`${BASE}makers/${slug}/`);
          assert.equal(res.status(), 200);
          assert.match(res.headers()["content-security-policy"], /frame-ancestors 'self'/);
          assert.equal(res.headers()["x-frame-options"], "SAMEORIGIN");
          if (scheme === "light") await shot(page, `${tag}-${slug}`);
        }
        const alone = await ctx.newPage();
        await alone.goto(`${BASE}makers/#licenseplate`);
        assert.equal(await alone.locator(".back").getAttribute("aria-label"), "Back to Design Studio");
        assert.equal(await alone.locator('#tabs a[aria-current="page"]').innerText(), "License plate");
        await alone.close();
        const site = await page.request.get(BASE);
        assert.doesNotMatch(site.headers()["content-security-policy"], /cdnjs/); // the studio itself keeps the strict policy
        await page.close();
      });

      await step(`${tag}: a license plate order goes to the Charleston3D cart with its print file`, async () => {
        const page = await ctx.newPage();
        let post = null;
        await page.route("https://charleston3d.com/cart/add", async (r) => { post = r.request(); await r.fulfill({ status: 200, contentType: "text/html", body: "<p>cart</p>" }); });
        await page.goto(`${BASE}makers/license-plate/`);
        await page.waitForFunction(() => document.documentElement.dataset.ready === "1" && window.LPM.order());
        if (width <= 1180) { await page.locator('[data-tool="print"]').click(); }
        const btn = page.locator(width > 1180 ? ".props [data-order]" : ".print-extra [data-order]");
        await btn.waitFor({ state: "visible" });
        assert.equal(await btn.innerText(), "Request this print");
        if (scheme === "light") await shot(page, `${tag}-license-plate-order`);
        assert.equal(await page.locator(".bar-order").innerText(), "Request print");
        assert.ok(await page.locator(".bar-order").isVisible());
        await btn.click();
        await page.waitForURL("https://charleston3d.com/cart/add", { timeout: 30000 });
        const body = post.postDataBuffer().toString("latin1");
        assert.match(post.headers()["content-type"], /multipart\/form-data/);
        for (const f of ['name="id"', "4242", 'name="properties[Item]"', "License plate frame", 'name="properties[Text]"', "Charleston, SC",
          'name="properties[Print file]"; filename="plate-frame-charleston-sc-2-pieces-3mf.zip"', 'name="properties[Design preview]"', 'name="properties[_Source]"', 'name="return_to"'])
          assert.ok(body.includes(f), `order post is missing ${f}`);
        const res = await page.request.get(`${BASE}makers/license-plate/`);
        assert.match(res.headers()["content-security-policy"], /form-action 'self' https:\/\/charleston3d\.com/);
        await page.close();
      });

      await step(`${tag}: no horizontal scroll on any page`, async () => {
        for (const r of ["home", "library", "makers"]) {
          await page.goto(`${BASE}#${r}`);
          await page.waitForTimeout(250);
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(over <= 0, `${r} scrolls sideways by ${over}px`);
        }
      });

      if (width > 760) await step(`${tag}: the sidebar collapses to icons`, async () => {
        await page.goto(`${BASE}#home`);
        await page.locator(".side-toggle").click();
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains("side-min")), true);
        assert.ok((await page.locator(".side").boundingBox()).width < 80);
        await shot(page, `${tag}-collapsed`);
        await page.locator(".side-toggle").click();
      });

      await step(`${tag}: no script errors`, async () => { assert.deepEqual(errors, []); });
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} UI step(s) failed` : "\nAll UI steps passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
