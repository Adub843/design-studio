// Desk organizer: a tray with a grid of bins, rounded corners, a solid floor and optional finger scoops.
import { meshOf } from "/makers/param/geom.js";

export default {
  id: "organizer", csg: true, title: "Desk organizer", fileName: "desk-organizer",
  intro: "Set the outside size and how many bins you want. Every wall and the floor stay thick enough to print strong.",
  defaults: { width: 180, depth: 110, height: 45, cols: 3, rows: 2, wall: 1.6, floor: 1.6, radius: 5, scoop: true, color: "#2f3542" },
  sections: [
    { title: "Size", fields: [
      { key: "width", label: "Width", type: "range", min: 40, max: 250, step: 1, unit: " mm" },
      { key: "depth", label: "Depth", type: "range", min: 40, max: 250, step: 1, unit: " mm" },
      { key: "height", label: "Height", type: "range", min: 15, max: 120, step: 1, unit: " mm" } ] },
    { title: "Bins", fields: [
      { key: "cols", label: "Across", type: "range", min: 1, max: 10, step: 1 },
      { key: "rows", label: "Deep", type: "range", min: 1, max: 8, step: 1 },
      { key: "scoop", label: "Finger scoops (rounded bin floors)", type: "check", hint: "Makes small parts easy to slide out." } ] },
    { title: "Build", fields: [
      { key: "wall", label: "Walls", type: "range", min: 1.2, max: 3, step: 0.1, unit: " mm" },
      { key: "floor", label: "Floor", type: "range", min: 1.2, max: 4, step: 0.2, unit: " mm" },
      { key: "radius", label: "Corner radius", type: "range", min: 0, max: 15, step: 0.5, unit: " mm" },
      { key: "color", label: "Colour shown", type: "color" } ] },
  ],
  howTo: "Print open side up with 2-3 walls and 15% infill. No supports needed.",
  async build(p, kit) {
    const M = await kit.loadManifold(); const { CrossSection, Manifold } = M; const trash = [];
    const t = (o) => (trash.push(o), o);
    const rr = (w, d, r) => r > 0.05 ? t(t(CrossSection.square([Math.max(0.5, w - 2 * r), Math.max(0.5, d - 2 * r)], true)).offset(r, "Round", 2, 48)) : t(CrossSection.square([w, d], true));
    try {
      let solid = t(rr(p.width, p.depth, p.radius).extrude(p.height));
      const cw = (p.width - p.wall * (p.cols + 1)) / p.cols, cd = (p.depth - p.wall * (p.rows + 1)) / p.rows;
      if (cw < 5 || cd < 5) throw new Error("The bins are too small. Use fewer bins or a bigger tray.");
      const ir = Math.max(0.6, p.radius - p.wall); const cut = [];
      for (let c = 0; c < p.cols; c++) for (let r = 0; r < p.rows; r++) {
        const x = -p.width / 2 + p.wall + cw / 2 + c * (cw + p.wall), y = -p.depth / 2 + p.wall + cd / 2 + r * (cd + p.wall);
        let pocket = t(t(rr(cw, cd, Math.min(ir, cw / 2 - 0.1, cd / 2 - 0.1)).extrude(p.height)).translate([x, y, p.floor]));
        if (p.scoop) { const sr = Math.min(cd, p.height) * 0.45; const fill = t(t(Manifold.cube([cw, sr, sr], false)).translate([x - cw / 2, y - cd / 2, p.floor])); const round = t(t(t(Manifold.cylinder(cw + 2, sr, sr, 64, true)).rotate([0, 90, 0])).translate([x, y - cd / 2 + sr, p.floor + sr]));
          pocket = t(pocket.subtract(t(fill.subtract(round)))); }
        cut.push(pocket);
      }
      solid = t(solid.subtract(t(Manifold.union(cut))));
      if (solid.status() !== "NoError") throw new Error("The shape didn't close cleanly.");
      const mesh = meshOf(solid); const grams = solid.volume() / 1000 * 1.24;
      return { objects: [{ name: "Desk organizer", color: p.color, mesh }], weight: grams,
        checks: [p.wall >= 1.2 ? ["ok", `Walls ${p.wall} mm and floor ${p.floor} mm: strong enough for daily use.`] : ["warn", "Thin walls bend; 1.2 mm or more is better."],
          ["ok", `${p.cols * p.rows} bins, each about ${Math.round(cw)} × ${Math.round(cd)} mm inside.`]] };
    } finally { for (const o of trash) try { o.delete(); } catch {} }
  },
};
