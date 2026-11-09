// Vase maker: a smooth profile (base, belly, top) turned round, with optional flat sides, twist and ribs.
// "Spiral vase" makes one closed solid for the slicer's spiral (vase) mode; "Hollow" makes real walls and a floor.
import { volume } from "/makers/param/geom.js";

const SEG = 192;
const smooth = (t) => t * t * (3 - 2 * t);
function radius(p, z) {
  const H = p.height, bz = H * p.bellyAt / 100, r0 = p.base / 2, rb = p.belly / 2, rt = p.top / 2;
  return z <= bz ? r0 + (rb - r0) * smooth(bz > 0 ? z / bz : 1) : rb + (rt - rb) * smooth((z - bz) / Math.max(1e-6, H - bz));
}
function shape(p, a) {
  let k = 1;
  if (p.sides >= 3) { const n = p.sides, s = (2 * Math.PI) / n; const local = ((a % s) + s) % s - s / 2; k = Math.cos(Math.PI / n) / Math.cos(local); k = 0.82 * k + 0.18; }
  return k;
}
function outerR(p, z, a) { const tw = (p.twist * Math.PI / 180) * (z / p.height); const aa = a - tw; let r = radius(p, z) * shape(p, aa); if (p.ribs > 0) r += p.ribDepth * (0.5 + 0.5 * Math.cos(p.ribs * aa)); return r; }

export default {
  id: "vase", title: "Vase", fileName: "vase",
  intro: "Shape the profile, add flat sides, a twist or ribs. Print it in spiral vase mode for a smooth, one-wall vase, or choose Hollow for thick walls.",
  defaults: { height: 160, base: 70, belly: 120, bellyAt: 38, top: 80, sides: 0, twist: 0, ribs: 0, ribDepth: 2, style: "spiral", wall: 2, floor: 2, color: "#d9d3c7" },
  sections: [
    { title: "Shape", fields: [
      { key: "height", label: "Height", type: "range", min: 60, max: 250, step: 1, unit: " mm" },
      { key: "base", label: "Base width", type: "range", min: 30, max: 160, step: 1, unit: " mm" },
      { key: "belly", label: "Widest point", type: "range", min: 30, max: 200, step: 1, unit: " mm" },
      { key: "bellyAt", label: "Widest at", type: "range", min: 10, max: 90, step: 1, unit: "% up" },
      { key: "top", label: "Opening", type: "range", min: 20, max: 200, step: 1, unit: " mm" } ] },
    { title: "Pattern", fields: [
      { key: "sides", label: "Sides", type: "select", options: [[0, "Round"], [3, "3 sides"], [4, "4 sides"], [5, "5 sides"], [6, "6 sides"], [8, "8 sides"], [10, "10 sides"], [12, "12 sides"]] },
      { key: "twist", label: "Twist", type: "range", min: -360, max: 360, step: 5, unit: "°" },
      { key: "ribs", label: "Ribs", type: "range", min: 0, max: 48, step: 1 },
      { key: "ribDepth", label: "Rib depth", type: "range", min: 0.5, max: 8, step: 0.5, unit: " mm", show: (p) => p.ribs > 0 } ] },
    { title: "Print", fields: [
      { key: "style", label: "Print as", type: "select", options: [["spiral", "Spiral vase (one smooth wall)"], ["hollow", "Hollow (thick walls, watertight)"]] },
      { key: "wall", label: "Wall", type: "range", min: 0.8, max: 5, step: 0.1, unit: " mm", show: (p) => p.style === "hollow" },
      { key: "floor", label: "Floor", type: "range", min: 1, max: 6, step: 0.2, unit: " mm", show: (p) => p.style === "hollow" },
      { key: "color", label: "Colour shown", type: "color", hint: "Pick the real filament in your slicer or when you order." } ] },
  ],
  howTo: "Spiral vase: in Bambu Studio turn on Spiral vase (Others), 0 top layers. Hollow: print normally, 3 walls.",
  async build(p) {
    const H = p.height, L = Math.max(30, Math.round(H / 1.2)), pos = [], idx = [];
    const ring = (z, rf) => { const start = pos.length / 3; for (let s = 0; s < SEG; s++) { const a = (s / SEG) * 2 * Math.PI; const r = Math.max(1, rf(z, a)); pos.push(r * Math.cos(a), r * Math.sin(a), z); } return start; };
    const side = (rows, out) => { for (let k = 0; k < rows.length - 1; k++) for (let s = 0; s < SEG; s++) { const s1 = (s + 1) % SEG; const A = rows[k] + s, B = rows[k] + s1, C = rows[k + 1] + s1, D = rows[k + 1] + s; if (out) idx.push(A, B, C, A, C, D); else idx.push(A, C, B, A, D, C); } };
    const cap = (row, z, up) => { const c = pos.length / 3; pos.push(0, 0, z); for (let s = 0; s < SEG; s++) { const s1 = (s + 1) % SEG; if (up) idx.push(c, row + s, row + s1); else idx.push(c, row + s1, row + s); } };
    const outer = []; for (let k = 0; k <= L; k++) outer.push(ring((k / L) * H, (z, a) => outerR(p, z, a)));
    side(outer, true); cap(outer[0], 0, false);
    const checks = [], notes = [];
    if (p.style === "hollow") {
      const F = Math.min(p.floor, H - 2), inner = []; const LI = Math.max(20, Math.round((H - F) / 1.2));
      for (let k = 0; k <= LI; k++) inner.push(ring(F + (k / LI) * (H - F), (z, a) => outerR(p, z, a) - p.wall));
      side(inner, false); cap(inner[0], F, true);
      const top = outer[L], itop = inner[LI]; for (let s = 0; s < SEG; s++) { const s1 = (s + 1) % SEG; idx.push(top + s, top + s1, itop + s1, top + s, itop + s1, itop + s); }
      checks.push(p.wall >= 0.8 ? ["ok", `Walls are ${p.wall} mm (0.8 mm or more prints cleanly).`] : ["bad", "Walls under 0.8 mm don't print well."]);
    } else {
      cap(outer[L], H, true);
      notes.push("Print it in spiral vase mode: the slicer turns this solid into one smooth wall with a floor.");
    }
    // overhangs: how far the wall leans out per mm of height
    let lean = 0; for (let k = 1; k <= L; k++) { const z0 = ((k - 1) / L) * H, z1 = (k / L) * H; lean = Math.max(lean, (radius(p, z1) - radius(p, z0)) / (z1 - z0)); }
    checks.push(lean <= 1 ? ["ok", "No overhang steeper than 45°: no supports needed."] : ["warn", `The wall leans out more than 45° in places (${Math.round(Math.atan(lean) * 180 / Math.PI)}°). Lower the widest point or widen the base.`]);
    if (p.top < 25) checks.push(["warn", "A narrow opening is hard to clean and fill with flowers."]);
    const mesh = { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
    const weight = p.style === "hollow" ? volume(mesh) / 1000 * 1.24 : null;
    return { objects: [{ name: "Vase", color: p.color, mesh }], checks, notes, weight };
  },
};
