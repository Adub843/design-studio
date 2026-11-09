// Print prep: turns any AI-made mesh (holes, loose bits, paper-thin parts, no base) into one solid,
// watertight, manifold part at a real size in millimetres, ready for an FDM printer (Bambu Lab).
// Runs the same in the browser and in Node, with no dependencies, so it costs nothing per model.
//
// How it works (a voxel "wrap", the same idea as alpha wrapping):
//   1. Turn the mesh Y-up (glTF) into Z-up (printer) and scale its longest side to sizeMm.
//   2. Mark every voxel the surface touches, grow that shell by `closeMm` so holes close, flood the
//      outside from the edges, then shrink the outside back. What is left is the solid.
//   3. Keep the biggest piece (loose bits fall off a print), thicken parts thinner than minWallMm,
//      and cut a flat base where the model is wide enough to stand.
//   4. Fix voxels that touch only at an edge or a corner (those make non-manifold meshes),
//      build the outer faces, smooth them (Taubin, which does not shrink the part) and check the
//      result: every edge shared by exactly two triangles, size, volume, base area, balance, overhangs.

const INF = 1e20;

/** @typedef {{positions: Float32Array|number[], indices: Uint32Array|number[]}} Mesh */

export const DEFAULTS = Object.freeze({
  sizeMm: 60,          // longest side of the finished part
  minWallMm: 1.2,      // three 0.4 mm lines: the safe minimum for a 0.4 mm nozzle
  voxelMm: 0,          // 0 = choose from size (about sizeMm/220, never below 0.2 mm)
  closeMm: 0,          // 0 = 2.5 voxels: holes up to about twice this close
  flatBase: true,
  maxBaseCutPct: 8,    // never cut away more than this share of the height for the base
  smoothIterations: 12,
  maxCells: 24_000_000,
  upAxis: "y",         // glTF and TRELLIS output are Y-up
});

// ---------- small helpers ----------
function bounds(p) {
  const min = [INF, INF, INF], max = [-INF, -INF, -INF];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v;
  }
  return { min, max };
}

// One-dimensional squared distance transform (Felzenszwalb and Huttenlocher), in place on f[0..n).
function edt1d(f, n, v, z, d) {
  let k = -1;
  for (let q = 0; q < n; q++) {
    if (f[q] >= INF) continue;
    if (k < 0) { k = 0; v[0] = q; z[0] = -INF; z[1] = INF; continue; }
    for (;;) {
      const s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s <= z[k]) {
        k--;
        if (k < 0) { k = 0; v[0] = q; z[0] = -INF; z[1] = INF; break; }
      } else { k++; v[k] = q; z[k] = s; z[k + 1] = INF; break; }
    }
  }
  if (k < 0) { for (let q = 0; q < n; q++) d[q] = INF; return; }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// Squared Euclidean distance (in voxels) from every cell to the nearest cell where mask is 1.
export function edt3d(mask, nx, ny, nz) {
  const N = nx * ny * nz, out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = mask[i] ? 0 : INF;
  const m = Math.max(nx, ny, nz);
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const pass = (n, count, at) => {
    for (let c = 0; c < count; c++) {
      let any = false;
      for (let q = 0; q < n; q++) { f[q] = out[at(c, q)]; if (f[q] < INF) any = true; }
      if (!any) continue;
      edt1d(f, n, v, z, d);
      for (let q = 0; q < n; q++) out[at(c, q)] = d[q];
    }
  };
  pass(nx, ny * nz, (c, q) => c * nx + q);
  pass(ny, nx * nz, (c, q) => { const x = c % nx, zz = (c / nx) | 0; return x + nx * (q + ny * zz); });
  pass(nz, nx * ny, (c, q) => c + nx * ny * q);
  return out;
}

const within = (dist, r) => { const r2 = r * r + 1e-6, o = new Uint8Array(dist.length); for (let i = 0; i < dist.length; i++) o[i] = dist[i] <= r2 ? 1 : 0; return o; };
const not = (a) => { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] ? 0 : 1; return o; };
const count = (a) => { let n = 0; for (let i = 0; i < a.length; i++) n += a[i]; return n; };

// Cells reachable from the grid's border through cells where open[i] is 1 (6-connected).
function floodFromBorder(open, nx, ny, nz) {
  const N = nx * ny * nz, seen = new Uint8Array(N), q = new Int32Array(N);
  let h = 0, t = 0;
  const push = (i) => { if (open[i] && !seen[i]) { seen[i] = 1; q[t++] = i; } };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++)
    if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) push(x + nx * (y + ny * z));
  const sxy = nx * ny;
  while (h < t) {
    const i = q[h++], x = i % nx, y = ((i / nx) | 0) % ny, z = (i / sxy) | 0;
    if (x > 0) push(i - 1); if (x < nx - 1) push(i + 1);
    if (y > 0) push(i - nx); if (y < ny - 1) push(i + nx);
    if (z > 0) push(i - sxy); if (z < nz - 1) push(i + sxy);
  }
  return seen;
}

// Keeps the largest 6-connected piece of solid. Returns how many cells were dropped.
function keepLargest(solid, nx, ny, nz) {
  const N = nx * ny * nz, label = new Int32Array(N), q = new Int32Array(N), sxy = nx * ny;
  let best = 0, bestSize = 0, next = 0, total = 0;
  for (let s = 0; s < N; s++) {
    if (!solid[s] || label[s]) continue;
    next++; let h = 0, t = 0; label[s] = next; q[t++] = s;
    while (h < t) {
      const i = q[h++], x = i % nx, y = ((i / nx) | 0) % ny, z = (i / sxy) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < nx - 1 ? i + 1 : -1, y > 0 ? i - nx : -1, y < ny - 1 ? i + nx : -1, z > 0 ? i - sxy : -1, z < nz - 1 ? i + sxy : -1];
      for (const j of nb) if (j >= 0 && solid[j] && !label[j]) { label[j] = next; q[t++] = j; }
    }
    total += t;
    if (t > bestSize) { bestSize = t; best = next; }
  }
  for (let i = 0; i < N; i++) if (solid[i] && label[i] !== best) solid[i] = 0;
  return { pieces: next, dropped: total - bestSize };
}

// ---------- manifold fix: every vertex of the voxel grid must see one solid piece and one empty piece ----------
// For the 8 cells around a grid vertex (bit b = dx | dy<<1 | dz<<2), the voxel surface is a manifold there
// only if the solid cells are face-connected within those 8 and so are the empty ones.
function blockComponents(mask, want) {
  let seen = 0, comps = 0;
  for (let b = 0; b < 8; b++) {
    if (((mask >> b) & 1) !== want || (seen >> b) & 1) continue;
    comps++; const st = [b]; seen |= 1 << b;
    while (st.length) {
      const c = st.pop();
      for (const f of [1, 2, 4]) { const n = c ^ f; if (((mask >> n) & 1) === want && !((seen >> n) & 1)) { seen |= 1 << n; st.push(n); } }
    }
  }
  return comps;
}
const MANIFOLD_OK = new Uint8Array(256), FIX_CELL = new Int8Array(256).fill(-1);
for (let m = 0; m < 256; m++) MANIFOLD_OK[m] = blockComponents(m, 1) <= 1 && blockComponents(m, 0) <= 1 ? 1 : 0;
for (let m = 0; m < 256; m++) {
  if (MANIFOLD_OK[m]) continue;
  for (let b = 0; b < 8; b++) if (!((m >> b) & 1) && MANIFOLD_OK[m | (1 << b)]) { FIX_CELL[m] = b; break; }
  if (FIX_CELL[m] < 0) for (let b = 0; b < 8; b++) if (!((m >> b) & 1)) { FIX_CELL[m] = b; break; }
}

function makeManifold(solid, nx, ny, nz) {
  let added = 0;
  for (let pass = 0; pass < 50; pass++) {
    let changed = 0;
    for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      let m = 0;
      for (let b = 0; b < 8; b++) if (solid[(x + (b & 1)) + nx * ((y + ((b >> 1) & 1)) + ny * (z + ((b >> 2) & 1)))]) m |= 1 << b;
      if (MANIFOLD_OK[m]) continue;
      const b = FIX_CELL[m];
      solid[(x + (b & 1)) + nx * ((y + ((b >> 1) & 1)) + ny * (z + ((b >> 2) & 1)))] = 1;
      changed++;
    }
    added += changed;
    if (!changed) break;
  }
  return added;
}

// ---------- surface: the outer faces of the solid voxels, as triangles on the grid's corners ----------
function voxelSurface(solid, nx, ny, nz, voxel, origin) {
  const vid = new Map(), pos = [], tris = [];
  const vert = (x, y, z) => {
    const key = x + (nx + 1) * (y + (ny + 1) * z);
    let id = vid.get(key);
    if (id === undefined) { id = pos.length / 3; vid.set(key, id); pos.push(origin[0] + x * voxel, origin[1] + y * voxel, origin[2] + z * voxel); }
    return id;
  };
  const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && solid[x + nx * (y + ny * z)];
  const quad = (a, b, c, d) => { tris.push(a, b, c, a, c, d); };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!solid[x + nx * (y + ny * z)]) continue;
    if (!at(x - 1, y, z)) quad(vert(x, y, z), vert(x, y, z + 1), vert(x, y + 1, z + 1), vert(x, y + 1, z));
    if (!at(x + 1, y, z)) quad(vert(x + 1, y, z), vert(x + 1, y + 1, z), vert(x + 1, y + 1, z + 1), vert(x + 1, y, z + 1));
    if (!at(x, y - 1, z)) quad(vert(x, y, z), vert(x + 1, y, z), vert(x + 1, y, z + 1), vert(x, y, z + 1));
    if (!at(x, y + 1, z)) quad(vert(x, y + 1, z), vert(x, y + 1, z + 1), vert(x + 1, y + 1, z + 1), vert(x + 1, y + 1, z));
    if (!at(x, y, z - 1)) quad(vert(x, y, z), vert(x, y + 1, z), vert(x + 1, y + 1, z), vert(x + 1, y, z));
    if (!at(x, y, z + 1)) quad(vert(x, y, z + 1), vert(x + 1, y, z + 1), vert(x + 1, y + 1, z + 1), vert(x, y + 1, z + 1));
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(tris) };
}

// Taubin smoothing (lambda/mu), so the voxel steps disappear without the part shrinking.
// Vertices on the base plane keep their height, so the base stays flat.
function taubin(mesh, iterations, zBase) {
  const p = mesh.positions, t = mesh.indices, n = p.length / 3;
  const deg = new Uint32Array(n + 1);
  const edges = new Set();
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = t[i + k], b = t[i + (k + 1) % 3]; const lo = Math.min(a, b), hi = Math.max(a, b);
    edges.add(lo * n + hi);
  }
  const ea = new Uint32Array(edges.size), eb = new Uint32Array(edges.size);
  let e = 0; for (const key of edges) { ea[e] = Math.floor(key / n); eb[e] = key % n; e++; }
  for (let i = 0; i < ea.length; i++) { deg[ea[i]]++; deg[eb[i]]++; }
  const pinned = new Uint8Array(n);
  if (zBase !== null) for (let i = 0; i < n; i++) if (Math.abs(p[i * 3 + 2] - zBase) < 1e-6) pinned[i] = 1;
  const acc = new Float64Array(n * 3);
  const step = (f) => {
    acc.fill(0);
    for (let i = 0; i < ea.length; i++) {
      const a = ea[i] * 3, b = eb[i] * 3;
      for (let k = 0; k < 3; k++) { acc[a + k] += p[b + k]; acc[b + k] += p[a + k]; }
    }
    for (let i = 0; i < n; i++) {
      if (!deg[i]) continue;
      for (let k = 0; k < 3; k++) {
        if (k === 2 && pinned[i]) continue;
        const j = i * 3 + k; p[j] += f * (acc[j] / deg[i] - p[j]);
      }
    }
  };
  for (let it = 0; it < iterations; it++) { step(0.5); step(-0.53); }
}

// ---------- checks ----------
export function checkMesh(mesh) {
  const p = mesh.positions, t = mesh.indices, n = p.length / 3;
  const edgeUse = new Map();
  for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = t[i + k], b = t[i + (k + 1) % 3];
    const key = a < b ? a * n + b : b * n + a, dir = a < b ? 1 : -1;
    const e = edgeUse.get(key) ?? [0, 0]; e[0]++; e[1] += dir; edgeUse.set(key, e);
  }
  let open = 0, nonManifold = 0, flipped = 0;
  for (const [c, s] of edgeUse.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; else if (s !== 0) flipped++; }
  let vol = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  const v = n - edgeUse.size + t.length / 3; // Euler characteristic
  return { watertight: open === 0, manifold: nonManifold === 0 && flipped === 0, openEdges: open, nonManifoldEdges: nonManifold, flippedEdges: flipped, volumeMm3: vol, triangles: t.length / 3, vertices: n, euler: v };
}

function convexHull2d(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up);
}
function insideHull(h, x, y) {
  if (h.length < 3) return false;
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false; }
  return true;
}

// ---------- main ----------
/**
 * @param {Mesh} input  triangles in any units; Y-up unless opts.upAxis is "z"
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {{mesh: Mesh, report: object}}
 */
export function prepareForPrint(input, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const src = input.positions, idx = input.indices;
  if (!src?.length || !idx?.length) throw new Error("The model has no triangles.");
  const warnings = [];

  // 1. Z-up and real size
  const p = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    if (o.upAxis === "y") { p[i] = src[i]; p[i + 1] = -src[i + 2]; p[i + 2] = src[i + 1]; }
    else { p[i] = src[i]; p[i + 1] = src[i + 1]; p[i + 2] = src[i + 2]; }
  }
  const b0 = bounds(p);
  const longest = Math.max(b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2]);
  if (!(longest > 0)) throw new Error("The model is flat or empty.");
  const s = o.sizeMm / longest;
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) p[i + k] = (p[i + k] - b0.min[k]) * s;

  // 2. grid
  let voxel = o.voxelMm > 0 ? o.voxelMm : Math.max(0.2, o.sizeMm / 220);
  const closeMm = o.closeMm > 0 ? o.closeMm : voxel * 2.5;
  const pad = () => Math.ceil(Math.max(closeMm, o.minWallMm) / voxel) + 3;
  const dims = () => { const ext = bounds(p).max; return ext.map((e) => Math.ceil(e / voxel) + 2 * pad()); };
  let [nx, ny, nz] = dims();
  while (nx * ny * nz > o.maxCells) { voxel *= 1.15; [nx, ny, nz] = dims(); }
  const P = pad(), N = nx * ny * nz;
  const origin = [-P * voxel, -P * voxel, -P * voxel];

  // surface cells: sample each triangle finely enough that no voxel it crosses is skipped
  const surf = new Uint8Array(N);
  const mark = (x, y, z) => {
    const i = Math.floor((x - origin[0]) / voxel), j = Math.floor((y - origin[1]) / voxel), k = Math.floor((z - origin[2]) / voxel);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) surf[i + nx * (j + ny * k)] = 1;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ab = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
    const ac = Math.hypot(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]);
    const bc = Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1], p[c + 2] - p[b + 2]);
    const steps = Math.max(1, Math.ceil(Math.max(ab, ac, bc) / (voxel * 0.5)));
    for (let u = 0; u <= steps; u++) for (let v = 0; v <= steps - u; v++) {
      const wu = u / steps, wv = v / steps, ww = 1 - wu - wv;
      mark(ww * p[a] + wu * p[b] + wv * p[c], ww * p[a + 1] + wu * p[b + 1] + wv * p[c + 1], ww * p[a + 2] + wu * p[b + 2] + wv * p[c + 2]);
    }
  }

  // close holes: grow the shell, flood the outside, shrink the outside back
  const rClose = closeMm / voxel;
  const grown = within(edt3d(surf, nx, ny, nz), rClose);
  const outside0 = floodFromBorder(not(grown), nx, ny, nz);
  const outside = within(edt3d(outside0, nx, ny, nz), rClose);
  let solid = not(outside);
  // keep thin surfaces the shrink-back would lose, grown by one voxel so cells that touch only
  // diagonally (a curved sheet one voxel thick) still join face to face
  const sheet = within(edt3d(surf, nx, ny, nz), 1);
  for (let i = 0; i < N; i++) if (sheet[i]) solid[i] = 1;
  return finishSolid(solid, { nx, ny, nz, voxel, origin }, o, warnings);
}

// Moves each surface vertex onto the true surface of a smooth field (level(x, y, z) = 0 on the surface,
// > 0 inside), so a generated shape keeps its curves instead of voxel steps. Vertices that would have to
// move more than most of a voxel (thickened parts, the cut base) stay where the voxels put them.
function snapToSurface(mesh, level, voxel, zBase) {
  const p = mesh.positions, h = voxel * 0.5, maxMove = voxel * 1.6;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i + 2] - zBase) < 1e-6) continue;
    const x0 = p[i], y0 = p[i + 1], z0 = p[i + 2];
    let x = x0, y = y0, z = z0, ok = true;
    for (let it = 0; it < 4; it++) {
      const f = level(x, y, z);
      if (!Number.isFinite(f)) { ok = false; break; }
      const gx = (level(x + h, y, z) - level(x - h, y, z)) / (2 * h);
      const gy = (level(x, y + h, z) - level(x, y - h, z)) / (2 * h);
      const gz = (level(x, y, z + h) - level(x, y, z - h)) / (2 * h);
      const g2 = gx * gx + gy * gy + gz * gz;
      if (!(g2 > 1e-12)) { ok = false; break; }
      x -= (f * gx) / g2; y -= (f * gy) / g2; z -= (f * gz) / g2;
      if (Math.abs(f) < 1e-4) break;
    }
    if (!ok || Math.hypot(x - x0, y - y0, z - z0) > maxMove || z < zBase) continue;
    p[i] = x; p[i + 1] = y; p[i + 2] = z;
  }
}

// Steps 3 to 5 on a solid voxel grid (shared by meshes and by the generator's density field).
function finishSolid(solid, g, o, warnings) {
  const { nx, ny, nz, voxel, origin } = g, N = nx * ny * nz;
  const wallHalf = o.minWallMm / 2;
  // the original surface may now hold sealed pockets of air: fill them (a print has no use for them)
  const air = floodFromBorder(not(solid), nx, ny, nz);
  for (let i = 0; i < N; i++) solid[i] = air[i] ? 0 : 1;

  // 3a. thicken thin parts: what an opening of radius minWall/2 removes, away from corners, gets grown
  const w = wallHalf / voxel;
  const inner = within(edt3d(not(solid), nx, ny, nz), w);           // cells closer than w to the outside
  const core = new Uint8Array(N); for (let i = 0; i < N; i++) core[i] = solid[i] && !inner[i] ? 1 : 0;
  const opened = within(edt3d(core, nx, ny, nz), w);
  const distOpened = edt3d(opened, nx, ny, nz);
  const thinCore = new Uint8Array(N);
  // Opening also nibbles convex edges and corners (by at most 0.73 w); one more voxel covers rounding.
  const cornerR2 = (w + 1) * (w + 1);
  for (let i = 0; i < N; i++) if (solid[i] && !opened[i] && distOpened[i] > cornerR2) thinCore[i] = 1;
  const thinCells = count(thinCore);
  if (thinCells) {
    const thick = within(edt3d(thinCore, nx, ny, nz), w + 1.5);
    let added = 0;
    for (let i = 0; i < N; i++) if (thick[i] && !solid[i]) { solid[i] = 1; added++; }
    warnings.push(`Thickened thin parts to at least ${o.minWallMm} mm (${(added * voxel ** 3).toFixed(0)} mm³ added).`);
  }

  // 3b. one piece
  const pieces = keepLargest(solid, nx, ny, nz);
  if (pieces.pieces > 1) warnings.push(pieces.pieces === 2 ? "Removed a loose piece that would fall off the print." : `Removed ${pieces.pieces - 1} loose pieces that would fall off the print.`);

  // 3c. flat base: cut the lowest layers until the slice is wide enough to stand on
  const sxy = nx * ny;
  let zLow = -1, zHigh = -1;
  const layerArea = new Int32Array(nz);
  for (let z = 0; z < nz; z++) { let a = 0; for (let i = z * sxy; i < (z + 1) * sxy; i++) a += solid[i]; layerArea[z] = a; if (a) { if (zLow < 0) zLow = z; zHigh = z; } }
  if (zLow < 0) throw new Error("Nothing solid was left after repair.");
  let cut = zLow;
  if (o.flatBase) {
    let maxA = 0; for (let z = zLow; z <= zHigh; z++) maxA = Math.max(maxA, layerArea[z]);
    const limit = zLow + Math.floor((zHigh - zLow + 1) * o.maxBaseCutPct / 100);
    const want = Math.max(maxA * 0.15, (5 / voxel) ** 2);
    while (cut < limit && layerArea[cut] < want) cut++;
    for (let z = 0; z < cut; z++) solid.fill(0, z * sxy, (z + 1) * sxy);
    if (cut > zLow) warnings.push(`Cut ${((cut - zLow) * voxel).toFixed(1)} mm off the bottom for a flat base.`);
    keepLargest(solid, nx, ny, nz);
  }

  // 4. manifold voxels, surface, smoothing
  const fixedCells = makeManifold(solid, nx, ny, nz);
  const mesh = voxelSurface(solid, nx, ny, nz, voxel, origin);
  const zBase = origin[2] + cut * voxel;
  if (g.level) snapToSurface(mesh, g.level, voxel, zBase);
  taubin(mesh, g.level ? Math.ceil(o.smoothIterations / 3) : o.smoothIterations, zBase);
  // sit the part on z = 0, centre it on x = y = 0, and bring its longest side back to exactly sizeMm
  // (the wrap and the thickening add a fraction of a millimetre)
  const bb = bounds(mesh.positions);
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const fit = o.sizeMm / Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - zBase);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    mesh.positions[i] = (mesh.positions[i] - cx) * fit; mesh.positions[i + 1] = (mesh.positions[i + 1] - cy) * fit;
    mesh.positions[i + 2] = (mesh.positions[i + 2] - zBase) * fit;
  }

  // 5. checks
  const chk = checkMesh(mesh);
  const bb2 = bounds(mesh.positions);
  const pp = mesh.positions, tt = mesh.indices;
  let baseArea = 0, overArea = 0, total = 0, mx = 0, my = 0, mvol = 0;
  const basePts = [];
  for (let i = 0; i < tt.length; i += 3) {
    const a = tt[i] * 3, b = tt[i + 1] * 3, c = tt[i + 2] * 3;
    const ux = pp[b] - pp[a], uy = pp[b + 1] - pp[a + 1], uz = pp[b + 2] - pp[a + 2];
    const vx = pp[c] - pp[a], vy = pp[c + 1] - pp[a + 1], vz = pp[c + 2] - pp[a + 2];
    const nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
    const area = Math.hypot(nx2, ny2, nz2) / 2; total += area;
    const zMax = Math.max(pp[a + 2], pp[b + 2], pp[c + 2]);
    const cosDown = area > 0 ? -nz2 / (2 * area) : 0;
    if (zMax < 1e-4) { baseArea += area; basePts.push([pp[a], pp[a + 1]], [pp[b], pp[b + 1]], [pp[c], pp[c + 1]]); }
    else if (cosDown > Math.cos(Math.PI / 4) && Math.min(pp[a + 2], pp[b + 2], pp[c + 2]) > 0.3) overArea += area;
    const sv = (pp[a] * (pp[b + 1] * pp[c + 2] - pp[b + 2] * pp[c + 1]) - pp[a + 1] * (pp[b] * pp[c + 2] - pp[b + 2] * pp[c]) + pp[a + 2] * (pp[b] * pp[c + 1] - pp[b + 1] * pp[c])) / 6;
    mx += sv * (pp[a] + pp[b] + pp[c]) / 4; my += sv * (pp[a + 1] + pp[b + 1] + pp[c + 1]) / 4; mvol += sv;
  }
  const com = mvol ? [mx / mvol, my / mvol] : [0, 0];
  const stable = insideHull(convexHull2d(basePts), com[0], com[1]);
  if (!stable) warnings.push("The part may tip over: its weight sits outside its base. Print it with a brim or supports.");
  const overhangPct = total ? (overArea / total) * 100 : 0;
  if (overhangPct > 15) warnings.push(`${overhangPct.toFixed(0)}% of the surface hangs out past 45°: turn on supports.`);
  if (fixedCells) warnings.push(`Joined ${fixedCells} spot(s) that only touched at a corner.`);

  const report = {
    ok: chk.watertight && chk.manifold && chk.volumeMm3 > 0,
    watertight: chk.watertight, manifold: chk.manifold,
    sizeMm: [bb2.max[0] - bb2.min[0], bb2.max[1] - bb2.min[1], bb2.max[2] - bb2.min[2]].map((v) => +v.toFixed(2)),
    volumeMm3: +chk.volumeMm3.toFixed(1),
    gramsPla100: +(chk.volumeMm3 / 1000 * 1.24).toFixed(1), // if printed solid; real prints with infill use less
    triangles: chk.triangles,
    baseAreaMm2: +baseArea.toFixed(1), stable, overhangPct: +overhangPct.toFixed(1),
    voxelMm: +voxel.toFixed(3), minWallMm: o.minWallMm,
    piecesRemoved: pieces.pieces - 1, thinPartsThickened: thinCells > 0,
    warnings,
  };
  return { mesh, report };
}

/**
 * The generator's output: a density field on a regular grid (x fastest), solid where value > threshold.
 * turn is a 3x3 matrix (row-major) of 0/±1 that maps field axes to printer axes (z up).
 * @param {{field: Float32Array, res: number[], threshold: number, turn?: number[]}} f
 */
export function prepareFromField(f, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const [rx, ry, rz] = f.res, F = f.field, th = f.threshold;
  const R = f.turn ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const warnings = [];
  let lo = [INF, INF, INF], hi = [-INF, -INF, -INF];
  for (let k = 0; k < rz; k++) for (let j = 0; j < ry; j++) for (let i = 0; i < rx; i++) {
    if (F[i + rx * (j + ry * k)] <= th) continue;
    const v = [i, j, k]; for (let a = 0; a < 3; a++) { if (v[a] < lo[a]) lo[a] = v[a]; if (v[a] > hi[a]) hi[a] = v[a]; }
  }
  if (lo[0] === INF) throw new Error("The generator didn't find a shape in that picture.");
  const cf = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2), ef = [0, 1, 2].map((a) => hi[a] - lo[a] + 1);
  // extents on the printer's axes
  const ep = [0, 1, 2].map((r) => Math.abs(R[r * 3]) * ef[0] + Math.abs(R[r * 3 + 1]) * ef[1] + Math.abs(R[r * 3 + 2]) * ef[2]);
  const s = o.sizeMm / Math.max(...ep);                     // millimetres per field cell
  let voxel = o.voxelMm > 0 ? o.voxelMm : Math.max(0.2, o.sizeMm / 220);
  const P = Math.ceil(o.minWallMm / voxel) + 3;
  let n = ep.map((e) => Math.ceil((e * s) / voxel) + 2 * P);
  while (n[0] * n[1] * n[2] > o.maxCells) { voxel *= 1.15; n = ep.map((e) => Math.ceil((e * s) / voxel) + 2 * P); }
  const [nx, ny, nz] = n, solid = new Uint8Array(nx * ny * nz);
  const origin = [-P * voxel, -P * voxel, -P * voxel];
  const half = ep.map((e) => (e * s) / 2);
  const at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= rx || j >= ry || k >= rz) ? 0 : F[i + rx * (j + ry * k)];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    // printer position relative to the shape's centre, in field cells
    const q = [(origin[0] + (x + 0.5) * voxel - half[0]) / s, (origin[1] + (y + 0.5) * voxel - half[1]) / s, (origin[2] + (z + 0.5) * voxel - half[2]) / s];
    // field position = centre + R^T q
    const fx = cf[0] + R[0] * q[0] + R[3] * q[1] + R[6] * q[2];
    const fy = cf[1] + R[1] * q[0] + R[4] * q[1] + R[7] * q[2];
    const fz = cf[2] + R[2] * q[0] + R[5] * q[1] + R[8] * q[2];
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz), u = fx - i0, v = fy - j0, w = fz - k0;
    if (i0 < -1 || j0 < -1 || k0 < -1 || i0 >= rx || j0 >= ry || k0 >= rz) continue;
    const val =
      (1 - w) * ((1 - v) * ((1 - u) * at(i0, j0, k0) + u * at(i0 + 1, j0, k0)) + v * ((1 - u) * at(i0, j0 + 1, k0) + u * at(i0 + 1, j0 + 1, k0))) +
      w * ((1 - v) * ((1 - u) * at(i0, j0, k0 + 1) + u * at(i0 + 1, j0, k0 + 1)) + v * ((1 - u) * at(i0, j0 + 1, k0 + 1) + u * at(i0 + 1, j0 + 1, k0 + 1)));
    if (val > th) solid[x + nx * (y + ny * z)] = 1;
  }
  // the same field as a smooth function of a printer position in mm: log(density / threshold)
  const lt = Math.log(th);
  const level = (px, py, pz) => {
    const q0 = (px - half[0]) / s, q1 = (py - half[1]) / s, q2 = (pz - half[2]) / s;
    const fx = cf[0] + R[0] * q0 + R[3] * q1 + R[6] * q2, fy = cf[1] + R[1] * q0 + R[4] * q1 + R[7] * q2, fz = cf[2] + R[2] * q0 + R[5] * q1 + R[8] * q2;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz), u = fx - i0, v = fy - j0, w = fz - k0;
    const val =
      (1 - w) * ((1 - v) * ((1 - u) * at(i0, j0, k0) + u * at(i0 + 1, j0, k0)) + v * ((1 - u) * at(i0, j0 + 1, k0) + u * at(i0 + 1, j0 + 1, k0))) +
      w * ((1 - v) * ((1 - u) * at(i0, j0, k0 + 1) + u * at(i0 + 1, j0, k0 + 1)) + v * ((1 - u) * at(i0, j0 + 1, k0 + 1) + u * at(i0 + 1, j0 + 1, k0 + 1)));
    return Math.log(Math.max(val, 1e-9)) - lt;
  };
  return finishSolid(solid, { nx, ny, nz, voxel, origin, level }, o, warnings);
}
