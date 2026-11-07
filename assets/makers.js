// Maker Studio: every 3D maker (Nameplate, Hype chain, Light box & keychain, License plate) in one place,
// with a tab for each. The studio itself is makers/index.html (a copy of the console's Maker Studio); this
// page shows it inside the Design Studio. All makers build Bambu-ready .3mf files in the browser; nothing is uploaded.
import { el } from "./app.js";

export function renderMakers() {
  return [el("iframe", { class: "maker-frame", src: "/makers/", title: "Maker Studio", allow: "clipboard-write; fullscreen" })];
}
