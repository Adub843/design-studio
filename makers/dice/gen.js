// Dice: classic six-sided dice with rounded edges and recessed pips. Opposite faces add up to 7.
// With "Two colours" the pips are filled with a second filament, flush with the face.
import { meshOf, joinMeshes, translate } from "/makers/param/geom.js";

const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [-1, 1], [1, -1], [1, 1]], 5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]] };
// face value -> outward normal and the two in-face axes
const FACES = [[1, [0, 0, 1], [1, 0, 0], [0, 1, 0]], [6, [0, 0, -1], [1, 0, 0], [0, -1, 0]], [2, [0, -1, 0], [1, 0, 0], [0, 0, 1]], [5, [0, 1, 0], [-1, 0, 0], [0, 0, 1]], [3, [1, 0, 0], [0, 1, 0], [0, 0, 1]], [4, [-1, 0, 0], [0, -1, 0], [0, 0, 1]]];

export default {
  id: "dice", csg: true, title: "Dice", fileName: "dice",
  intro: "Six-sided dice with rounded edges and recessed pips. Choose the size, how round, and whether the pips print in a second colour.",
  defaults: { size: 18, round: 78, pip: 17, depth: 1.2, count: 2, twoColor: true, body: "#f3efe6", pipColor: "#1c1d22" },
  sections: [
    { title: "Dice", fields: [
      { key: "size", label: "Size", type: "range", min: 12, max: 30, step: 0.5, unit: " mm" },
      { key: "round", label: "Edge shape", type: "range", min: 72, max: 86, step: 1, unit: "", format: (v) => (v <= 75 ? "Very round" : v <= 80 ? "Classic" : "Sharp"), hint: "Classic looks like a real board-game die." },
      { key: "count", label: "How many", type: "range", min: 1, max: 6, step: 1 } ] },
    { title: "Pips", fields: [
      { key: "pip", label: "Pip size", type: "range", min: 12, max: 22, step: 0.5, unit: "% of the face" },
      { key: "depth", label: "Pip depth", type: "range", min: 0.6, max: 2.5, step: 0.1, unit: " mm" },
      { key: "twoColor", label: "Two colours (filled pips)", type: "check", hint: "The pips print flush in a second filament." } ] },
    { title: "Colours", fields: [
      { key: "body", label: "Body", type: "color" },
      { key: "pipColor", label: "Pips", type: "color", show: (p) => p.twoColor } ] },
  ],
  howTo: "Print with 0.12-0.16 mm layers and 100% infill so the dice roll fair. With two colours, give the Pips object its own filament.",
  async build(p, kit) {
    const M = await kit.loadManifold(); const { Manifold } = M; const trash = []; const t = (o) => (trash.push(o), o);
    try {
      const s = p.size, h = s / 2; const cube = t(Manifold.cube([s, s, s], true)); const ball = t(Manifold.sphere(s * p.round / 100, 256)); // sphere radius between the edge (0.71 s) and the corner (0.87 s) distance
      const body = t(cube.intersect(ball));
      const pr = s * p.pip / 100 / 2, off = s * 0.27; const R = Math.max(pr, (pr * pr + p.depth * p.depth) / (2 * p.depth)); // sphere radius that cuts a pip of radius pr and the given depth
      const spheres = [];
      for (const [val, n, u, v] of FACES) {
        for (const [a, b] of PIPS[val]) { const c = [0, 1, 2].map((k) => n[k] * (h + R - p.depth) + u[k] * a * off + v[k] * b * off); spheres.push(t(t(Manifold.sphere(R, 48)).translate(c))); } }
      const holes = t(Manifold.union(spheres));
      const die = t(body.subtract(holes)); const fill = p.twoColor ? t(body.intersect(holes)) : null;
      if (die.status() !== "NoError") throw new Error("The die didn't close cleanly.");
      const dm = meshOf(die), fm = fill ? meshOf(fill) : null; const gap = s + 6; const bodies = [], pips = [];
      for (let i = 0; i < p.count; i++) { const dx = (i % 3) * gap, dy = Math.floor(i / 3) * gap; bodies.push(translate(dm, dx, dy, h)); if (fm) pips.push(translate(fm, dx, dy, h)); }
      const objects = [{ name: p.count > 1 ? `Dice (${p.count})` : "Die", color: p.body, mesh: joinMeshes(bodies) }];
      if (fm) objects.push({ name: "Pips", color: p.pipColor, mesh: joinMeshes(pips) });
      const minWall = h - p.depth;
      return { objects, weight: die.volume() / 1000 * 1.24 * p.count,
        checks: [["ok", "Opposite faces add up to 7, like a real die."], p.depth <= s * 0.12 ? ["ok", `Pips are ${p.depth} mm deep.`] : ["warn", "Deep pips on small dice weaken the corners."], minWall > 0 ? ["ok", "Prints on any face; 100% infill keeps it balanced."] : ["bad", "Pips are too deep."]] };
    } finally { for (const o of trash) try { o.delete(); } catch {} }
  },
};
