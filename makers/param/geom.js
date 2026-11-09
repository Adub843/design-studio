// EPIX3D parametric makers: geometry helpers with no page access, so the generators can run in the page or
// in the geometry worker (makers/param/csg-worker.js). Meshes are { pos: Float32Array xyz, idx: Uint32Array }.
let manifoldP = null;
export function loadManifold() {
  manifoldP ??= import("/makers/vendor/manifold/manifold.js").then(async (m) => { const w = await m.default(); w.setup(); return w; });
  return manifoldP;
}
// a manifold-3d solid -> { pos, idx } (positions only)
export function meshOf(solid) {
  const m = solid.getMesh(); const np = m.numProp; const n = m.vertProperties.length / np;
  const pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { pos[i * 3] = m.vertProperties[i * np]; pos[i * 3 + 1] = m.vertProperties[i * np + 1]; pos[i * 3 + 2] = m.vertProperties[i * np + 2]; }
  return { pos, idx: Uint32Array.from(m.triVerts) };
}
// axis-aligned box as an indexed mesh (outward winding)
export function boxMesh(x0, y0, z0, x1, y1, z1) {
  const pos = new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { pos, idx };
}
// several meshes into one (no welding; each part must be closed on its own)
export function joinMeshes(list) {
  let nv = 0, ni = 0; for (const m of list) { nv += m.pos.length; ni += m.idx.length; }
  const pos = new Float32Array(nv), idx = new Uint32Array(ni); let pv = 0, pi = 0;
  for (const m of list) { pos.set(m.pos, pv); const base = pv / 3; for (let i = 0; i < m.idx.length; i++) idx[pi + i] = m.idx[i] + base; pv += m.pos.length; pi += m.idx.length; }
  return { pos, idx };
}
export function bounds(mesh) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = mesh.pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { mn, mx, size: mx.map((v, k) => v - mn[k]) };
}
export function translate(mesh, dx, dy, dz) { const pos = mesh.pos.slice(); for (let i = 0; i < pos.length; i += 3) { pos[i] += dx; pos[i + 1] += dy; pos[i + 2] += dz; } return { pos, idx: mesh.idx }; }
// every edge used exactly twice, once in each direction: the mesh is closed and consistently wound
export function isClosed(mesh) {
  const P = mesh.pos, I = mesh.idx; const key = (v) => `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`;
  const k = new Array(P.length / 3); for (let v = 0; v < k.length; v++) k[v] = key(v);
  const e = new Map(); for (let t = 0; t < I.length; t += 3) for (let j = 0; j < 3; j++) { const a = k[I[t + j]], b = k[I[t + (j + 1) % 3]]; if (a === b) continue; const s = a + "|" + b; e.set(s, (e.get(s) || 0) + 1); }
  for (const [s, c] of e) { const [a, b] = s.split("|"); if ((e.get(b + "|" + a) || 0) !== c) return false; } return true;
}
export function volume(mesh) { const P = mesh.pos, I = mesh.idx; let v = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; } return v; }

