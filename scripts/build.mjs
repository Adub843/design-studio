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

// Local SEO is city level only (CLAUDE.md rule 11): Charleston, SC, never a street, postcode or phone.
const AREAS = ["Charleston", "Mount Pleasant", "Summerville", "North Charleston", "West Ashley", "James Island", "Goose Creek", "Hanahan", "Daniel Island"];
const ORG = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": ["OnlineStore", "LocalBusiness"], "@id": `${SITE}/#org`, name: "EPIX3D", url: `${SITE}/`, logo: `${SITE}/assets/img/logo.png`, image: `${SITE}/assets/img/og.jpg`,
      slogan: "Design your own 3D prints, right in your browser.",
      description: "Online 3D print makers: design light boxes, keychains, name tags, signs, lithophanes, license plate frames, nameplates, hype chains and photo-to-3D models, then order a print made in Charleston, SC, or download the print files with Platinum.",
      address: { "@type": "PostalAddress", addressLocality: "Charleston", addressRegion: "SC", addressCountry: "US" },
      geo: { "@type": "GeoCoordinates", latitude: 32.7765, longitude: -79.9311 },
      areaServed: [...AREAS.map((name) => ({ "@type": "City", name: `${name}, SC` })), { "@type": "AdministrativeArea", name: "Lowcountry, South Carolina" }, { "@type": "Country", name: "United States" }],
      knowsAbout: ["3D printing", "Custom 3D printed gifts", "Lithophanes", "3D printed name tags", "3D printed keychains", "3D printed signs", "License plate frames", "Multi-colour 3D printing", "3MF files"],
      email: "hello@charleston3d.com", priceRange: "$$", currenciesAccepted: "USD" },
    { "@type": "WebSite", "@id": `${SITE}/#site`, name: "EPIX3D", url: `${SITE}/`, publisher: { "@id": `${SITE}/#org` }, inLanguage: "en-US" },
  ],
};
const ldScript = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
const crumbs = (items) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE}${p}` })) });

// The maker cards (site/makers.json), shared by the home page and the makers page.
const MAKERS = JSON.parse(fs.readFileSync(path.join(root, "site", "makers.json"), "utf8"));
export function makerCards(list = MAKERS, { heading = "h3" } = {}) {
  return list.map((m) => `<li class="mk tone-${esc(m.tone)}"><a href="${esc(m.href)}"><span class="mk-pic"><img src="${esc(m.img)}" alt="The ${esc(m.name.toLowerCase())} maker" width="600" height="400" loading="lazy" decoding="async"></span><span class="mk-body"><${heading} class="mk-name">${esc(m.name)}</${heading}><span class="mk-blurb">${esc(m.blurb)}</span><span class="mk-go">Start designing <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></span></a></li>`).join(String.fromCharCode(10));
}

// A compact list of every maker (the pricing page: "every plan includes every maker").
export function makerChips(list = MAKERS) {
  return `<ul class="mk-chips">${list.map((m) => `<li><a class="tone-${esc(m.tone)}" href="${esc(m.href)}"><i aria-hidden="true"></i>${esc(m.name)}</a></li>`).join("")}</ul>`;
}

// SEO for the maker pages (makers/<dir>/index.html are hand-made apps, so their tags are added here at
// build time): geo and social tags, meta robots, a hidden h1 where the app has none, and JSON-LD
// (WebApplication + BreadcrumbList). The Light box engine also runs the Keychain, Name tag, Sign and
// Lithophane makers (?mode=...): each mode gets its own copy with its own title, description and canonical
// in makers/lightbox/m/<mode>/, and the Worker serves that copy for /makers/lightbox/?mode=<mode>.
const ORDER_LINE = "Order a print from Charleston, SC, or download it with Platinum.";
export const MAKER_SEO = {
  "lightbox": { name: "Light box", title: "Light Box Maker: Custom 3D Printed Light Boxes | EPIX3D", h1: "Light box maker", desc: `Design a glowing 3D printed light box with your own pictures, text and shapes. ${ORDER_LINE}` },
  "keychain": { dir: "lightbox", mode: "keychain", name: "Keychain", title: "Custom Keychain Maker: 3D Printed Keychains | EPIX3D", h1: "Keychain maker", desc: `Turn a picture or a name into a multi-colour 3D printed keychain in your browser. ${ORDER_LINE}` },
  "nametag": { dir: "lightbox", mode: "nametag", name: "Name tag", title: "Name Tag Maker: Custom 3D Printed Name Tags | EPIX3D", h1: "Name tag maker", desc: `Design a two-colour 3D printed name tag for work, events or school bags in your browser. ${ORDER_LINE}` },
  "sign": { dir: "lightbox", mode: "sign", name: "Sign", title: "Custom Sign Maker: 3D Printed Signs | EPIX3D", h1: "Sign maker", desc: `Design raised-letter 3D printed signs for doors, desks and shelves in your browser. ${ORDER_LINE}` },
  "litho": { dir: "lightbox", mode: "litho", name: "Lithophane", title: "Lithophane Maker: Turn a Photo into a Lithophane | EPIX3D", h1: "Lithophane maker", desc: `Turn your photo into a 3D printed lithophane that glows when light shines through it. ${ORDER_LINE}` },
  "license-plate": { name: "License plate", title: "License Plate Frame Maker | EPIX3D", desc: `Design a custom license plate frame or novelty plate with your own text and colours. ${ORDER_LINE}` },
  "nameplate": { name: "Nameplate", title: "Nameplate Maker: Layered 3D Printed Nameplates | EPIX3D", desc: `Design a layered, multi-colour 3D printed nameplate from a style or your own picture. ${ORDER_LINE}` },
  "hype-chain": { name: "Hype chain", title: "Hype Chain Maker: Custom 3D Printed Pendants | EPIX3D", h1: "Hype chain maker", desc: `Turn a logo or your own text into a chunky 3D printed pendant with a printed chain. ${ORDER_LINE}` },
  "ai3d": { name: "Photo to 3D", title: "Photo to 3D Model Maker | EPIX3D", h1: "Photo to 3D maker", desc: `Turn a photo of one object into a printable 3D model; the photo stays on your device. ${ORDER_LINE}` },
};
export const makerUrl = (id) => { const m = MAKER_SEO[id]; return m.mode ? `/makers/lightbox/?mode=${m.mode}` : `/makers/${id}/`; };
const SR = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";
const setTag = (html, re, value) => { if (!re.test(html)) throw new Error(`maker SEO: ${re} not found`); return html.replace(re, (_, a, b) => `${a}${esc(value)}${b}`); };
export function makerSeo(html, id) {
  const m = MAKER_SEO[id];
  const url = `${SITE}${makerUrl(id)}`;
  html = setTag(html, /(<title>)[^<]*(<\/title>)/, m.title);
  html = setTag(html, /(<meta name="description" content=")[^"]*(">)/, m.desc);
  html = setTag(html, /(<link rel="canonical" href=")[^"]*(">)/, url);
  html = setTag(html, /(<meta property="og:title" content=")[^"]*(">)/, m.title);
  html = setTag(html, /(<meta property="og:description" content=")[^"]*(">)/, m.desc);
  html = setTag(html, /(<meta property="og:url" content=")[^"]*(">)/, url);
  const app = { "@context": "https://schema.org", "@type": "WebApplication", "@id": `${url}#app`, name: `${m.name} maker`, url, description: m.desc,
    applicationCategory: "DesignApplication", operatingSystem: "Any (runs in a web browser)", browserRequirements: "Requires a browser with WebGL",
    isAccessibleForFree: true, inLanguage: "en-US", image: `${SITE}/assets/img/og.jpg`, provider: { "@id": `${SITE}/#org` }, publisher: { "@id": `${SITE}/#org` },
    offers: [{ "@type": "Offer", name: "Free: design, save and order prints", price: "0", priceCurrency: "USD" },
      { "@type": "Offer", name: "EPIX3D Platinum: print file downloads", price: "15.00", priceCurrency: "USD", url: `${SITE}/pricing/` }] };
  const head = [
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta name="geo.region" content="US-SC"><meta name="geo.placename" content="Charleston"><meta name="geo.position" content="32.7765;-79.9311"><meta name="ICBM" content="32.7765, -79.9311">',
    '<meta property="og:locale" content="en_US"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="3D printed name tags, a keychain and a lithophane made with EPIX3D">',
    `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(m.title)}"><meta name="twitter:description" content="${esc(m.desc)}"><meta name="twitter:image" content="${SITE}/assets/img/og.jpg">`,
    '<link rel="apple-touch-icon" href="/assets/img/logo.png">',
    ldScript({ "@context": "https://schema.org", "@graph": [ORG["@graph"][0]] }), ldScript(app),
    ldScript(crumbs([["Home", "/"], ["Makers", "/makers/"], [m.name, makerUrl(id)]])),
  ].join("\n");
  if (html.split("</head>").length !== 2) throw new Error(`maker SEO: ${id} needs exactly one </head>`);
  html = html.replace("</head>", `${head}\n</head>`);
  if (!/<h1[\s>]/.test(html)) html = html.replace(/<body([^>]*)>/, `<body$1><h1 style="${SR}">${esc(m.h1 || `${m.name} maker`)}</h1>`);
  if (m.mode) html = html.replace(/<h1 style="[^"]*">[^<]*<\/h1>/, `<h1 style="${SR}">${esc(m.h1)}</h1>`);
  return html;
}

export function renderPage(layout, page) {
  const url = `${SITE}${page.path}`;
  const extra = Array.isArray(page.jsonld) ? page.jsonld : page.jsonld ? [page.jsonld] : [];
  const trail = page.path === "/" || page.path === "/404" || page.index === false ? [] : [crumbs([["Home", "/"], [page.crumb || page.title.split(/ [|:] /)[0], page.path]])];
  const list = page.path === "/" || page.path === "/makers/" ? [{ "@context": "https://schema.org", "@type": "ItemList", name: "EPIX3D 3D print makers",
    itemListElement: Object.keys(MAKER_SEO).map((id, i) => ({ "@type": "ListItem", position: i + 1, name: `${MAKER_SEO[id].name} maker`, url: `${SITE}${makerUrl(id)}` })) }] : [];
  const ld = [ORG, ...extra, ...list, ...trail].map(ldScript).join("\n");
  const nav = (key) => (page.nav === key ? ' aria-current="page"' : "");
  return layout
    .replaceAll("{{title}}", esc(page.title))
    .replaceAll("{{description}}", esc(page.description))
    .replaceAll("{{url}}", esc(url))
    .replaceAll("{{robots}}", page.index === false ? "noindex" : "index, follow, max-image-preview:large")
    .replaceAll("{{bodyClass}}", esc(page.bodyClass ?? ""))
    .replace("{{jsonld}}", () => ld)
    .replace(/\{\{nav:([a-z]+)\}\}/g, (_, k) => nav(k))
    .replace("{{body}}", () => page.body.replace("{{makers}}", () => makerCards()).replace("{{makerChips}}", () => makerChips()));
}

// Search engines and AI assistants are welcome (search, answers and training), each named so a later
// default change on their side can't shut them out. Every group repeats the private paths.
export const CRAWLERS = ["Googlebot", "Bingbot", "Applebot", "DuckDuckBot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User",
  "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Amazonbot", "meta-externalagent", "CCBot", "cohere-ai", "MistralAI-User"];
const PRIVATE = ["/api/", "/files/", "/account/", "/projects/", "/makers/lightbox/m/"];
export function robotsTxt() {
  const group = (ua) => `User-agent: ${ua}\nAllow: /\n${PRIVATE.map((p) => `Disallow: ${p}`).join("\n")}\n`;
  return `# EPIX3D (${SITE}): design your own 3D prints online. Search engines and AI assistants are welcome.\n# A summary for AI assistants: ${SITE}/llms.txt\n\n${["*", ...CRAWLERS].map(group).join("\n")}\nSitemap: ${SITE}/sitemap.xml\n`;
}

function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist);
  for (const f of ["assets", "makers"]) fs.cpSync(path.join(root, f), path.join(dist, f), { recursive: true });
  for (const [id, m] of Object.entries(MAKER_SEO)) {
    const src = fs.readFileSync(path.join(root, "makers", m.dir || id, "index.html"), "utf8").replace(/\r\n/g, "\n");
    const out = m.mode ? path.join(dist, "makers", "lightbox", "m", m.mode, "index.html") : path.join(dist, "makers", id, "index.html");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, makerSeo(src, id));
  }
  const layout = fs.readFileSync(path.join(root, "site", "layout.html"), "utf8").replace(/\r\n/g, "\n");
  const pages = readPages();
  for (const p of pages) {
    const out = p.path === "/404" ? path.join(dist, "404.html") : path.join(dist, p.path, "index.html");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, renderPage(layout, p));
  }
  const today = new Date().toISOString().slice(0, 10);
  const listed = [...pages.filter((p) => p.index !== false && p.path !== "/404").map((p) => ({ loc: p.path, pri: p.priority ?? 0.6 })),
    ...Object.keys(MAKER_SEO).map((id) => ({ loc: makerUrl(id).replace("&", "&amp;"), pri: 0.8 }))];
  fs.writeFileSync(path.join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed.map((u) => `  <url><loc>${SITE}${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.pri}</priority></url>`).join("\n")}\n</urlset>\n`);
  fs.writeFileSync(path.join(dist, "robots.txt"), robotsTxt());
  fs.copyFileSync(path.join(root, "site", "llms.txt"), path.join(dist, "llms.txt"));
  // The maker list for the "All makers" switcher on every maker (assets/epix-bridge.js).
  fs.writeFileSync(path.join(dist, "assets", "makers.json"), JSON.stringify(MAKERS.map(({ id, name, href, tone, blurb }) => ({ id, name, href, tone, blurb }))));
  console.log(`Built dist/: ${pages.length} pages, assets/, makers/, sitemap.xml (${listed.length} URLs), robots.txt, llms.txt`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
