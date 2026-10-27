// Library: every image for the chosen brand, the way an asset manager shows them. Search, filter and sort
// on top, a grid of cards, and a details panel on the right to rename, move to another brand, tag, show in
// the shirt apps, download or delete. The same images the shirt apps and the Business Console read.
import { el, store, toast, go, icon, pageHeader } from "./app.js";
import { BRANDS, currentBrand, brandName, inBrand, uploadBrand, canBePublic } from "./brands.js";
import { askForKey, consoleKey } from "./api.js";
import { confirmButton } from "./confirm.js";
import { listImages, imageUrl, libraryScope, upload, remove, patchImage } from "./studio.js";

const PAGE = 60;
const FILTERS = [["all", "All"], ["public", "In shirt apps"], ["private", "Private"]];
const SORTS = [["new", "Newest first"], ["old", "Oldest first"], ["name", "Name A to Z"], ["big", "Largest file"]];
const size = (b) => b == null ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const when = (t) => t ? new Date(t).toLocaleDateString([], { dateStyle: "medium" }) : "";
const typeName = (t = "") => ({ "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WebP", "image/gif": "GIF", "image/svg+xml": "SVG" })[t] ?? "Image";

export async function renderLibrary() {
  const brand = currentBrand();
  const state = { items: [], q: "", cat: "", filter: store.get("ds-lib-filter", "all"), sort: store.get("ds-lib-sort", "new"), shown: PAGE };
  store.set("ds-lib-filter", "all");
  if (!FILTERS.some(([k]) => k === state.filter)) state.filter = "all";

  // ----- upload -----
  const fileIn = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml", multiple: true, hidden: true });
  const upBrand = el("select", { class: "field", "aria-label": "Brand for new uploads" }, Object.entries(BRANDS).map(([k, b]) => el("option", { value: k }, b.name)));
  upBrand.value = uploadBrand();
  const upPublic = el("input", { type: "checkbox", checked: true });
  const upTags = el("input", { class: "field", type: "text", placeholder: "Tags, e.g. halloween, logo", "aria-label": "Tags for new uploads" });
  const upNote = el("p", { class: "muted small", role: "status" });
  const uploader = el("section", { class: "panel uploader", hidden: !store.get("ds-open-upload", false), "aria-label": "Upload art" },
    el("div", { class: "panel-head" }, el("h2", {}, "Upload art"), el("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Close upload", onclick: () => { uploader.hidden = true; } }, icon("close"))),
    el("div", { class: "drop" }, "Drop images here or ", el("button", { class: "btn ghost", type: "button", onclick: () => fileIn.click() }, "choose files")), fileIn,
    el("div", { class: "up-grid" }, el("label", { class: "lfield" }, el("span", { class: "eyebrow" }, "Brand"), upBrand), el("label", { class: "lfield" }, el("span", { class: "eyebrow" }, "Tags"), upTags)),
    el("label", { class: "check-row small" }, upPublic, el("span", {}, "Show in the shirt app library (Elevated Designs and EPIX3D only)")),
    el("p", { class: "muted small" }, "PNG with a transparent background prints best. Up to 20 MB each."), upNote);
  store.set("ds-open-upload", false);
  const syncUpPublic = () => { const ok = canBePublic(upBrand.value); upPublic.disabled = !ok; if (!ok) upPublic.checked = false; };
  upBrand.addEventListener("change", syncUpPublic);
  syncUpPublic();
  const openUpload = () => { uploader.hidden = false; uploader.scrollIntoView({ block: "nearest" }); fileIn.click(); };

  async function uploadFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return toast("Only image files can go in the library.");
    if (!consoleKey.get() && !(await askForKey("Adding images to the library needs the studio key."))) return;
    uploader.hidden = false;
    let cloud = 0, local = 0, failed = 0, reason = "";
    for (const [n, f] of list.entries()) {
      upNote.textContent = `Uploading ${n + 1} of ${list.length}…`;
      try { (await upload(f, upTags.value.trim(), upPublic.checked, upBrand.value)).saved === "cloud" ? cloud++ : local++; }
      catch (e) { failed++; reason ||= e.message; if (e.key) { consoleKey.clear(); break; } }
    }
    upNote.textContent = "";
    await refresh();
    toast([cloud && `${cloud} saved to ${brandName(upBrand.value)}`, local && `${local} saved in this browser only`, failed && `${failed} failed`].filter(Boolean).join(", ") + (reason ? `. ${reason}` : ""));
  }
  fileIn.addEventListener("change", () => { uploadFiles(fileIn.files); fileIn.value = ""; });
  const drop = uploader.querySelector(".drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); uploadFiles(e.dataTransfer.files); });

  // ----- toolbar -----
  const search = el("input", { class: "field", type: "search", placeholder: "Search by name, tag or category", "aria-label": "Search the library" });
  const filterSeg = el("div", { class: "seg", role: "group", "aria-label": "Show" }, FILTERS.map(([k, label]) =>
    el("button", { class: "seg-btn", type: "button", "data-f": k, onclick: () => { state.filter = k; state.shown = PAGE; draw(); } }, label)));
  const sortSel = el("select", { class: "field sort", "aria-label": "Sort" }, SORTS.map(([k, label]) => el("option", { value: k }, label)));
  sortSel.value = state.sort;
  sortSel.addEventListener("change", () => { state.sort = sortSel.value; store.set("ds-lib-sort", state.sort); draw(); });
  search.addEventListener("input", () => { state.q = search.value; state.shown = PAGE; draw(); });
  const cats = el("div", { class: "ed-cats", role: "group", "aria-label": "Category" });
  const count = el("p", { class: "muted small", role: "status" });
  const grid = el("div", { class: "agrid" });
  const more = el("button", { class: "btn ghost more", type: "button", hidden: true, onclick: () => { state.shown += PAGE; draw(); } }, "Show more");

  const hay = (i) => `${i.name ?? ""} ${i.tags ?? ""} ${i.category ?? ""}`.toLowerCase();
  const sorters = {
    new: (a, b) => (b.added ?? 0) - (a.added ?? 0), old: (a, b) => (a.added ?? 0) - (b.added ?? 0),
    name: (a, b) => (a.name ?? "").localeCompare(b.name ?? ""), big: (a, b) => (b.size ?? 0) - (a.size ?? 0),
  };
  function visible() {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    return state.items.filter(inBrand)
      .filter((i) => !state.cat || i.category === state.cat)
      .filter((i) => state.filter === "all" || (state.filter === "public" ? i.public : !i.public))
      .filter((i) => words.every((w) => hay(i).includes(w)))
      .sort(sorters[state.sort]);
  }
  function drawCats() {
    const list = [...new Set(state.items.filter(inBrand).map((i) => i.category).filter(Boolean))].sort();
    if (!list.includes(state.cat)) state.cat = "";
    cats.hidden = !list.length;
    cats.replaceChildren(...["", ...list].map((c) => el("button", { class: "chip", type: "button", "aria-pressed": String(c === state.cat),
      onclick: () => { state.cat = c; state.shown = PAGE; drawCats(); draw(); } }, c || "All categories")));
  }
  function card(i) {
    const b = i.brand ?? "ed";
    return el("button", { class: "acard", type: "button", "data-key": i.key, onclick: () => openDetails(i) },
      el("span", { class: "checker" }, el("img", { src: imageUrl(i), alt: "", loading: "lazy" })),
      el("span", { class: "a-meta" },
        el("span", { class: "a-name" }, i.name),
        el("span", { class: "row a-pills" },
          brand === "all" ? el("span", { class: `pill b-${b}` }, BRANDS[b]?.short ?? "ED") : null,
          el("span", { class: `pill ${i.local ? "s-attn" : i.public ? "s-live" : "s-empty"}` }, i.local ? "This browser" : i.public ? "Shirt apps" : "Private"),
          el("span", { class: "muted small" }, [typeName(i.type), size(i.size)].filter(Boolean).join(" · ")))));
  }
  function draw() {
    filterSeg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.f === state.filter)));
    const list = visible(), total = state.items.filter(inBrand).length;
    count.replaceChildren(`${list.length === total ? total : `${list.length} of ${total}`} ${total === 1 ? "image" : "images"} ${brand === "all" ? "across all brands" : `in ${brandName(brand)}`}`,
      libraryScope === "public" ? el("span", {}, ". Showing public images only. ", el("button", { class: "linkbtn", type: "button", onclick: unlock }, "Unlock to see private ones")) : ".");
    grid.replaceChildren(...list.slice(0, state.shown).map(card));
    more.hidden = list.length <= state.shown;
    if (!list.length) grid.append(el("div", { class: "empty" },
      el("p", {}, total ? "Nothing matches. Try another search or filter." : `No ${brandName(brand)} images yet.`),
      total ? null : el("button", { class: "btn primary", type: "button", onclick: openUpload }, "Upload art")));
  }
  async function refresh() { state.items = await listImages(); drawCats(); draw(); }
  async function unlock() { if (await askForKey("Private images need the studio key.")) await refresh(); }

  // ----- details panel (a side sheet, Polaris/Shopify Files style) -----
  const sheet = el("dialog", { class: "sheet", "aria-labelledby": "sh-title" });
  document.querySelectorAll("dialog.sheet").forEach((d) => d.remove());
  document.body.append(sheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  function openDetails(i) {
    const canEdit = !i.local && libraryScope === "all";
    const name = el("input", { class: "field", type: "text", value: i.name ?? "", maxlength: "200", disabled: !canEdit });
    const brandSel = el("select", { class: "field", disabled: !canEdit }, Object.entries(BRANDS).map(([k, b]) => el("option", { value: k }, b.name)));
    brandSel.value = i.brand ?? "ed";
    const cat = el("input", { class: "field", type: "text", value: i.category ?? "", maxlength: "60", placeholder: "e.g. Holidays", disabled: !canEdit });
    const tags = el("input", { class: "field", type: "text", value: i.tags ?? "", maxlength: "200", placeholder: "Comma separated", disabled: !canEdit });
    const pub = el("input", { type: "checkbox", checked: !!i.public, disabled: !canEdit || !canBePublic(brandSel.value) });
    brandSel.addEventListener("change", () => { const ok = canBePublic(brandSel.value); pub.disabled = !ok; if (!ok) pub.checked = false; });
    const saveBtn = el("button", { class: "btn primary", type: "submit", disabled: !canEdit }, "Save changes");
    const form = el("form", { class: "stack" },
      el("label", { class: "lfield" }, el("span", { class: "eyebrow" }, "Name"), name),
      el("div", { class: "up-grid" }, el("label", { class: "lfield" }, el("span", { class: "eyebrow" }, "Brand"), brandSel), el("label", { class: "lfield" }, el("span", { class: "eyebrow" }, "Category"), cat)),
      el("label", { class: "lfield" }, el("span", { class: "eyebrow" }, "Tags"), tags),
      el("label", { class: "check-row small" }, pub, el("span", {}, "Show in the shirt app library (Elevated Designs and EPIX3D only)")),
      canEdit ? saveBtn : el("p", { class: "muted small" }, i.local ? "This image is only saved in this browser. Upload it again to put it online."
        : el("span", {}, "Changes need the studio key. ", el("button", { class: "linkbtn", type: "button", onclick: async () => { sheet.close(); await unlock(); const n = state.items.find((x) => x.key === i.key); if (n) openDetails(n); } }, "Unlock"))));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      try {
        const out = await patchImage(i, { name: name.value.trim() || i.name, brand: brandSel.value, category: cat.value.trim(), tags: tags.value.trim(), public: pub.checked });
        const at = state.items.findIndex((x) => x.key === i.key);
        if (at >= 0) state.items[at] = { ...state.items[at], ...out };
        sheet.close(); drawCats(); draw();
        toast(out.brand !== (i.brand ?? "ed") ? `Moved to ${brandName(out.brand)}` : "Saved");
      } catch (err) { toast(err.message); if (err.key) { sheet.close(); await refresh(); } }
      finally { saveBtn.disabled = false; }
    });
    const del = confirmButton("Delete", "Click again to delete", async () => {
      if (!i.local && !consoleKey.get() && !(await askForKey("Deleting library images needs the studio key."))) return;
      try { await remove(i); state.items = state.items.filter((x) => x.key !== i.key); sheet.close(); drawCats(); draw(); toast(`Deleted ${i.name}`); }
      catch (err) { toast(err.message); }
    }, "btn danger");
    sheet.replaceChildren(
      el("div", { class: "sheet-head" }, el("h2", { id: "sh-title", class: "wrap" }, i.name),
        el("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Close", onclick: () => sheet.close() }, icon("close"))),
      el("div", { class: "checker sheet-img" }, el("img", { src: imageUrl(i), alt: i.name })),
      el("p", { class: "muted small" }, [BRANDS[i.brand ?? "ed"]?.name, typeName(i.type), size(i.size), when(i.added) && `added ${when(i.added)}`].filter(Boolean).join(" · ")),
      el("div", { class: "row" },
        el("button", { class: "btn primary", type: "button", onclick: () => { sheet.close(); store.set("ds-add", i.key); go("designer"); } }, icon("designer"), "Use in designer"),
        el("a", { class: "btn", href: imageUrl(i), download: i.name }, icon("download"), "Download")),
      el("hr"), form, el("hr"),
      canEdit || i.local ? el("div", { class: "row" }, del) : null);
    sheet.showModal();
  }

  // Drop files anywhere on the page to upload them.
  const page = el("div", { class: "lib-page stack" });
  page.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); uploader.hidden = false; } });
  page.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); uploadFiles(e.dataTransfer.files); } });

  page.append(
    pageHeader(brandName(brand), "Library", "Each brand's art for the shirt apps and the designer. Click an image to edit, move or delete it.",
      [el("button", { class: "btn primary", type: "button", onclick: openUpload }, icon("upload"), "Upload")]),
    uploader,
    el("div", { class: "toolbar" }, search, filterSeg, sortSel),
    cats, count, grid, more);

  await refresh();
  const focus = store.get("ds-focus-image", null);
  if (focus) {
    store.set("ds-focus-image", null);
    const i = state.items.find((x) => x.key === focus);
    if (i) setTimeout(() => openDetails(i), 0);
  }
  return page;
}
