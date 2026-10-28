// The Design Studio shell. The layout takes the best of the top-ranked dashboards:
// - a collapsible icon sidebar with one primary action (shadcn/Linear),
// - a top bar with the brand switcher and a jump-anywhere search (Shopify Polaris store switcher, command palette),
// - page headers with the title on the left and actions on the right (Polaris),
// - quiet cards, stat tiles and resource lists (Tabler),
// - a full-width product editor: tool rail, canvas, properties, bottom bar on phones (Canva, Printful).
import { el, store, toast } from "./util.js";
import { BRANDS, BRAND_KEYS, currentBrand, setBrand, onBrand, brandName } from "./brands.js";
import { consoleKey, askForKey, onKeyChange } from "./api.js";

export { el, store, toast };
export const CONSOLE_URL = "https://business-console.business-console.workers.dev";
export const HQ_URL = "https://claude.ai/artifact/U8rNeWMPq7NfF7f88AEuPK";
// Everywhere the team works, one click from any page: the Go to menu in the top bar and the jump palette.
export const GO_TO = [
  { group: "Back office", links: [
    { label: "Creative Lab Studios", note: "Main console: team, marketing, Holo, money", url: HQ_URL, icon: "console" },
    { label: "Store engine", note: "Price sync, Shopify publishing, promotions", url: CONSOLE_URL, icon: "console" }] },
  { group: "Sites", links: [
    { label: "Charleston 3D shop", note: "charleston3d.com", url: "https://charleston3d.com", icon: "store" },
    { label: "Charleston 3D order app", note: "app.charleston3d.com", url: "https://app.charleston3d.com", icon: "phone" },
    { label: "Elevated Designs shop", note: "elevatedshirts.com", url: "https://elevatedshirts.com", icon: "store" },
    { label: "Elevated Designs shirt app", note: "design.elevatedshirts.com", url: "https://design.elevatedshirts.com", icon: "phone" }] },
  { group: "Reference", links: [
    { label: "Accounts and connections", note: "Every account and what connects to what", url: "https://claude.ai/artifact/Xek7W6RMuhNjUHaPmoRtuY", icon: "map" },
    { label: "Master links", note: "Every link in one sheet", url: "https://docs.google.com/spreadsheets/d/11SqwifuaDQjHgIGcuaZNRkdkG7JxfQacmT-7sEAH7Y4/edit", icon: "list" }] },
];

// ---------- icons (one stroke set, no emoji) ----------
const SVG_NS = "http://www.w3.org/2000/svg";
const PATHS = {
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
  designer: "M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3c-1 2-2.3 3-4 3S9 5 8 3z",
  library: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  console: "M4 5h16v11H4zM8 20h8M12 16v4",
  theme: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18",
  lock: "M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z",
  unlock: "M7 11V8a5 5 0 019.6-2M5 11h14v9H5z",
  collapse: "M15 6l-6 6 6 6",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  close: "M6 6l12 12M18 6L6 18",
  makers: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  apps: "M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z",
  store: "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6",
  phone: "M8 3h8v18H8zM11 18h2",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  out: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  drive: "M3 7h18v10H3zM3 12h18M7 15h.01M11 15h.01",
};
export const icon = (name, cls = "ico") => {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", cls);
  s.innerHTML = `<path d="${PATHS[name]}"/>`;
  return s;
};

// ---------- pages ----------
export const PAGES = [
  { route: "home", label: "Home", short: "Home", icon: "home", load: () => import("./home.js").then((m) => m.renderHome()) },
  { route: "designer", label: "Shirt designer", short: "Design", icon: "designer", load: () => import("./studio.js").then((m) => m.renderDesigner()) },
  { route: "library", label: "Library", short: "Library", icon: "library", load: () => import("./library.js").then((m) => m.renderLibrary()) },
  { route: "drive", label: "E: drive", short: "E: drive", icon: "drive", load: () => import("./drive.js").then((m) => m.renderDrive()) },
  { route: "makers", label: "3D makers", short: "Makers", icon: "makers", load: () => import("./makers.js").then((m) => m.renderMakers()) },
];

// A Polaris-style page header: where you are, the title, and the page's actions on the right.
export function pageHeader(eyebrow, title, sub, actions = []) {
  return el("header", { class: "page-head" },
    el("div", { class: "stack" }, el("span", { class: "eyebrow" }, eyebrow), el("h1", {}, title), sub ? el("p", { class: "muted" }, sub) : null),
    el("div", { class: "row" }, actions));
}
export const go = (route) => { if (location.hash.slice(1) === route) render(); else location.hash = route; };

// ---------- sidebar ----------
const side = document.getElementById("side");
const collapsed = () => document.documentElement.classList.contains("side-min");
const applyCollapse = (v) => document.documentElement.classList.toggle("side-min", v);
applyCollapse(store.get("ds-side-min", false));
side.append(
  el("a", { class: "logo", href: "#home" }, el("span", { class: "logo-mark", "aria-hidden": "true" }, "DS"), el("span", { class: "side-label" }, "Design Studio")),
  el("a", { class: "btn primary side-new", href: "#designer", title: "New design" }, icon("plus"), el("span", { class: "side-label" }, "New design")),
  el("nav", { class: "side-nav", "aria-label": "Studio" }, PAGES.map((p) =>
    el("a", { class: "nav", href: `#${p.route}`, "data-route": p.route, title: p.label }, icon(p.icon),
      el("span", { class: "nav-long side-label" }, p.label), el("span", { class: "nav-short", "aria-hidden": "true" }, p.short)))),
  el("div", { class: "side-foot" },
    el("a", { class: "nav", href: HQ_URL, target: "_blank", rel: "noopener", title: "Creative Lab Studios console" }, icon("console"), el("span", { class: "side-label" }, "Main console")),
    el("button", { class: "nav", type: "button", id: "theme", title: "Switch light or dark" }, icon("theme"), el("span", { class: "side-label" }, "Theme")),
    el("button", { class: "nav side-toggle", type: "button", "aria-label": "Collapse the sidebar", "aria-expanded": String(!collapsed()),
      onclick: (e) => { const v = !collapsed(); applyCollapse(v); store.set("ds-side-min", v); e.currentTarget.setAttribute("aria-expanded", String(!v)); } },
      icon("collapse"), el("span", { class: "side-label" }, "Collapse"))));

// ---------- theme ----------
const applyTheme = (t) => (t ? document.documentElement.setAttribute("data-theme", t) : document.documentElement.removeAttribute("data-theme"));
applyTheme(store.get("ds-theme", null));
document.getElementById("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";
  applyTheme(next); store.set("ds-theme", next);
});

// ---------- top bar: brand switcher, jump, key ----------
const top = document.getElementById("top");
const brandSeg = el("div", { class: "brand-seg", role: "group", "aria-label": "Brand" },
  ["all", ...BRAND_KEYS].map((k) => el("button", { type: "button", class: `bs bs-${k}`, "data-brand": k, onclick: () => setBrand(k) },
    k === "all" ? null : el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "bs-long" }, brandName(k)),
    el("span", { class: "bs-short", "aria-hidden": "true" }, k === "all" ? "All" : BRANDS[k].short))));
const paintBrand = () => brandSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.brand === currentBrand())));
paintBrand();
onBrand(paintBrand);
const keyBtn = el("button", { class: "btn ghost key-btn", type: "button", onclick: async () => {
  if (consoleKey.get()) { consoleKey.clear(); toast("Locked. Private images are hidden on this device."); render(); return; }
  if (await askForKey("The studio key shows private images and lets you upload, change and delete. It's the same CONSOLE_KEY as the Business Console.")) render();
} });
const paintKey = () => keyBtn.replaceChildren(icon(consoleKey.get() ? "unlock" : "lock"), el("span", { class: "key-label" }, consoleKey.get() ? "Unlocked" : "Unlock"));
paintKey();
onKeyChange(paintKey);
const goMenu = el("div", { class: "go-menu", id: "go-menu", popover: "auto", role: "menu", "aria-label": "Go to" },
  GO_TO.map((g) => el("div", { class: "go-group" }, el("span", { class: "eyebrow" }, g.group),
    g.links.map((l) => el("a", { class: "go-link", href: l.url, target: "_blank", rel: "noopener", role: "menuitem",
      onclick: () => goMenu.hidePopover?.() },
      icon(l.icon), el("span", { class: "stack" }, el("span", { class: "go-label" }, l.label), el("span", { class: "muted small" }, l.note)),
      icon("out", "ico go-out"))))));
const goBtn = el("button", { class: "btn ghost go-btn", type: "button", popovertarget: "go-menu", "aria-haspopup": "menu", title: "Go to the console and every site" },
  icon("apps"), el("span", { class: "go-btn-label" }, "Go to"));
top.append(brandSeg,
  el("button", { class: "jump", type: "button", onclick: () => openPalette() }, icon("search"), el("span", { class: "jump-label" }, "Search or jump to…"), el("kbd", {}, "/")),
  goBtn, keyBtn);
document.body.append(goMenu);

// ---------- jump palette: pages, brands, actions and library images ----------
const pal = document.getElementById("palette");
const palQ = document.getElementById("pal-q");
const palList = document.getElementById("pal-list");
let palImages = [];
function palItems(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = [
    ...PAGES.map((p) => ({ name: p.label, kind: "Page", run: () => go(p.route) })),
    ...["all", ...BRAND_KEYS].map((k) => ({ name: `Show ${brandName(k)}`, kind: "Brand", run: () => setBrand(k) })),
    { name: "Upload art", kind: "Action", run: () => { store.set("ds-open-upload", true); go("library"); } },
    ...GO_TO.flatMap((g) => g.links.map((l) => ({ name: l.label, kind: g.group, run: () => window.open(l.url, "_blank", "noopener") }))),
    { name: "Switch light or dark", kind: "Action", run: () => document.getElementById("theme").click() },
    ...palImages.map((i) => ({ name: i.name, kind: `Image · ${brandName(i.brand ?? "ed")}`, run: () => { store.set("ds-focus-image", i.key); go("library"); } })),
  ];
  return all.filter((i) => words.every((w) => i.name.toLowerCase().includes(w) || i.kind.toLowerCase().includes(w))).slice(0, 12);
}
function drawPal() {
  const items = palItems(palQ.value);
  palList.replaceChildren(...items.map((i, n) => el("li", { role: "option", "aria-selected": String(n === 0) },
    el("button", { type: "button", onclick: () => { pal.close(); i.run(); } }, el("span", {}, i.name), el("span", { class: "muted pal-kind" }, i.kind)))));
  if (!items.length) palList.append(el("li", { class: "muted" }, "Nothing matches."));
}
export async function openPalette() {
  palQ.value = ""; drawPal(); pal.showModal(); palQ.focus();
  try { palImages = await (await import("./studio.js")).listImages(); drawPal(); } catch { /* images are optional here */ }
}
palQ.addEventListener("input", drawPal);
palQ.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); palList.querySelector("button")?.click(); } });
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "/" && !typing && !pal.open) { e.preventDefault(); openPalette(); }
});

// ---------- router ----------
const view = document.getElementById("view");
let rendering = 0;
export async function render() {
  const route = PAGES.some((p) => p.route === location.hash.slice(1)) ? location.hash.slice(1) : "home";
  const page = PAGES.find((p) => p.route === route);
  document.querySelectorAll(".nav[data-route]").forEach((a) => a.dataset.route === route ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  document.documentElement.dataset.route = route;
  const n = ++rendering;
  let nodes;
  try { nodes = await page.load(); }
  catch (e) { console.error(e); nodes = el("p", { class: "muted" }, "This page couldn't load. Refresh to try again."); }
  if (n !== rendering) return; // a newer page was asked for while this one loaded
  view.replaceChildren(...[nodes].flat().filter(Boolean));
  document.title = `${page.label} · Design Studio`;
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
addEventListener("hashchange", render);
// Home and Library follow the brand switcher; the designer redraws its own library in place.
onBrand(() => { if (document.documentElement.dataset.route !== "designer") render(); });
render();
