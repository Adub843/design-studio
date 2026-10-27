// The shirt designer and the image library calls it shares with the Home and Library pages.
// The library is the same one the shirt apps and the Business Console use. Anyone can browse and design with
// the public images (GET /api/images?public=1, no key); the studio key adds private images and is needed to
// upload, change or delete. Every image belongs to one brand, and the brand switcher narrows the library.
// Images live online (Cloudflare Workers KV). If that API can't be reached, uploads are kept in this browser.
// The shirt is a studio photo of a white blank (assets/blanks, the same photos as design.elevatedshirts.com):
// a color layer with the print on it, multiplied by the photo's shading, plus the photo shot in black.
import { el, store, toast } from "./util.js";
import { askForKey, consoleKey } from "./api.js";
import { confirmButton } from "./confirm.js";
import { BRANDS, currentBrand as currentBrandKey, uploadBrand, inBrand, brandName, onBrand, canBePublic } from "./brands.js";

const API = "/api/images";
const BLANKS = "assets/blanks/";
const PW = 12, PH = 16, DPI = 300; // print area in inches, the same as the shirt app
const STYLES = [["tee", "T-shirt"], ["fitted", "Fitted tee"], ["longsleeve", "Long sleeve"], ["tank", "Tank top"], ["crew", "Crewneck"], ["hoodie", "Hoodie"]];
const COLORS = [
  ["White", "#f6f6f4"], ["Natural", "#ece3d0"], ["Ash", "#d6d6d3"], ["Heather grey", "#a9abae"], ["Charcoal", "#3d3f43"],
  ["Black", "#1b1b1d"], ["Navy", "#1f2a44"], ["Royal", "#2a4fa0"], ["Carolina blue", "#7ba7d6"], ["Red", "#b3262e"],
  ["Maroon", "#5b1f2a"], ["Forest", "#2f4a34"], ["Military green", "#5b5f3f"], ["Sand", "#d9c7a3"], ["Gold", "#f2a900"], ["Light pink", "#f6cad6"],
];
// Fonts for the Text tool: Google Fonts the console already allows, loaded only when the Text tool is used.
const FONTS = [["Oswald", "600"], ["Bebas Neue", "400"], ["Anton", "400"], ["Montserrat", "800"], ["Inter", "700"],
  ["Playfair Display", "700"], ["Roboto Slab", "700"], ["Archivo Black", "400"], ["Permanent Marker", "400"], ["Pacifico", "400"]];
const INKS = [["White", "#ffffff"], ["Black", "#111111"], ["Navy", "#15223f"], ["Gold", "#b8892a"], ["Cream", "#f7f2e8"], ["Red", "#b3262e"], ["Teal", "#0e7c74"], ["Grey", "#8a8d93"]];
const loadedFonts = new Set();
async function loadFont(family, weight) {
  if (!loadedFonts.has(family)) {
    loadedFonts.add(family);
    document.head.append(el("link", { rel: "stylesheet", href: `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&display=swap` }));
  }
  try { await document.fonts.load(`${weight} 64px "${family}"`); } catch { /* falls back to the system font */ }
}
// Draws a text layer onto a canvas at any size, so the print file is sharp however big the text is.
function textCanvas(l, fontPx) {
  const lines = String(l.text || " ").split("\n");
  const c = document.createElement("canvas"), g = c.getContext("2d");
  const font = `${l.weight ?? 400} ${fontPx}px "${l.font}", system-ui, sans-serif`;
  const spacing = ((l.spacing ?? 0) / 100) * fontPx;
  const stroke = (l.outlineW ?? 0) / 100 * fontPx;
  const setup = () => { g.font = font; g.textAlign = "center"; g.textBaseline = "middle"; if ("letterSpacing" in g) g.letterSpacing = `${spacing}px`; };
  setup();
  const lineH = fontPx * 1.15, pad = Math.ceil(stroke + fontPx * 0.12);
  const wide = Math.max(...lines.map((t) => g.measureText(t).width), 1);
  c.width = Math.ceil(wide + pad * 2); c.height = Math.ceil(lines.length * lineH + pad * 2);
  setup();
  lines.forEach((t, i) => {
    const y = pad + lineH * (i + 0.5), x = c.width / 2;
    if (stroke > 0) { g.lineJoin = "round"; g.lineWidth = stroke * 2; g.strokeStyle = l.outline ?? "#000"; g.strokeText(t, x, y); }
    g.fillStyle = l.color ?? "#111"; g.fillText(t, x, y);
  });
  return c;
}
const textKey = (l) => JSON.stringify([l.text, l.font, l.weight, l.color, l.outline, l.outlineW, l.spacing]);
const textCache = new Map(); // layer id -> { key, src, ratio }
function textSrc(l) {
  const k = textKey(l), hit = textCache.get(l.id);
  if (hit?.key === k) return hit;
  const c = textCanvas(l, 160);
  const v = { key: k, src: c.toDataURL("image/png"), ratio: c.height / c.width };
  textCache.set(l.id, v);
  return v;
}
const isDark = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 140; };

// ---------- storage ----------
const keyHeader = () => { const k = consoleKey.get(); return k ? { "x-console-key": k } : {}; };

let localDb;
const db = () => localDb ??= new Promise((ok, fail) => {
  const req = indexedDB.open("bc-images", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("images", { keyPath: "key" });
  req.onsuccess = () => ok(req.result);
  req.onerror = () => fail(req.error);
});
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction("images", mode);
    const r = fn(t.objectStore("images"));
    t.oncomplete = () => ok(r?.result);
    t.onerror = () => fail(t.error);
  });
};
const localUrls = new Map();

async function listLocal() {
  try {
    const rows = (await tx("readonly", (s) => s.getAll())) ?? [];
    return rows.map(({ blob, ...m }) => {
      if (!localUrls.has(m.key)) localUrls.set(m.key, URL.createObjectURL(blob));
      return { ...m, local: true };
    });
  } catch { return []; }
}

// The online list can lag a minute behind uploads and deletes (Workers KV is eventually
// consistent), so this tab remembers its own recent changes and applies them to the list.
const RECENT_MS = 5 * 60 * 1000;
const recentAdds = new Map(), recentDeletes = new Map(); // key -> { item?, at }
const fresh = (m) => { for (const [k, v] of m) if (Date.now() - v.at > RECENT_MS) m.delete(k); return m; };

// "all" with a working console key, "public" (the shirt-app images) without one.
export let libraryScope = "public";
async function fetchList(withKey) {
  const res = await fetch(withKey ? API : `${API}?public=1`, { headers: { accept: "application/json", ...(withKey ? keyHeader() : {}) } });
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) return { status: res.status, items: null };
  return { status: res.status, items: (await res.json()).items ?? [] };
}
export async function listImages() {
  let cloud = null;
  try {
    if (consoleKey.get()) {
      const r = await fetchList(true);
      if (r.items) { cloud = r.items; libraryScope = "all"; }
      else if (r.status === 401 || r.status === 403) consoleKey.clear(); // a wrong key: fall back to the public list
    }
    if (!cloud) { const r = await fetchList(false); cloud = r.items; libraryScope = "public"; }
  } catch { /* offline or not deployed */ }
  cloud = (cloud ?? []).filter((i) => !fresh(recentDeletes).has(i.key));
  const seen = new Set(cloud.map((i) => i.key));
  for (const [k, { item }] of fresh(recentAdds)) if (!seen.has(k)) cloud.push(item);
  const local = await listLocal();
  return [...cloud, ...local].sort((a, b) => (b.added ?? 0) - (a.added ?? 0));
}

// Private items carry a signed link from the API; public ones load from /api/images/:key without the key.
export const imageUrl = (item) => item.local ? localUrls.get(item.key) : item.url ?? `${API}/${encodeURIComponent(item.key)}`;

export async function upload(file, tags, isPublic, brand = uploadBrand()) {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": file.type, "x-filename": file.name, "x-tags": tags, "x-brand": brand, ...(isPublic ? { "x-public": "1" } : {}), ...keyHeader() },
      body: file,
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error(res.status === 401 ? "Wrong or missing studio key." : "Uploads are off until CONSOLE_KEY is set for the studio."), { stop: true, key: res.status === 401 });
    if (res.ok) {
      const { item } = await res.json();
      recentAdds.set(item.key, { item, at: Date.now() });
      return { saved: "cloud", item };
    }
    if (res.status === 413 || res.status === 415) throw Object.assign(new Error((await res.json().catch(() => ({}))).error ?? res.statusText), { stop: true });
  } catch (e) { if (e.stop) throw e; }
  const item = { key: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name, type: file.type, size: file.size, tags, brand, added: Date.now() };
  await tx("readwrite", (s) => s.put({ ...item, blob: file }));
  return { saved: "local", item };
}

export async function remove(item) {
  if (item.local) {
    await tx("readwrite", (s) => s.delete(item.key));
    URL.revokeObjectURL(localUrls.get(item.key));
    localUrls.delete(item.key);
    return;
  }
  const res = await fetch(`${API}/${encodeURIComponent(item.key)}`, { method: "DELETE", headers: keyHeader() });
  if (!res.ok) throw new Error(res.status === 401 ? "Wrong or missing studio key." : "Couldn't delete that image.");
  recentAdds.delete(item.key);
  recentDeletes.set(item.key, { at: Date.now() });
}

// Changes an online image's name, tags, category, brand or whether the shirt apps show it.
export async function patchImage(item, patch) {
  if (item.local) throw new Error("This image is only in this browser. Upload it again to change it.");
  const res = await fetch(`${API}/${encodeURIComponent(item.key)}`, {
    method: "PATCH", headers: { "content-type": "application/json", accept: "application/json", ...keyHeader() }, body: JSON.stringify(patch),
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401) { consoleKey.clear(); throw Object.assign(new Error("Wrong or missing studio key."), { key: true }); }
  if (!res.ok) throw new Error(out.error ?? "Couldn't save that change.");
  recentAdds.set(item.key, { item: out.item, at: Date.now() });
  return out.item;
}

// ---------- shirt photos ----------
let blanksCfg;
const loadBlanks = () => blanksCfg ??= fetch(`${BLANKS}blanks.json`).then((r) => r.ok ? r.json() : Promise.reject(new Error("blanks"))).catch((e) => { blanksCfg = null; throw e; });
const photoUrl = (style, side, shade) => `${BLANKS}${style}-${side}${shade ? "-shade" : ""}.jpg`;
const loadImg = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error(src)); i.src = src; });

// ---------- icons (simple strokes, no emoji) ----------
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  library: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4",
  shirt: "M8 3l-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3c-1 2-2.3 3-4 3S9 5 8 3z",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3",
};
const icon = (name) => {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "ed-ico");
  s.innerHTML = `<path d="${ICONS[name]}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
};

// A small naming dialog (no browser prompt).
let nameDlg;
function askName(value) {
  if (!nameDlg) {
    const input = el("input", { class: "field", id: "dn-in", type: "text", maxlength: "60", required: true, autocomplete: "off" });
    const form = el("form", { method: "dialog", class: "stack" },
      el("h2", { id: "dn-title" }, "Save to the library"),
      el("label", { class: "stack", style: "gap:4px", for: "dn-in" }, "Design name", input),
      el("p", { class: "muted small" }, "The name becomes the file name and the starting listing title. It is saved as a private image, not shown in the shirt apps."),
      el("div", { class: "row", style: "justify-content:flex-end" }, el("button", { class: "btn", type: "button", onclick: () => nameDlg.close("") }, "Cancel"),
        el("button", { class: "btn primary", type: "submit" }, "Save")));
    nameDlg = el("dialog", { class: "palette keydlg", "aria-labelledby": "dn-title" }, form);
    form.addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (v) nameDlg.close(v); });
    document.body.append(nameDlg);
  }
  nameDlg.querySelector("#dn-in").value = value ?? "";
  nameDlg.returnValue = "";
  return new Promise((ok) => { nameDlg.addEventListener("close", () => ok(nameDlg.returnValue), { once: true }); nameDlg.showModal(); nameDlg.querySelector("#dn-in").select(); });
}

// ---------- page ----------
// Starts the designer on a given shirt style (the quick-start tiles on Home), keeping the art already placed.
export function startDesign(style) {
  if (!STYLES.some(([k]) => k === style)) return;
  store.set("bc-design-2", { ...store.get("bc-design-2", {}), style });
}

export async function renderDesigner() {
  const saved = store.get("bc-design-2", null);
  const state = {
    style: STYLES.some(([k]) => k === saved?.style) ? saved.style : "tee",
    side: saved?.side === "back" ? "back" : "front",
    color: saved?.color ?? COLORS[0][1],
    sides: { front: saved?.sides?.front ?? [], back: saved?.sides?.back ?? [] },
    sel: null, items: [], q: "", cat: "", tool: "library", shown: 120,
  };
  const layers = () => state.sides[state.side];
  // Undo and redo: every saved change to the layers is a step (up to 80).
  const snap = () => JSON.stringify(state.sides);
  const hist = { steps: [snap()], at: 0 };
  const undoBtn = el("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Undo", title: "Undo (Ctrl+Z)", disabled: true, onclick: () => stepHist(-1) }, icon("undo"));
  const redoBtn = el("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Redo", title: "Redo (Ctrl+Shift+Z)", disabled: true, onclick: () => stepHist(1) }, icon("redo"));
  const drawHist = () => { undoBtn.disabled = hist.at === 0; redoBtn.disabled = hist.at === hist.steps.length - 1; };
  const save = () => {
    const now = snap();
    if (now !== hist.steps[hist.at]) {
      hist.steps = hist.steps.slice(0, hist.at + 1); hist.steps.push(now);
      if (hist.steps.length > 80) hist.steps.shift();
      hist.at = hist.steps.length - 1; drawHist();
    }
    store.set("bc-design-2", { style: state.style, side: state.side, color: state.color, sides: state.sides });
  };
  function stepHist(d) {
    const to = hist.at + d;
    if (to < 0 || to >= hist.steps.length) return;
    hist.at = to; state.sides = JSON.parse(hist.steps[to]);
    if (!layers().some((l) => l.id === state.sel)) state.sel = null;
    store.set("bc-design-2", { style: state.style, side: state.side, color: state.color, sides: state.sides });
    drawHist(); drawStage();
  }
  const btn = (label, fn, cls = "btn", attrs = {}) => el("button", { class: cls, type: "button", onclick: fn, ...attrs }, label);

  // ----- canvas: the photo stack and the print area -----
  const tint = el("div", { class: "ed-tint" });
  const print = el("div", { class: "ed-print" });
  const shadeImg = el("img", { class: "ed-shade", alt: "", draggable: "false" });
  const baseImg = el("img", { class: "ed-base", alt: "", draggable: "false" });
  const photo = el("div", { class: "ed-photo", "aria-hidden": "true" }, tint, print, shadeImg, baseImg);
  const area = el("div", { class: "ed-area print-area", "aria-label": "Print area" });
  const stage = el("div", { class: "ed-stage" }, photo, area);
  const sideSeg = el("div", { class: "seg", role: "tablist", "aria-label": "Shirt side" });
  const sizeNote = el("span", { class: "muted small ed-size" });

  // ----- tool panels -----
  const fileIn = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml", multiple: true, hidden: true });
  const tagsIn = el("input", { class: "field", type: "text", placeholder: "Tags for new uploads, e.g. halloween, logo" });
  const pubIn = el("input", { type: "checkbox", checked: true });
  const brandIn = el("select", { class: "field", "aria-label": "Brand for new uploads" }, Object.entries(BRANDS).map(([k, b]) => el("option", { value: k }, b.name)));
  brandIn.value = uploadBrand();
  const syncPub = () => { const ok = canBePublic(brandIn.value); pubIn.disabled = !ok; if (!ok) pubIn.checked = false; };
  brandIn.addEventListener("change", syncPub);
  syncPub();
  const search = el("input", { class: "field", type: "search", placeholder: "Search images by name or tag", "aria-label": "Search images" });
  const cats = el("div", { class: "ed-cats", role: "group", "aria-label": "Category" });
  const countLine = el("p", { class: "muted small" });
  const syncLine = el("p", { class: "muted small" });
  const lib = el("div", { class: "lib", role: "list" });
  const more = el("button", { class: "btn ghost", type: "button", hidden: true, onclick: () => { state.shown += 120; drawLib(); } }, "Show more");
  const layersList = el("div", { class: "layers" });

  const panels = {
    library: el("div", { class: "ed-pane stack" }, el("h2", {}, "Image library"), search, cats, countLine, lib, more, syncLine),
    upload: el("div", { class: "ed-pane stack" }, el("h2", {}, "Upload"),
      el("div", { class: "drop" }, "Drop images here or ", btn("choose files", () => fileIn.click(), "btn ghost")), fileIn,
      el("label", { class: "stack small", style: "gap:4px" }, "Brand", brandIn), tagsIn,
      el("label", { class: "row small" }, pubIn, "Show in the shirt app library (Elevated Designs and EPIX3D only)"),
      el("p", { class: "muted small" }, "PNG with a transparent background prints best. Up to 20 MB each. Adding images needs the studio key; designing doesn't. Rename, move or delete images on the Library page.")),
    shirt: el("div", { class: "ed-pane stack" }, el("h2", {}, "Shirt")),
    text: el("div", { class: "ed-pane stack" }),
    layers: el("div", { class: "ed-pane stack" }, el("h2", {}, "Layers"), el("p", { class: "muted small" }, "Top layer first. Select one to edit it."), layersList),
  };
  const paneHost = el("div", { class: "ed-panel" });
  const rail = el("nav", { class: "ed-rail", "aria-label": "Studio tools" },
    [["library", "Library"], ["upload", "Upload"], ["text", "Text"], ["shirt", "Shirt"], ["layers", "Layers"]].map(([k, label]) =>
      el("button", { type: "button", "data-tool": k, "aria-pressed": "false", onclick: () => { state.tool = k; drawTool(); } }, icon(k), el("span", {}, label))));
  const drawTool = () => {
    rail.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === state.tool)));
    paneHost.replaceChildren(panels[state.tool]);
    if (state.tool === "shirt") drawShirtPane();
    if (state.tool === "text") drawTextPane();
  };

  // ----- library -----
  const hay = (i) => `${i.name ?? ""} ${i.tags ?? ""} ${i.category ?? ""}`.toLowerCase();
  const drawLib = () => {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    const mine = state.items.filter(inBrand);
    const all = mine.filter((i) => !state.cat || i.category === state.cat);
    const shown = all.filter((i) => words.every((w) => hay(i).includes(w)));
    const localCount = mine.filter((i) => i.local).length;
    const where = currentBrandKey() === "all" ? "across all brands" : `in ${brandName(currentBrandKey())}`;
    countLine.replaceChildren(`${shown.length} of ${mine.length} images ${where}` + (localCount ? `, ${localCount} only in this browser.` : "."),
      ...(libraryScope === "public" ? [el("span", {}, " Showing public images only. ", btn("Show private images too", () => unlock(), "linkbtn"))] : []));
    lib.replaceChildren(...shown.slice(0, state.shown).map((i) => {
      const add = el("button", { class: "tile", type: "button", draggable: "true", title: `${i.name}${i.tags ? ` · ${i.tags}` : ""}\nClick to add, or drag onto the shirt`, onclick: () => addLayer(i) },
        el("img", { src: imageUrl(i), alt: i.name, loading: "lazy" }), el("span", { class: "nm" }, i.name));
      add.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/bc-image", i.key));
      return el("div", { class: "lib-item", role: "listitem" }, add);
    }));
    more.hidden = shown.length <= state.shown;
    if (!shown.length) lib.append(el("p", { class: "muted small" }, mine.length ? "No images match that search." : `No ${brandName(currentBrandKey())} images yet. Upload some under Upload.`));
  };
  const drawCats = () => {
    const list = [...new Set(state.items.filter(inBrand).map((i) => i.category).filter(Boolean))].sort();
    cats.hidden = !list.length;
    cats.replaceChildren(...["", ...list].map((c) => el("button", { class: "chip", type: "button", "aria-pressed": String(c === state.cat),
      onclick: () => { state.cat = c; state.shown = 120; drawCats(); drawLib(); } }, c || "All")));
  };
  const refresh = async () => { state.items = await listImages(); drawCats(); drawLib(); };
  const unlock = async () => {
    if (!(await askForKey("Private library images need the studio key."))) return;
    await refresh();
  };
  // When the hourly Kittl library sync last ran (counts only, no key needed).
  const showSync = async () => {
    try {
      const s = await (await fetch("/api/library-sync", { headers: { accept: "application/json" } })).json();
      if (!s?.at && !s?.finishedAt && !s?.ranAt) { syncLine.textContent = s?.error ? `Kittl sync: ${s.error}` : ""; return; }
      const when = new Date(s.finishedAt ?? s.ranAt ?? s.at);
      const n = (v) => Array.isArray(v) ? v.length : (v ?? 0);
      syncLine.textContent = `Kittl sync ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}: ${n(s.added)} added, ${n(s.removed)} removed${s.failed ? `, ${s.failed} couldn't copy` : ""}. Runs every hour.`;
    } catch { syncLine.textContent = ""; }
  };

  const uploadFiles = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    if (!consoleKey.get() && !(await askForKey("Adding images to the library needs the studio key."))) return;
    let cloud = 0, local = 0, failed = 0, reason = "";
    for (const [n, f] of list.entries()) {
      countLine.textContent = `Uploading ${n + 1} of ${list.length}…`;
      try { (await upload(f, tagsIn.value.trim(), pubIn.checked, brandIn.value)).saved === "cloud" ? cloud++ : local++; }
      catch (e) { failed++; reason ||= e.message; if (e.key) { consoleKey.clear(); break; } }
    }
    await refresh();
    state.tool = "library"; drawTool();
    // One toast with the reason: a second toast would replace the first before it could be read.
    toast([cloud && `${cloud} saved online`, local && `${local} saved in this browser only`, failed && `${failed} failed`].filter(Boolean).join(", ") + (reason ? `. ${reason}` : ""));
  };
  fileIn.addEventListener("change", () => { uploadFiles(fileIn.files); fileIn.value = ""; });
  const drop = panels.upload.querySelector(".drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); uploadFiles(e.dataTransfer.files); });
  search.addEventListener("input", () => { state.q = search.value; state.shown = 120; drawLib(); });

  // ----- text pane -----
  const draft = { text: "", font: FONTS[0][0], weight: FONTS[0][1], color: isDark(state.color) ? "#ffffff" : "#111111" };
  function drawTextPane() {
    const box = el("textarea", { class: "field", rows: "3", placeholder: "Type your text. Press Enter for a new line.", "aria-label": "Text" });
    box.value = draft.text;
    box.addEventListener("input", () => { draft.text = box.value; });
    panels.text.replaceChildren(el("h2", {}, "Text"), box,
      el("span", { class: "eyebrow" }, "Font"),
      el("div", { class: "ed-fonts", role: "radiogroup", "aria-label": "Font" }, FONTS.map(([f, w]) => {
        const b = el("button", { type: "button", role: "radio", "aria-checked": String(f === draft.font), style: `font-family:"${f}",system-ui;font-weight:${w}`,
          onclick: () => { draft.font = f; draft.weight = w; drawTextPane(); } }, f);
        loadFont(f, w);
        return b;
      })),
      el("span", { class: "eyebrow" }, "Color"),
      el("div", { class: "swatches" }, INKS.map(([name, c]) => el("button", { type: "button", title: name, "aria-label": name, "aria-pressed": String(c === draft.color),
        style: `background:${c}`, onclick: () => { draft.color = c; drawTextPane(); } }))),
      btn("Add text to shirt", () => { if (!draft.text.trim()) { toast("Type some text first"); box.focus(); return; } addText({ ...draft }); draft.text = ""; drawTextPane(); }, "btn primary"),
      el("p", { class: "muted small" }, "Select text on the shirt to change its words, font, color, outline and spacing on the right."));
  }
  async function addText(t, x = 0.5, y = 0.3) {
    await loadFont(t.font, t.weight);
    const l = { id: crypto.randomUUID(), kind: "text", text: t.text, name: t.text.split("\n")[0].slice(0, 40), font: t.font, weight: t.weight, color: t.color,
      outline: isDark(t.color) ? "#ffffff" : "#111111", outlineW: 0, spacing: 0, x, y, w: 0.6, h: 0, rot: 0, op: 1, flip: false };
    fitText(l, 0.6);
    l.y = Math.max(y, l.h / 2);
    layers().push(l); state.sel = l.id;
    drawStage(); save();
  }
  // Keeps a text layer's box the shape of its words when the words or style change.
  function fitText(l, w = l.w) {
    const { ratio } = textSrc(l);
    let h = w * ratio * (PW / PH);
    const k = h > 0.95 ? 0.95 / h : 1;
    l.w = w * k; l.h = h * k;
  }

  // ----- shirt pane -----
  function drawShirtPane() {
    panels.shirt.replaceChildren(el("h2", {}, "Shirt"),
      el("span", { class: "eyebrow" }, "Style"),
      el("div", { class: "ed-styles", role: "radiogroup", "aria-label": "Shirt style" }, STYLES.map(([k, name]) =>
        el("button", { type: "button", role: "radio", "aria-checked": String(k === state.style), onclick: () => { state.style = k; save(); drawShirt(); drawShirtPane(); } },
          el("span", { class: "ed-thumb", "aria-hidden": "true" }, el("img", { class: "ed-shade", src: photoUrl(k, "front", true), alt: "", loading: "lazy" }),
            el("img", { class: "ed-base", src: photoUrl(k, "front", false), alt: "", loading: "lazy" })), el("span", {}, name)))),
      el("span", { class: "eyebrow" }, `Color: ${COLORS.find(([, c]) => c === state.color)?.[0] ?? "Custom"}`),
      el("div", { class: "swatches" }, COLORS.map(([name, c]) => el("button", { type: "button", title: name, "aria-label": name, "aria-pressed": String(c === state.color),
        style: `background:${c}`, onclick: () => { state.color = c; save(); drawShirt(); drawShirtPane(); } }))),
      el("p", { class: "muted small" }, `Print area ${PW} × ${PH} in. Customer orders pick the exact blank and color in the shirt app.`));
  }

  // ----- the shirt -----
  let areaBox = { x: 0.3, y: 0.25, w: 0.4, h: 0.53 };
  async function drawShirt() {
    tint.style.background = state.color;
    stage.style.setProperty("--ed-ink", isDark(state.color) ? "rgba(255,255,255,.55)" : "rgba(0,0,0,.35)");
    sideSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.side === state.side)));
    try {
      const cfg = await loadBlanks();
      const v = cfg.styles[state.style]?.[state.side] ?? cfg.styles.tee[state.side];
      areaBox = { x: v.cx - (v.ppi * PW) / 2, y: v.top, w: v.ppi * PW, h: v.ppi * PH };
      const base = photoUrl(state.style, state.side, false), shade = photoUrl(state.style, state.side, true);
      await Promise.all([loadImg(base), loadImg(shade)]);
      baseImg.src = base; shadeImg.src = shade; stage.classList.add("is-ready");
    } catch { toast("The shirt photo didn't load. Refresh to try again."); }
    for (const n of [print, area]) Object.assign(n.style, { left: `${areaBox.x * 100}%`, top: `${areaBox.y * 100}%`, width: `${areaBox.w * 100}%`, height: `${areaBox.h * 100}%` });
    drawStage();
  }

  // ----- layers -----
  const findItem = (key) => state.items.find((i) => i.key === key);
  const layerSrc = (l) => { if (l.kind === "text") return textSrc(l).src; const i = findItem(l.key); return i ? imageUrl(i) : l.src ?? null; };

  function addLayer(item, x = 0.5, y = 0.35) {
    const img = new Image();
    img.onload = () => {
      const w = 0.7, ratio = img.naturalHeight / img.naturalWidth || 1;
      let h = w * ratio * (PW / PH);
      const fit = h > 0.9 ? 0.9 / h : 1;
      layers().push({ id: crypto.randomUUID(), key: item.key, src: item.local ? null : imageUrl(item), name: item.name, x, y: Math.max(y, (h * fit) / 2), w: w * fit, h: h * fit, rot: 0, op: 1, flip: false,
        px: [img.naturalWidth, img.naturalHeight], vector: /svg/.test(item.type ?? "") || /\.svg$/i.test(item.name ?? "") });
      state.sel = layers().at(-1).id;
      drawStage(); save();
      if (matchMedia("(max-width: 900px)").matches) stage.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    img.onerror = () => toast("Couldn't load that image");
    img.src = imageUrl(item);
  }
  const selected = () => layers().find((l) => l.id === state.sel);
  const place = (node, l) => Object.assign(node.style, {
    left: `${(l.x - l.w / 2) * 100}%`, top: `${(l.y - l.h / 2) * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%`,
    transform: `rotate(${l.rot}deg)${l.flip ? " scaleX(-1)" : ""}`, opacity: l.op,
  });

  // live: redraw the shirt and layer list only, so a slider or text box being used isn't rebuilt under the pointer.
  function drawStage(live = false) {
    print.replaceChildren(...layers().map((l) => { const src = layerSrc(l); const n = src ? el("img", { class: "ed-pl", src, alt: "" }) : el("span"); place(n, l); return n; }));
    area.replaceChildren(...layers().map((l) => {
      const node = el("div", { class: `layer${l.id === state.sel ? " sel" : ""}`, "data-id": l.id, title: l.name },
        el("span", { class: "handle h-size", "data-h": "size" }), el("span", { class: "handle h-rot", "data-h": "rot" }));
      place(node, { ...l, op: 1, flip: false });
      return node;
    }));
    layersList.replaceChildren(...[...layers()].reverse().map((l) =>
      el("button", { type: "button", "aria-pressed": String(l.id === state.sel), onclick: () => { state.sel = l.id; drawStage(); } },
        l.kind === "text" ? el("span", { class: "layer-t", "aria-hidden": "true" }, "T") : layerSrc(l) ? el("img", { src: layerSrc(l), alt: "" }) : null, el("span", {}, l.name))));
    if (!layers().length) layersList.append(el("p", { class: "muted small" }, "Nothing on this side yet. Add an image from the Library or text from Text."));
    if (live) drawChecks(); else drawProps();
  }

  // ----- properties (right) -----
  const props = el("div", { class: "ed-props stack" });
  const checks = el("div", { class: "stack ed-checks", "aria-live": "polite" });
  const range = (label, min, max, value, on) => {
    const i = el("input", { type: "range", min, max, value, "aria-label": label });
    i.addEventListener("input", () => editSel((s) => on(s, +i.value), false, true));
    i.addEventListener("change", save);
    return el("label", { class: "stack small", style: "gap:4px" }, label, i);
  };
  // What a printer would warn about: art too small for its print size, and art past the print area.
  function drawChecks() {
    const s = selected();
    const inches = s ? `${(s.w * PW).toFixed(1)} × ${(s.h * PH).toFixed(1)} in` : "";
    sizeNote.textContent = s ? `Selected: ${inches}` : "";
    if (!s) return checks.replaceChildren();
    const out = [];
    if (s.kind !== "text" && s.px && !s.vector) {
      const dpi = Math.round(s.px[0] / (s.w * PW));
      out.push(dpi >= 200 ? el("p", { class: "note ok small" }, `Print quality: sharp (${dpi} dpi at this size).`)
        : dpi >= 150 ? el("p", { class: "note warn small" }, `Print quality: fair (${dpi} dpi). Fine from a step away; smaller prints sharper.`)
        : el("p", { class: "note bad small" }, `Print quality: low (${dpi} dpi). It will look soft or blocky. Make it smaller or use a bigger file.`));
    }
    const a = (s.rot * Math.PI) / 180, hw = s.w / 2, hh = s.h / 2;
    const ex = Math.abs(hw * Math.cos(a)) + Math.abs(hh * Math.sin(a) * (PH / PW));
    const ey = Math.abs(hh * Math.cos(a)) + Math.abs(hw * Math.sin(a) * (PW / PH));
    if (s.x - ex < -0.005 || s.x + ex > 1.005 || s.y - ey < -0.005 || s.y + ey > 1.005)
      out.push(el("p", { class: "note warn small" }, "Part of this is outside the print area and will be cut off. Move it inside the dashed box."));
    checks.replaceChildren(el("p", { class: "muted small ed-name" }, s.name, el("br"), inches), ...out);
  }
  const textField = (s) => {
    const box = el("textarea", { class: "field", rows: "2", "aria-label": "Text" });
    box.value = s.text;
    box.addEventListener("input", () => editSel((l) => { l.text = box.value || " "; l.name = box.value.split("\n")[0].slice(0, 40) || "Text"; fitText(l); }, false, true));
    box.addEventListener("change", save);
    return box;
  };
  const textControls = (s) => el("div", { class: "stack" },
    textField(s),
    el("label", { class: "stack small", style: "gap:4px" }, "Font",
      el("select", { class: "field", "aria-label": "Font", onchange: async (e) => { const [f, w] = FONTS.find(([n]) => n === e.target.value); await loadFont(f, w); editSel((l) => { l.font = f; l.weight = w; fitText(l); }); } },
        FONTS.map(([f]) => el("option", { value: f, selected: f === s.font }, f)))),
    el("span", { class: "small" }, "Color"),
    el("div", { class: "swatches sm" }, INKS.map(([name, c]) => el("button", { type: "button", title: name, "aria-label": `Text ${name}`, "aria-pressed": String(c === s.color), style: `background:${c}`,
      onclick: () => editSel((l) => { l.color = c; }) }))),
    range("Outline", 0, 15, s.outlineW ?? 0, (l, v) => { l.outlineW = v; fitText(l); }),
    (s.outlineW ?? 0) > 0 ? el("div", { class: "swatches sm" }, INKS.map(([name, c]) => el("button", { type: "button", title: name, "aria-label": `Outline ${name}`, "aria-pressed": String(c === s.outline), style: `background:${c}`,
      onclick: () => editSel((l) => { l.outline = c; }) }))) : null,
    range("Letter spacing", -5, 40, s.spacing ?? 0, (l, v) => { l.spacing = v; fitText(l); }));
  function drawProps() {
    const s = selected();
    drawChecks();
    props.replaceChildren(
      el("h2", {}, s ? (s.kind === "text" ? "Selected text" : "Selected image") : "Design"),
      s ? el("div", { class: "stack" },
        checks,
        s.kind === "text" ? textControls(s) : null,
        range("Size", 5, 100, Math.round(s.w * 100), (l, v) => { const k = v / 100 / l.w; l.w *= k; l.h *= k; }),
        range("Rotation", -180, 180, Math.round(s.rot), (l, v) => { l.rot = v; }),
        range("Opacity", 10, 100, Math.round(s.op * 100), (l, v) => { l.op = v / 100; }),
        el("span", { class: "eyebrow" }, "Position"),
        el("div", { class: "ed-grid2" },
          btn("Center across", () => editSel((l) => { l.x = 0.5; })), btn("Center up/down", () => editSel((l) => { l.y = 0.5; })),
          btn("Top of print", () => editSel((l) => { l.y = l.h / 2; })), btn("Fit print width", () => editSel((l) => { const k = Math.min(1 / l.w, 1 / l.h); l.w *= k; l.h *= k; l.x = 0.5; l.y = Math.max(l.h / 2, Math.min(l.y, 1 - l.h / 2)); }))),
        el("span", { class: "eyebrow" }, "Arrange"),
        el("div", { class: "ed-grid2" },
          btn("Flip", () => editSel((l) => { l.flip = !l.flip; })), btn("Duplicate", dup),
          btn("Bring forward", () => reorder(1)), btn("Send back", () => reorder(-1))),
        btn(s.kind === "text" ? "Remove text" : "Remove from shirt", delLayer, "btn danger"))
        : el("p", { class: "muted small" }, layers().length ? "Select something on the shirt to size, turn or move it." : "Pick an image from the Library or add words under Text. Drag it on the shirt to move it, the corner dot resizes and the top dot turns it."),
      el("hr"),
      el("h3", {}, "Export"),
      btn("Download print file", exportPng, "btn primary"),
      btn("Download mockup photo", exportMockup, "btn"),
      btn("Save to library for listing", saveToLibrary, "btn"),
      el("p", { class: "muted small" }, `Print file: ${PW * DPI} × ${PH * DPI} px transparent PNG, ${PW} × ${PH} in at ${DPI} dpi, ${state.side} side. Saved designs go to the ${brandName(uploadBrand())} library.`),
      layers().length ? confirmButton("Clear this side", "Click again to clear", () => { state.sides[state.side] = []; state.sel = null; drawStage(); save(); toast("Side cleared. Undo brings it back."); }) : null);
  }

  // drag, resize and rotate with one pointer handler
  area.addEventListener("pointerdown", (e) => {
    const node = e.target.closest(".layer");
    if (!node) { state.sel = null; drawStage(); return; }
    const l = layers().find((x) => x.id === node.dataset.id);
    if (state.sel !== l.id) { state.sel = l.id; drawStage(); }
    const box = area.getBoundingClientRect();
    const mode = e.target.dataset.h ?? "move";
    const start = { px: e.clientX, py: e.clientY, ...l };
    const cx = box.left + l.x * box.width, cy = box.top + l.y * box.height;
    const startDist = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    const move = (ev) => {
      if (mode === "move") {
        l.x = start.x + (ev.clientX - start.px) / box.width;
        l.y = start.y + (ev.clientY - start.py) / box.height;
      } else if (mode === "size") {
        const k = Math.max(0.05, Math.hypot(ev.clientX - cx, ev.clientY - cy) / startDist);
        l.w = Math.max(0.03, start.w * k); l.h = Math.max(0.03, start.h * k);
      } else {
        l.rot = Math.round((Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90);
        if (ev.shiftKey) l.rot = Math.round(l.rot / 15) * 15;
      }
      drawStage();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); save(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  });
  stage.addEventListener("dragover", (e) => e.preventDefault());
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    const box = area.getBoundingClientRect();
    const key = e.dataTransfer.getData("text/bc-image");
    if (key && findItem(key)) return addLayer(findItem(key), (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  const editSel = (fn, persist = true, live = false) => { const s = selected(); if (s) { fn(s); drawStage(live); if (persist) save(); } };
  const reorder = (d) => editSel((s) => {
    const L = layers(), i = L.indexOf(s), j = i + d;
    if (j < 0 || j >= L.length) return;
    [L[i], L[j]] = [L[j], L[i]];
  });
  const dup = () => editSel((s) => { const c = { ...s, id: crypto.randomUUID(), x: s.x + 0.04, y: s.y + 0.04 }; layers().push(c); state.sel = c.id; });
  const delLayer = () => editSel((s) => { state.sides[state.side] = layers().filter((x) => x !== s); state.sel = null; });
  const nudge = (dx, dy) => editSel((s) => { s.x += dx; s.y += dy; });

  const onKey = (e) => {
    if (!document.body.contains(stage)) return document.removeEventListener("keydown", onKey);
    if (e.target.closest("input, textarea, select, dialog")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return stepHist(e.shiftKey ? 1 : -1); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); return stepHist(1); }
    if (!selected()) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const map = { Delete: delLayer, Backspace: delLayer, ArrowLeft: () => nudge(-step, 0), ArrowRight: () => nudge(step, 0),
      ArrowUp: () => nudge(0, -step), ArrowDown: () => nudge(0, step) };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };
  document.addEventListener("keydown", onKey);
  const offBrand = onBrand(() => {
    if (!document.body.contains(stage)) return offBrand();
    state.cat = ""; state.shown = 120; brandIn.value = uploadBrand(); syncPub(); drawCats(); drawLib(); drawProps();
  });

  for (const side of ["front", "back"]) sideSeg.append(el("button", { class: "seg-btn", type: "button", role: "tab", "data-side": side, "aria-selected": "false",
    onclick: () => { state.side = side; state.sel = null; save(); drawShirt(); } }, side === "front" ? "Front" : "Back"));

  // ----- export -----
  async function paintLayers(g, x0, y0, wpx, hpx) {
    for (const l of layers()) {
      let img;
      if (l.kind === "text") {
        await loadFont(l.font, l.weight);
        // drawn at the size it prints, so text stays crisp in the 300 dpi file
        const probe = textCanvas(l, 100);
        img = textCanvas(l, Math.max(24, Math.round(100 * (l.w * wpx) / probe.width)));
      } else {
        const src = layerSrc(l);
        if (!src) continue;
        img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        try { await img.decode(); } catch { toast(`Skipped ${l.name}, it couldn't be loaded`); continue; }
      }
      g.save();
      g.globalAlpha = l.op;
      g.translate(x0 + l.x * wpx, y0 + l.y * hpx);
      g.rotate((l.rot * Math.PI) / 180);
      if (l.flip) g.scale(-1, 1);
      g.drawImage(img, (-l.w * wpx) / 2, (-l.h * hpx) / 2, l.w * wpx, l.h * hpx);
      g.restore();
    }
  }
  const download = (canvas, type, name, msg) => canvas.toBlob((blob) => {
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(msg);
  }, type, 0.92);
  const day = () => new Date().toISOString().slice(0, 10);
  const printCanvas = async () => {
    const c = Object.assign(document.createElement("canvas"), { width: PW * DPI, height: PH * DPI });
    await paintLayers(c.getContext("2d"), 0, 0, c.width, c.height);
    return c;
  };
  async function exportPng() {
    if (!layers().length) return toast(`Add an image or text to the ${state.side} first`);
    download(await printCanvas(), "image/png", `print-${state.side}-${day()}.png`, `Print file downloaded: ${PW * DPI} × ${PH * DPI} px, ${PW} × ${PH} in at ${DPI} dpi`);
  }
  // Puts this side's print file in the library (private), so it can be listed on Elevated Designs in one click.
  async function saveToLibrary() {
    if (!layers().length) return toast(`Add an image or text to the ${state.side} first`);
    if (!consoleKey.get() && !(await askForKey("Saving to the library needs the studio key."))) return;
    const name = await askName(layers().find((l) => l.kind === "text")?.name ?? layers().at(-1).name.replace(/\.[a-z0-9]+$/i, ""));
    if (!name) return;
    const clean = name.trim().replace(/[^\w .-]+/g, "").replace(/\s+/g, "-").slice(0, 60) || `design-${day()}`;
    const blob = await new Promise((ok) => printCanvas().then((c) => c.toBlob(ok, "image/png")));
    try {
      const r = await upload(new File([blob], `${clean}.png`, { type: "image/png" }), "studio", false, uploadBrand());
      await refresh();
      toast(r.saved === "cloud" ? `Saved "${clean}.png" to the ${brandName(uploadBrand())} library. List it on the store from the Business Console.` : `Saved "${clean}.png" in this browser only; the online library couldn't be reached.`);
    } catch (e) { if (e.key) consoleKey.clear(); toast(e.message); }
  }
  async function exportMockup() {
    const px = 1600;
    const c = Object.assign(document.createElement("canvas"), { width: px, height: px });
    const g = c.getContext("2d");
    try {
      const [base, shade] = await Promise.all([loadImg(photoUrl(state.style, state.side, false)), loadImg(photoUrl(state.style, state.side, true))]);
      g.fillStyle = state.color; g.fillRect(0, 0, px, px);
      await paintLayers(g, areaBox.x * px, areaBox.y * px, areaBox.w * px, areaBox.h * px);
      g.globalCompositeOperation = "multiply"; g.drawImage(shade, 0, 0, px, px);
      g.globalCompositeOperation = "lighter"; g.drawImage(base, 0, 0, px, px);
      g.globalCompositeOperation = "source-over";
      download(c, "image/jpeg", `mockup-${state.style}-${state.side}-${day()}.jpg`, "Mockup photo downloaded");
    } catch { toast("The shirt photo didn't load. Refresh to try again."); }
  }

  const page = el("div", { class: "editor" },
    rail,
    paneHost,
    el("section", { class: "ed-canvas", "aria-label": "Shirt" },
      el("div", { class: "ed-bar" }, sideSeg, el("div", { class: "row ed-hist" }, undoBtn, redoBtn), sizeNote), stage,
      el("p", { class: "muted small ed-hint" }, "Drag to move. The corner dot resizes, the top dot turns (hold Shift to snap). Arrow keys nudge, Delete removes.")),
    el("aside", { class: "ed-side", "aria-label": "Properties" }, props));

  // saved text needs its fonts before it is drawn, or the first drawing uses a fallback font
  const savedText = [...state.sides.front, ...state.sides.back].filter((l) => l.kind === "text");
  await Promise.all(savedText.map((l) => loadFont(l.font, l.weight)));
  drawTool();
  await refresh();
  await drawShirt();
  showSync();
  // "Use in designer" from Home or the Library: put that image on the shirt once the page is up.
  const addKey = store.get("ds-add", null);
  if (addKey) { store.set("ds-add", null); const i = findItem(addKey); if (i) addLayer(i); else toast("That image couldn't be found in the library."); }
  return page;
}
