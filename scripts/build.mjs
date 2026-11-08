// Builds dist/, which is all the Worker serves as files:
//   - the site pages: site/pages/*.html, each wrapped in site/layout.html (header, footer, SEO tags)
//   - assets/ and makers/ as they are
//   - sitemap.xml, robots.txt and llms.txt, made from the same page list
// lib/, scripts/, worker/, site/ sources, package.json and the README are never downloadable.
// Plain Node, so it works the same on Windows, macOS and Linux. wrangler runs it before dev and deploy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
export const SITE = "https://epix3d.com";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Each page starts with a JSON comment: path, title, description, nav (which menu item it is), index (sitemap).
export function readPages(dir = path.join(root, "site", "pages")) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".html")).sort().map((f) => {
    const src = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
    const m = src.match(/^<!--(\{[\s\S]*?\})-->\n/);
    if (!m) throw new Error(`${f}: missing the page settings comment`);
    return { file: f, ...JSON.parse(m[1]), body: src.slice(m[0].length) };
  });
}

const ORG = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE}/#org`, name: "EPIX3D", url: `${SITE}/`, logo: `${SITE}/assets/img/logo.png`,
      description: "Online 3D print makers: design light boxes, keychains, name tags, signs, lithophanes, license plate frames, nameplates, hype chains and photo-to-3D models, then order a print made in Charleston, SC.",
      areaServed: "US", address: { "@type": "PostalAddress", addressLocality: "Charleston", addressRegion: "SC", addressCountry: "US" }, email: "hello@charleston3d.com" },
    { "@type": "WebSite", "@id": `${SITE}/#site`, name: "EPIX3D", url: `${SITE}/`, publisher: { "@id": `${SITE}/#org` }, inLanguage: "en-US" },
  ],
};

// The maker cards (site/makers.json), shared by the home page and the makers page.
const MAKERS = JSON.parse(fs.readFileSync(path.join(root, "site", "makers.json"), "utf8"));
export function makerCards(list = MAKERS, { heading = "h3" } = {}) {
  return list.map((m) => `<li class="mk tone-${esc(m.tone)}"><a href="${esc(m.href)}"><span class="mk-pic"><img src="${esc(m.img)}" alt="The ${esc(m.name.toLowerCase())} maker" width="600" height="400" loading="lazy" decoding="async"></span><span class="mk-body"><${heading} class="mk-name">${esc(m.name)}</${heading}><span class="mk-blurb">${esc(m.blurb)}</span><span class="mk-go">Start designing <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></span></a></li>`).join(String.fromCharCode(10));
}

// A compact list of every maker (the pricing page: "every plan includes every maker").
export function makerChips(list = MAKERS) {
  return `<ul class="mk-chips">${list.map((m) => `<li><a class="tone-${esc(m.tone)}" href="${esc(m.href)}"><i aria-hidden="true"></i>${esc(m.name)}</a></li>`).join("")}</ul>`;
}

export function renderPage(layout, page) {
  const url = `${SITE}${page.path}`;
  const ld = [ORG, ...(page.jsonld ? [page.jsonld] : [])].map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n");
  const nav = (key) => (page.nav === key ? ' aria-current="page"' : "");
  return layout
    .replaceAll("{{title}}", esc(page.title))
    .replaceAll("{{description}}", esc(page.description))
    .replaceAll("{{url}}", esc(url))
    .replaceAll("{{robots}}", page.index === false ? "noindex" : "index, follow")
    .replaceAll("{{bodyClass}}", esc(page.bodyClass ?? ""))
    .replace("{{jsonld}}", ld)
    .replace(/\{\{nav:([a-z]+)\}\}/g, (_, k) => nav(k))
    .replace("{{body}}", page.body.replace("{{makers}}", makerCards()).replace("{{makerChips}}", makerChips()));
}

function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist);
  for (const f of ["assets", "makers"]) fs.cpSync(path.join(root, f), path.join(dist, f), { recursive: true });
  const layout = fs.readFileSync(path.join(root, "site", "layout.html"), "utf8").replace(/\r\n/g, "\n");
  const pages = readPages();
  for (const p of pages) {
    const out = p.path === "/404" ? path.join(dist, "404.html") : path.join(dist, p.path, "index.html");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderPage(layout, p));
  }
  const today = new Date().toISOString().slice(0, 10);
  const listed = [...pages.filter((p) => p.index !== false && p.path !== "/404").map((p) => ({ loc: p.path, pri: p.priority ?? 0.6 })),
    ...MAKERS.filter((m) => !m.href.includes("?")).map((m) => ({ loc: m.href, pri: 0.8 }))];
  fs.writeFileSync(path.join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed.map((u) => `  <url><loc>${SITE}${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.pri}</priority></url>`).join("\n")}\n</urlset>\n`);
  fs.writeFileSync(path.join(dist, "robots.txt"), `# EPIX3D: design your own 3D prints online. Crawlers and AI assistants are welcome.\nUser-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /files/\nDisallow: /account/\nDisallow: /projects/\n\nSitemap: ${SITE}/sitemap.xml\n`);
  fs.copyFileSync(path.join(root, "site", "llms.txt"), path.join(dist, "llms.txt"));
  // The maker list for the "All makers" switcher on every maker (assets/epix-bridge.js).
  fs.writeFileSync(path.join(dist, "assets", "makers.json"), JSON.stringify(MAKERS.map(({ id, name, href, tone, blurb }) => ({ id, name, href, tone, blurb }))));
  console.log(`Built dist/: ${pages.length} pages, assets/, makers/, sitemap.xml (${listed.length} URLs), robots.txt, llms.txt`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
