// 3D makers: the Hype Chain Maker, the Nameplate Maker and the License Plate Maker, each a full page of its
// own under /makers/. All of them build Bambu-ready .3mf files in the browser; nothing is uploaded.
import { el, icon, pageHeader } from "./app.js";

const MAKERS = [
  { href: "/makers/hype-chain/", name: "Hype Chain Maker",
    text: "A pendant from a logo or text, chain styles and lengths, LED channels and filament slots. Exports a Bambu-ready .3mf with a preview card." },
  { href: "/makers/nameplate/", name: "Nameplate Maker",
    text: "Multi-color nameplates and desk signs with fonts, art frames, plates and panels. Exports a Bambu-ready .3mf." },
  { href: "/makers/license-plate/", name: "License Plate Maker",
    text: "Custom plate frames that fit a standard 12 x 6 in US plate, and novelty plates, with print checks. Exports a two-color .3mf or an STL." },
];

export function renderMakers() {
  const head = pageHeader("Charleston 3D", "3D makers", "Design a print and download the file, ready for the Bambu printer.");
  const grid = el("section", { class: "maker-grid", "aria-label": "Makers" },
    MAKERS.map((m) => el("article", { class: "panel maker" },
      el("h2", {}, m.name),
      el("p", { class: "muted" }, m.text),
      el("a", { class: "btn primary", href: m.href }, icon("makers"), `Open ${m.name}`))));
  return [head, grid];
}
