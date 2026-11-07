// Browser test for the Photo to 3D Maker, through the real Worker (its security headers included):
// photo -> cut-out -> 3D engine -> print prep -> 3MF, at 1280 and 390 wide.
// The real engine is 485 MB on Hugging Face, so a stand-in with the same inputs, outputs and files
// (scripts/fixtures/photo3d, made by make_fake_models.py) answers instead. ONNX Runtime and three.js come
// from local npm copies: ORT_DIST=<onnxruntime-web@1.30.0>/dist THREE_PKG=<three@0.128.0>.
// Run: npm run build && ORT_DIST=... THREE_PKG=... NODE_PATH=$(npm root -g) node scripts/test-photo3d.cjs
const { chromium } = require("playwright");
const http = require("node:http"), path = require("node:path"), fs = require("node:fs"), assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, ".."), DIST = path.join(ROOT, "dist"), FIX = path.join(__dirname, "fixtures/photo3d");
const ORT = process.env.ORT_DIST, THREE = process.env.THREE_PKG, SCREENS = process.env.SCREENS || "";
if (!ORT || !THREE) { console.log("skip - set ORT_DIST and THREE_PKG to run the Photo to 3D browser test"); process.exit(0); }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const ASSETS = { async fetch(req) {
  let p = decodeURIComponent(new URL(req.url).pathname); if (p.endsWith("/")) p += "index.html";
  const file = path.join(DIST, path.normalize(p));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" } });
} };
const outside = (url) => {
  if (url.includes("onnxruntime-web@1.30.0/dist/")) return path.join(ORT, url.split("/dist/")[1].split("?")[0]);
  if (url.includes("huggingface.co/cgb/triposr-onnx-webgpu/resolve/main/")) return path.join(FIX, url.split("/resolve/main/")[1]);
  if (/three(\.js\/r128|@0\.128\.0\/build)\/three\.min\.js/.test(url)) return path.join(THREE, "build/three.min.js");
  if (url.includes("examples/js/controls/OrbitControls.js")) return path.join(THREE, "examples/js/controls/OrbitControls.js");
  return null;
};
(async () => {
  const { handleRequest } = await import(path.join(ROOT, "worker/index.mjs"));
  const server = http.createServer(async (req, res) => {
    const r = await handleRequest(new Request(`http://${req.headers.host}${req.url}`), { ASSETS });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const BASE = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  let failures = 0;
  for (const [w, h] of [[1280, 860], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|onnxruntime:/.test(m.text())) errors.push(m.text()); });
    await page.route(/^https:\/\//, async (route) => {
      const f = outside(route.request().url());
      if (f && fs.existsSync(f)) return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", "access-control-allow-origin": "*" } });
      return route.abort();
    });
    try {
      // through Maker Studio's tab, the way customers get there
      await page.goto(BASE + "makers/#photo3d");
      const frame = await (await page.waitForSelector('iframe[src="ai3d/"]')).contentFrame();
      await frame.waitForSelector("#emptyAdd");
      if (SCREENS) await page.screenshot({ path: path.join(SCREENS, `photo3d-start-${w}.png`) });
      await frame.setInputFiles("#file", path.join(FIX, "photo.jpg"));
      await frame.click("#make");
      await frame.waitForFunction(() => !document.getElementById("result").hidden, null, { timeout: 240000 });
      const facts = await frame.evaluate(() => document.getElementById("facts").innerText);
      assert.match(facts, /60\.0/, "longest side is the default 60 mm");
      const checks = await frame.evaluate(() => document.getElementById("checks").innerText);
      assert.match(checks, /Solid and watertight/);
      const dl = page.waitForEvent("download");
      await frame.evaluate(() => document.getElementById("dl3mf").click());
      const d = await dl; assert.match(d.suggestedFilename(), /^photo-60mm\.3mf$/);
      await page.waitForTimeout(600);
      if (SCREENS) await page.screenshot({ path: path.join(SCREENS, `photo3d-result-${w}.png`) });
      if (w === 390) { await frame.click('.ed-rail button[data-tool="print"]'); await page.waitForTimeout(300); if (SCREENS) await page.screenshot({ path: path.join(SCREENS, "photo3d-print-390.png") }); }
      assert.deepEqual(errors, []);
      console.log(`ok - photo to 3MF at ${w} wide`);
    } catch (e) { failures++; console.log(`not ok - photo to 3MF at ${w} wide\n  ${String(e.stack || e).split("\n").slice(0, 4).join("\n  ")}\n  page errors: ${JSON.stringify(errors)}`); }
    await page.close();
  }
  await browser.close(); server.close();
  process.exit(failures ? 1 : 0);
})();
