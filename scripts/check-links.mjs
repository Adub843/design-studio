// Link check for the built site: every same-site link, script, stylesheet and picture in dist/ must point
// at a file that exists. Run after `npm run build`: npm run check:links
// (/api/, /files/ and /hq are served by the Worker, not files, so they are skipped.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (!fs.existsSync(dist)) { console.error("Run npm run build first."); process.exit(1); }
const html = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".html")) html.push(p); } })(dist);

const exists = (url, from) => {
  let p = url.split("#")[0].split("?")[0];
  if (!p) return true;
  if (!p.startsWith("/")) p = path.posix.join(path.posix.dirname("/" + path.relative(dist, from).split(path.sep).join("/")), p);
  if (/^\/(api|files)\//.test(p) || p === "/hq") return true;
  const f = path.join(dist, decodeURIComponent(p));
  return p.endsWith("/") ? fs.existsSync(path.join(f, "index.html")) : fs.existsSync(f) || fs.existsSync(path.join(f, "index.html"));
};

let bad = 0, n = 0;
for (const f of html) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|tel:|data:|blob:|javascript:|#|\$\{)/.test(u) || u.includes("${")) continue;
    n++;
    if (!exists(u, f)) { bad++; console.log(`broken: ${path.relative(dist, f)} -> ${u}`); }
  }
}
const makers = JSON.parse(fs.readFileSync(path.join(dist, "assets", "makers.json"), "utf8"));
for (const m of makers) { n++; if (!exists(m.href, path.join(dist, "index.html"))) { bad++; console.log(`broken maker link: ${m.name} -> ${m.href}`); } }
console.log(bad ? `\n${bad} broken of ${n} links` : `All ${n} links in ${html.length} pages point at real files`);
process.exit(bad ? 1 : 0);
