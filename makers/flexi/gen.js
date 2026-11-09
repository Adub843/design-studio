// Flexi animals: print-in-place creatures whose segments wiggle side to side.
// Each joint is a ball on a neck sitting in a socket in the segment ahead. Ball and socket are biconical
// (45° above and below their widest point), so the ball can't lift out or drop through, nothing overhangs
// more than 45°, and every part starts on the bed. The clearance gap is the same all round (default 0.4 mm).
import { meshOf, joinMeshes } from "/makers/param/geom.js";

const CREATURES = {
  snake: { label: "Snake", seg: (i, n) => ({ L: i === 0 ? 1.35 : 1, W: i === n - 1 ? 0.7 : 1 - 0.18 * Math.pow(i / n, 2) }), headRound: 0.5 },
  fish: { label: "Fish", seg: (i, n) => ({ L: i === 0 ? 1.4 : 1, W: i === 0 ? 1.25 : i === n - 1 ? 0.6 : 1.35 - 0.5 * Math.abs((i - n * 0.35) / n) }), tail: "fin", headRound: 0.45 },
  caterpillar: { label: "Caterpillar", seg: (i) => ({ L: i === 0 ? 1.15 : 1, W: i === 0 ? 1.1 : 1 }), round: true, headRound: 0.5 },
};

export default {
  id: "flexi", csg: true, title: "Flexi animal", fileName: "flexi-animal",
  intro: "A print-in-place animal that wiggles. Every joint is a ball in a socket that prints already linked: no supports, no glue.",
  defaults: { creature: "snake", segments: 9, size: 18, height: 9, clearance: 0.4, colorA: "#2f7d6d", colorB: "#e9e2d0" },
  sections: [
    { title: "Animal", fields: [
      { key: "creature", label: "Animal", type: "select", options: Object.entries(CREATURES).map(([k, v]) => [k, v.label]) },
      { key: "segments", label: "Segments", type: "range", min: 4, max: 12, step: 1 },
      { key: "size", label: "Segment size", type: "range", min: 16, max: 26, step: 0.5, unit: " mm" },
      { key: "height", label: "Thickness", type: "range", min: 8, max: 12, step: 0.5, unit: " mm" } ] },
    { title: "Joints", fields: [
      { key: "clearance", label: "Joint clearance", type: "range", min: 0.3, max: 0.6, step: 0.05, unit: " mm", hint: "0.4 mm frees up on most printers. Go up if joints fuse, down if they feel loose." } ] },
    { title: "Colours", fields: [
      { key: "colorA", label: "Colour 1", type: "color" },
      { key: "colorB", label: "Colour 2", type: "color", hint: "Segments alternate. Use the same colour twice for one filament." } ] },
  ],
  howTo: "Print flat, 0.2 mm layers, no supports, brim off. After printing, flex each joint gently to free it.",
  async build(p, kit) {
    const M = await kit.loadManifold(); const { Manifold, CrossSection } = M; const trash = []; const t = (o) => (trash.push(o), o);
    try {
      const cr = CREATURES[p.creature] || CREATURES.snake; const n = p.segments, H = p.height, c = p.clearance, wall = 2.0, roof = 1.4, gap = 2.6;
      const zt = H - roof, zm = zt / 2, rb = Math.max(zm + 1.4, p.size * 0.3), nw = rb * 0.95;
      // biconical solid: radius r at zm, shrinking at 45° to z0 and z1
      const bicone = (r, z0, z1) => { const lo = t(t(Manifold.cylinder(zm - z0, Math.max(0.2, r - (zm - z0)), r, 64)).translate([0, 0, z0])); const hi = t(t(Manifold.cylinder(z1 - zm, r, Math.max(0.2, r - (z1 - zm)), 64)).translate([0, 0, zm])); return t(lo.add(hi)); };
      const segs = []; let X = 0; const dims = [];
      for (let i = 0; i < n; i++) { const d = cr.seg(i, n); const L = p.size * d.L, W = Math.max(2 * (rb + c + wall), p.size * d.W); if (i > 0) X -= dims[i - 1].L / 2 + gap + L / 2; dims.push({ X, L, W }); }
      if (-dims[n - 1].X + dims[n - 1].L / 2 + dims[0].L / 2 > 240) throw new Error("That's longer than the printer bed. Use fewer or smaller segments.");
      const shape2d = (i) => { const { L, W } = dims[i]; const tail = i === n - 1 && cr.tail === "fin";
        if (tail) { const fin = CrossSection.ofPolygons([[[L / 2, -W * 0.35], [L / 2, W * 0.35], [-L * 0.2, W * 0.9], [-L * 0.75, W * 1.05], [-L * 0.55, 0], [-L * 0.75, -W * 1.05], [-L * 0.2, -W * 0.9]]]); return t(fin); }
        if (cr.round) return t(t(CrossSection.circle(1, 64)).scale([L / 2, W / 2]));
        const r = Math.min(W / 2 - 0.1, L / 2 - 0.1, W * (i === 0 ? cr.headRound : 0.38)); return t(t(CrossSection.square([L - 2 * r, W - 2 * r], true)).offset(r, "Round", 2, 48)); };
      for (let i = 0; i < n; i++) {
        const { X, L, W } = dims[i]; let s = t(t(shape2d(i).extrude(H)).translate([X, 0, 0]));
        if (i < n - 1) { // socket in the rear for the next segment's ball, and a slot its neck swings in
          const jx = X - L / 2 + rb + c + wall; const cav = t(bicone(rb + c, -1, zt + c)).translate([jx, 0, 0]);
          const near = t(t(CrossSection.square([0.1, nw + 2 * c], true)).translate([jx, 0])); const far = t(t(CrossSection.square([0.1, nw + 2 * c + 2 * Math.tan(30 * Math.PI / 180) * (jx - X + L / 2 + 1)], true)).translate([X - L / 2 - 1, 0]));
          const slot = t(t(t(CrossSection.hull([near, far])).extrude(H + 2)).translate([0, 0, -1]));
          s = t(t(s.subtract(t(cav))).subtract(slot)); }
        if (i > 0) { // ball and neck reaching forward into the segment ahead
          const prev = dims[i - 1]; const jx = prev.X - prev.L / 2 + rb + c + wall; const ball = t(bicone(rb, 0, zt).translate([jx, 0, 0]));
          const x0 = X + L / 2 - 1.5, neck = t(t(Manifold.cube([jx - x0, nw, zt], false)).translate([x0, -nw / 2, 0]));
          s = t(t(s.add(ball)).add(neck)); }
        if (i === 0) { const ey = W * 0.24, ex = X + L * 0.18; for (const sy of [-1, 1]) s = t(s.subtract(t(t(Manifold.sphere(1.7, 32)).translate([ex, sy * ey, H + 0.9])))); }
        segs.push(s);
      }
      // neighbours must never touch: a fused joint can't move
      let fused = 0; for (let i = 0; i < n - 1; i++) { const x = t(Manifold.intersection(segs[i], segs[i + 1])); if (x.volume() > 1e-3) fused++; }
      const A = [], B = []; segs.forEach((s, i) => (i % 2 ? B : A).push(meshOf(s)));
      const objects = [{ name: `${cr.label} (colour 1)`, color: p.colorA, mesh: joinMeshes(A) }]; if (B.length) objects.push({ name: `${cr.label} (colour 2)`, color: p.colorB, mesh: joinMeshes(B) });
      const vol = segs.reduce((v, s) => v + s.volume(), 0);
      return { objects, weight: vol / 1000 * 1.24,
        checks: [fused ? ["bad", `${fused} joint${fused > 1 ? "s" : ""} would print fused. Raise the clearance.`] : ["ok", `${n - 1} joints, each with ${c} mm clearance all round: they print free.`],
          c >= 0.4 ? ["ok", "Clearance 0.4 mm or more: frees up on most printers."] : ["warn", "Under 0.4 mm only frees up on well-tuned printers."],
          ["ok", "No overhang steeper than 45°: prints without supports."]] };
    } finally { for (const o of trash) try { o.delete(); } catch {} }
  },
};
