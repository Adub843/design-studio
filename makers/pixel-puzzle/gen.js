// Pixel puzzle: a picture turned into square tiles in a few filament colours, plus a tray they press into.
// Plate 1 is the tray. Plate 2 is the tiles, laid out as the picture with gaps, one object per colour.
import { boxMesh, joinMeshes } from "/makers/param/geom.js";

function sample(img, cols, rows) {
  const c = document.createElement("canvas"); c.width = cols; c.height = rows; const x = c.getContext("2d", { willReadFrequently: true });
  const s = Math.max(cols / img.width, rows / img.height); const w = img.width * s, h = img.height * s; x.imageSmoothingQuality = "high";
  x.drawImage(img, (cols - w) / 2, (rows - h) / 2, w, h); return x.getImageData(0, 0, cols, rows).data;
}
function palette(data, k) {
  const px = []; for (let i = 0; i < data.length; i += 4) px.push([data[i], data[i + 1], data[i + 2]]);
  const sorted = px.slice().sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2])); let C = Array.from({ length: k }, (_, i) => sorted[Math.floor((i + 0.5) / k * (sorted.length - 1))].slice());
  const lab = new Int32Array(px.length);
  for (let it = 0; it < 12; it++) { const sum = C.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => { let best = 0, bd = Infinity; C.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } }); lab[i] = best; const s = sum[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    C = C.map((c, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c); }
  return { C: C.map((c) => c.map(Math.round)), lab };
}
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
let sampleImg = null;
function defaultPicture() {
  if (sampleImg) return sampleImg; const c = document.createElement("canvas"); c.width = 320; c.height = 320; const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 320); g.addColorStop(0, "#f2c6a0"); g.addColorStop(0.55, "#e98f6c"); g.addColorStop(1, "#7b4a6b"); x.fillStyle = g; x.fillRect(0, 0, 320, 320);
  x.fillStyle = "#fbe7c6"; x.beginPath(); x.arc(205, 140, 48, 0, 7); x.fill();
  x.fillStyle = "#4a3150"; x.beginPath(); x.moveTo(0, 320); x.lineTo(0, 210); x.lineTo(80, 150); x.lineTo(150, 215); x.lineTo(230, 170); x.lineTo(320, 230); x.lineTo(320, 320); x.fill();
  x.fillStyle = "#2c2235"; x.beginPath(); x.moveTo(0, 320); x.lineTo(0, 260); x.lineTo(110, 230); x.lineTo(210, 265); x.lineTo(320, 245); x.lineTo(320, 320); x.fill();
  sampleImg = c; return c;
}

export default {
  id: "pixel-puzzle", title: "Pixel puzzle", fileName: "pixel-puzzle",
  intro: "Choose a picture. It becomes square tiles in a few filament colours and a tray to press them into: a puzzle you put together by colour.",
  defaults: { photo: "", across: 28, pixel: 7, colors: 5, tileH: 3, gap: 0.3, trayColor: "#1f2228" },
  sections: [
    { title: "Picture", fields: [
      { key: "photo", label: "Picture", type: "image", hint: "Bold shapes and a plain background work best. Until you choose one, a sample sunset is shown." },
      { key: "colors", label: "Colours", type: "range", min: 2, max: 8, step: 1, hint: "One filament per colour. Bambu AMS holds 4 per unit." } ] },
    { title: "Size", fields: [
      { key: "across", label: "Tiles across", type: "range", min: 12, max: 48, step: 1 },
      { key: "pixel", label: "Tile size", type: "range", min: 4, max: 12, step: 0.5, unit: " mm" },
      { key: "tileH", label: "Tile thickness", type: "range", min: 2, max: 5, step: 0.2, unit: " mm" } ] },
    { title: "Fit", fields: [
      { key: "gap", label: "Tile clearance", type: "range", min: 0.1, max: 0.6, step: 0.05, unit: " mm", hint: "0.3 mm presses in snug on most printers." },
      { key: "trayColor", label: "Tray colour shown", type: "color" } ] },
  ],
  needsContent: (p, images) => !!images.photo,
  howTo: "Plate 1 is the tray, plate 2 the tiles. On plate 2 give each colour object its filament. Print with 0.2 mm layers.",
  async build(p, kit) {
    const img = kit.images.photo?.img || defaultPicture(); const cols = p.across; const rows = Math.max(4, Math.round(cols * (img.height / img.width)));
    const W = cols * p.pixel, D = rows * p.pixel; if (W > 240 || D > 240) throw new Error(`That's ${Math.round(W)} × ${Math.round(D)} mm. Use fewer or smaller tiles (240 mm max).`);
    const data = sample(img, cols, rows); const { C, lab } = palette(data, p.colors);
    // tray: floor, then a rim around a recess the tiles sit in (recess = 60% of tile height)
    const fl = 1.6, rim = 4, rec = p.tileH * 0.6, TW = W + 2 * rim, TD = D + 2 * rim;
    const tray = joinMeshes([boxMesh(0, 0, 0, TW, TD, fl), boxMesh(0, 0, fl, rim, TD, fl + rec), boxMesh(TW - rim, 0, fl, TW, TD, fl + rec), boxMesh(rim, 0, fl, TW - rim, rim, fl + rec), boxMesh(rim, TD - rim, fl, TW - rim, TD, fl + rec)]);
    const objects = [{ name: "Tray", color: p.trayColor, plate: 1, mesh: tray }];
    // tiles as the picture, each shrunk by the clearance, one object per colour
    const per = C.map(() => []); const s = p.pixel, g = p.gap / 2;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const k = lab[r * cols + c]; const x = c * s, y = (rows - 1 - r) * s; per[k].push(boxMesh(x + g, y + g, 0, x + s - g, y + s - g, p.tileH)); }
    per.forEach((list, k) => { if (list.length) objects.push({ name: `Tiles ${k + 1} ${hex(C[k])} (${list.length})`, color: hex(C[k]), plate: 2, mesh: joinMeshes(list) }); });
    const checks = [["ok", `${cols * rows} tiles in ${per.filter((l) => l.length).length} colours.`], p.pixel - p.gap >= 3 ? ["ok", `Tiles are ${(p.pixel - p.gap).toFixed(1)} mm: big enough to pick up and press in.`] : ["warn", "Tiles under 3 mm are fiddly. Use bigger tiles."]];
    if (!kit.images.photo) checks.push(["warn", "Showing a sample picture. Choose your own to make your puzzle."]);
    return { objects, checks, plateNames: ["Tray", "Tiles"], notes: ["Plate 2 prints every tile at once as the picture. Pop them off and press them into the tray by colour."] };
  },
};
