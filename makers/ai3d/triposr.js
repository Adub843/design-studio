// The 3D generator, run in the customer's own browser: one photo in, a density field out.
// Model: TripoSR (MIT, Stability AI + Tripo AI), as the ONNX/WebGPU export cgb/triposr-onnx-webgpu
// (MIT weights, Apache-2.0 DINO encoder). Cut-out: U-2-Netp (Apache-2.0), shipped with the site.
// Nothing leaves the device and nothing is billed per model.

export const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs";
export const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
export const MODEL_BASE = "https://huggingface.co/cgb/triposr-onnx-webgpu/resolve/main/";
let modelBase = MODEL_BASE;
export const setModelBase = (b) => { modelBase = b; };
export const CUTOUT_URL = new URL("./u2netp.onnx", import.meta.url).href;

// TripoSR's own settings: the scene lives in a cube of half-size 0.87 and the surface is density 25.
export const RADIUS = 0.87, THRESHOLD = 25;
const PLANE = 64, CH = 40, FEAT = 120;

let ortP = null, ortBase = ORT_WASM;
export const setOrtBase = (b) => { ortBase = b; };
export function loadOrt() {
  ortP ??= import(ortBase + "ort.webgpu.min.mjs").then((ort) => { ort.env.wasm.wasmPaths = ortBase; ort.env.wasm.numThreads = 1; return ort; });
  return ortP;
}
export const hasWebGpu = () => typeof navigator !== "undefined" && !!navigator.gpu;

// Download with progress, kept in the browser's cache so the second visit starts at once.
const CACHE = "epix3d-models-v1";
async function fetchBytes(url, onProgress) {
  let cache = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) { onProgress?.(1); return new Uint8Array(await hit.arrayBuffer()); } } catch { cache = null; }
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Couldn't download the 3D engine (${res.status}). Check the connection and try again.`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader(), parts = [];
  let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (total) onProgress?.(got / total); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  try { await cache?.put(url, new Response(out, { headers: { "content-type": "application/octet-stream" } })); } catch { /* storage full or private window: fine */ }
  onProgress?.(1);
  return out;
}

let sessions = null;
/** Loads the cut-out model and TripoSR (about 490 MB the first time). */
export async function loadEngine(onProgress = () => {}) {
  if (sessions) return sessions;
  const ort = await loadOrt();
  const ep = hasWebGpu() ? ["webgpu", "wasm"] : ["wasm"];
  const [cut, tri, data, dec] = await Promise.all([
    fetchBytes(CUTOUT_URL),
    fetchBytes(modelBase + "triplane_q8.onnx"),
    fetchBytes(modelBase + "triplane_q8.onnx.data", onProgress),
    fetchBytes(modelBase + "decoder.onnx"),
  ]);
  sessions = {
    ort,
    cutout: await ort.InferenceSession.create(cut, { executionProviders: ["wasm"] }),
    triplane: await ort.InferenceSession.create(tri, { executionProviders: ep, externalData: [{ path: "triplane_q8.onnx.data", data }] }),
    decoder: await ort.InferenceSession.create(dec, { executionProviders: ep }),
    gpu: ep[0] === "webgpu",
  };
  return sessions;
}

// ---------- the photo ----------
const canvas = (w, h) => { const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }); return c; };

/** Returns a canvas of the subject on a transparent background. Uses the photo's own transparency if it has some. */
export async function cutOut(bitmap, s) {
  const W = bitmap.width, H = bitmap.height;
  const c = canvas(W, H), g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0);
  const img = g.getImageData(0, 0, W, H);
  let clear = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) clear++;
  if (clear > W * H * 0.02) return c; // already cut out
  // U-2-Netp at 320 x 320, ImageNet normalisation (as rembg does)
  const S = 320, sc = canvas(S, S), sg = sc.getContext("2d", { willReadFrequently: true });
  sg.drawImage(bitmap, 0, 0, S, S);
  const px = sg.getImageData(0, 0, S, S).data;
  let mx = 1; for (let i = 0; i < px.length; i++) if ((i & 3) !== 3 && px[i] > mx) mx = px[i];
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225], x = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let k = 0; k < 3; k++) x[k * S * S + i] = (px[i * 4 + k] / mx - mean[k]) / std[k];
  const out = await s.cutout.run({ [s.cutout.inputNames[0]]: new s.ort.Tensor("float32", x, [1, 3, S, S]) });
  const m = out[s.cutout.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < S * S; i++) { if (m[i] < lo) lo = m[i]; if (m[i] > hi) hi = m[i]; }
  const mc = canvas(S, S), mg = mc.getContext("2d"), md = mg.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { md.data[i * 4 + 3] = Math.round(255 * (m[i] - lo) / (hi - lo || 1)); }
  mg.putImageData(md, 0, 0);
  // scale the mask up to the photo and keep the photo's colours where the mask is
  const big = canvas(W, H), bg = big.getContext("2d", { willReadFrequently: true });
  bg.imageSmoothingQuality = "high"; bg.drawImage(mc, 0, 0, W, H);
  const a = bg.getImageData(0, 0, W, H).data;
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = a[i];
  g.putImageData(img, 0, 0);
  return c;
}

/** The model's input: subject cropped, 85% of a 512 square, on mid grey (white makes phantom shapes). */
export function modelInput(cut) {
  const W = cut.width, H = cut.height, g = cut.getContext("2d", { willReadFrequently: true });
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error("No object was found in that photo. Try a photo with one object on a plain background.");
  const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) / 0.85, S = 512;
  const c = canvas(S, S), cg = c.getContext("2d", { willReadFrequently: true });
  cg.fillStyle = "rgb(128,128,128)"; cg.fillRect(0, 0, S, S);
  const k = S / side, w = (x1 - x0 + 1) * k, h = (y1 - y0 + 1) * k;
  cg.imageSmoothingQuality = "high";
  cg.drawImage(cut, x0, y0, x1 - x0 + 1, y1 - y0 + 1, (S - w) / 2, (S - h) / 2, w, h);
  const p = cg.getImageData(0, 0, S, S).data, t = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) for (let ch = 0; ch < 3; ch++) t[ch * S * S + i] = p[i * 4 + ch] / 255;
  return { tensor: t, preview: c };
}

// ---------- the shape ----------
// grid_sample(align_corners=false, padding zeros) of one 64 x 64 plane with 40 channels, written into feat.
function samplePlane(tp, plane, u, v, feat, off) {
  const fx = ((u + 1) * PLANE - 1) / 2, fy = ((v + 1) * PLANE - 1) / 2;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
  const in0x = x0 >= 0 && x0 < PLANE, in1x = x0 + 1 >= 0 && x0 + 1 < PLANE, in0y = y0 >= 0 && y0 < PLANE, in1y = y0 + 1 >= 0 && y0 + 1 < PLANE;
  const base = plane * CH * PLANE * PLANE;
  for (let c = 0; c < CH; c++) {
    const b = base + c * PLANE * PLANE;
    let s = 0;
    if (in0y) { const r = b + y0 * PLANE; if (in0x) s += w00 * tp[r + x0]; if (in1x) s += w10 * tp[r + x0 + 1]; }
    if (in1y) { const r = b + (y0 + 1) * PLANE; if (in0x) s += w01 * tp[r + x0]; if (in1x) s += w11 * tp[r + x0 + 1]; }
    feat[off + c] = s;
  }
}
export function featuresAt(tp, pts, n) {
  const feat = new Float32Array(n * FEAT);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    samplePlane(tp, 0, x, y, feat, i * FEAT); samplePlane(tp, 1, x, z, feat, i * FEAT + CH); samplePlane(tp, 2, y, z, feat, i * FEAT + 2 * CH);
  }
  return feat;
}

async function densities(s, tp, pts, n, batch = 65536) {
  const out = new Float32Array(n);
  for (let b = 0; b < n; b += batch) {
    const m = Math.min(batch, n - b);
    const feat = featuresAt(tp, pts.subarray(b * 3, (b + m) * 3), m);
    const r = await s.decoder.run({ features: new s.ort.Tensor("float32", feat, [m, FEAT]) });
    out.set(r.density.data.subarray(0, m), b);
  }
  return out;
}

/**
 * Photo tensor -> density field on a res^3 grid over [-1, 1]^3 (x fastest), solid where > THRESHOLD.
 * Coarse first (res/3), then the full resolution only near the surface, so it stays fast in a browser.
 */
export async function generateField(s, tensor, { res = 192, onStep = () => {} } = {}) {
  onStep("shape");
  const tri = await s.triplane.run({ image: new s.ort.Tensor("float32", tensor, [1, 3, 512, 512]) });
  const tp = tri.triplane.data;
  const k = 3, rc = Math.round(res / k), n = rc * k;
  const at = (i, r) => -1 + (2 * i + 1) / r;
  const cp = new Float32Array(rc ** 3 * 3);
  for (let z = 0, q = 0; z < rc; z++) for (let y = 0; y < rc; y++) for (let x = 0; x < rc; x++, q += 3) { cp[q] = at(x, rc); cp[q + 1] = at(y, rc); cp[q + 2] = at(z, rc); }
  const coarse = await densities(s, tp, cp, rc ** 3);
  onStep("detail");
  // coarse cells next to the surface (or next to one that is) get the full resolution
  const near = new Uint8Array(rc ** 3), ci = (x, y, z) => x + rc * (y + rc * z);
  for (let z = 0; z < rc; z++) for (let y = 0; y < rc; y++) for (let x = 0; x < rc; x++) {
    const inside = coarse[ci(x, y, z)] > THRESHOLD;
    let edge = false;
    for (let dz = -2; dz <= 2 && !edge; dz++) for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2 && !edge; dx++) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= rc || Y >= rc || Z >= rc) continue;
      if ((coarse[ci(X, Y, Z)] > THRESHOLD) !== inside) edge = true;
    }
    if (edge) near[ci(x, y, z)] = 1;
  }
  const field = new Float32Array(n ** 3);
  const fine = [];
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = ci((x / k) | 0, (y / k) | 0, (z / k) | 0);
    if (near[c]) fine.push(x + n * (y + n * z)); else field[x + n * (y + n * z)] = coarse[c];
  }
  const fp = new Float32Array(fine.length * 3);
  for (let i = 0; i < fine.length; i++) { const id = fine[i], x = id % n, y = ((id / n) | 0) % n, z = (id / (n * n)) | 0; fp[i * 3] = at(x, n); fp[i * 3 + 1] = at(y, n); fp[i * 3 + 2] = at(z, n); }
  const fd = await densities(s, tp, fp, fine.length);
  for (let i = 0; i < fine.length; i++) field[fine[i]] = fd[i];
  return { field, res: [n, n, n], threshold: THRESHOLD };
}
