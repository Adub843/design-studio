// E: drive: every design file on Aaron's E: drive (plus Kittl and the old design lab), searchable with
// previews. The files never leave the drive: they're read from his PC through the Cloudflare Tunnel, so this
// page works while the PC is on. Elevated Designs and Charleston3D each see only their own files.
import { el, toast, icon, pageHeader } from "./app.js";
import { currentBrand, brandName } from "./brands.js";
import { askForKey, consoleKey } from "./api.js";

const PER = 60;
const KINDS = {
  ed: [["", "All"], ["image", "Images"], ["svg", "SVG"], ["dtf", "DTF and halftone"], ["logo", "Logos"], ["source", "Source files"], ["kittl", "Kittl"]],
  c3d: [["", "All"], ["3d", "3D models"], ["image", "Photos and art"], ["logo", "Logos"], ["source", "Source files"], ["kittl", "Kittl"]],
};
const size = (b) => b == null ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const extLabel = (e = "") => e.replace(".", "").toUpperCase() || "Kittl";

export async function renderDrive() {
  const brand = currentBrand() === "c3d" ? "c3d" : "ed";
  const state = { q: "", kind: "", page: 0, total: 0, items: [], busy: false, seq: 0 };

  const search = el("input", { class: "field", type: "search", placeholder: "Search file and folder names", "aria-label": "Search the E: drive" });
  const kinds = el("div", { class: "ed-cats", role: "group", "aria-label": "File type" });
  const count = el("p", { class: "muted small", role: "status" });
  const grid = el("div", { class: "agrid" });
  const pager = el("div", { class: "row pager" });

  const sheet = el("dialog", { class: "sheet", "aria-labelledby": "dv-title" });
  document.querySelectorAll("dialog.sheet").forEach((d) => d.remove());
  document.body.append(sheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });

  function tile(i) {
    return i.thumbUrl ? el("img", { src: i.thumbUrl, alt: "", loading: "lazy", onerror: (e) => e.target.replaceWith(el("span", { class: "ftile" }, extLabel(i.ext))) })
      : el("span", { class: "ftile" }, extLabel(i.ext));
  }
  function card(i) {
    return el("button", { class: "acard", type: "button", onclick: () => openDetails(i) },
      el("span", { class: "checker" }, tile(i)),
      el("span", { class: "a-meta" },
        el("span", { class: "a-name" }, i.name),
        i.folder ? el("span", { class: "muted small a-name", title: i.folder }, i.folder.split("\\").slice(-2).join(" / ")) : null,
        el("span", { class: "muted small wrap" }, [extLabel(i.ext), size(i.size), i.copies > 1 ? `${i.copies} copies` : ""].filter(Boolean).join(" · "))));
  }
  function openDetails(i) {
    sheet.replaceChildren(...[
      el("div", { class: "sheet-head" }, el("h2", { id: "dv-title", class: "wrap" }, i.name),
        el("button", { class: "btn ghost icon-btn", type: "button", "aria-label": "Close", onclick: () => sheet.close() }, icon("close"))),
      el("div", { class: "checker sheet-img" }, tile(i)),
      el("p", { class: "muted small wrap" }, [brandName(i.brand), extLabel(i.ext), size(i.size)].filter(Boolean).join(" · ")),
      el("p", { class: "small wrap" }, el("span", { class: "eyebrow" }, "Where it is"), el("br"), i.src === "kittl" ? i.folder : `${i.src === "lab" ? "Design lab images" : "E:"}\\${i.folder}`),
      i.copies > 1 ? el("p", { class: "muted small" }, `The drive has ${i.copies} copies of this file. It's listed once.`) : null,
      el("div", { class: "row" },
        i.fileUrl ? el("a", { class: "btn primary", href: i.fileUrl, download: i.name }, icon("download"), "Download") : null,
        i.link ? el("a", { class: "btn", href: i.link, target: "_blank", rel: "noopener" }, icon("out"), "Open in Kittl") : null)].filter(Boolean));
    sheet.showModal();
  }

  async function load() {
    const seq = ++state.seq;
    if (!consoleKey.get() && !(await askForKey("The E: drive library needs the studio key."))) { count.textContent = "The E: drive library needs the studio key."; return; }
    count.textContent = "Loading…";
    const qs = new URLSearchParams({ brand, page: String(state.page), per: String(PER) });
    if (state.q) qs.set("q", state.q);
    if (state.kind) qs.set("kind", state.kind);
    let res, body;
    try { res = await fetch(`/api/drive/search?${qs}`, { headers: { accept: "application/json", "x-console-key": consoleKey.get() } }); body = await res.json(); }
    catch { body = { error: "Couldn't reach the studio. Check the connection." }; }
    if (seq !== state.seq) return;
    if (res?.status === 401) { consoleKey.clear(); return load(); }
    if (!res?.ok) {
      state.items = []; state.total = 0;
      count.textContent = "";
      grid.replaceChildren(el("div", { class: "empty" }, el("p", {}, body.error ?? "Something went wrong."),
        el("button", { class: "btn", type: "button", onclick: load }, "Try again")));
      pager.replaceChildren();
      return;
    }
    state.items = body.items; state.total = body.total;
    draw();
  }
  function draw() {
    kinds.replaceChildren(...KINDS[brand].map(([k, label]) => el("button", { class: "chip", type: "button", "aria-pressed": String(k === state.kind),
      onclick: () => { state.kind = k; state.page = 0; draw(); load(); } }, label)));
    const from = state.page * PER;
    count.textContent = state.total ? `${(from + 1).toLocaleString()} to ${(from + state.items.length).toLocaleString()} of ${state.total.toLocaleString()} files` : "";
    grid.replaceChildren(...state.items.map(card));
    if (!state.items.length) grid.append(el("div", { class: "empty" }, el("p", {}, "Nothing matches. Try another search or file type.")));
    const pages = Math.ceil(state.total / PER);
    pager.replaceChildren(
      el("button", { class: "btn ghost", type: "button", disabled: state.page === 0, onclick: () => { state.page--; load(); scrollTo(0, 0); } }, "Previous"),
      el("span", { class: "muted small" }, pages ? `Page ${state.page + 1} of ${pages.toLocaleString()}` : ""),
      el("button", { class: "btn ghost", type: "button", disabled: state.page + 1 >= pages, onclick: () => { state.page++; load(); scrollTo(0, 0); } }, "Next"));
  }
  let t;
  search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value.trim(); state.page = 0; load(); }, 300); });

  const page = el("div", { class: "lib-page stack" },
    pageHeader(brandName(brand), "E: drive", brand === "c3d"
      ? "Every Charleston3D 3D model and file on the E: drive. Private to the team. Opens while Aaron's PC is on."
      : "Every Elevated Designs image, SVG, DTF print, logo and source file on the E: drive, plus Kittl. Opens while Aaron's PC is on.",
      [el("button", { class: "btn", type: "button", onclick: () => { load().then(() => toast("Refreshed")); } }, "Refresh")]),
    el("div", { class: "toolbar" }, search), kinds, count, grid, pager);
  draw();
  load();
  return page;
}
