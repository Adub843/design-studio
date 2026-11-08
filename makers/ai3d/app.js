// Photo to 3D Maker: the page. Photo -> cut-out -> TripoSR (in this browser) -> print prep (a worker) -> 3MF/STL.
import * as gen from "./triposr.js";

const $ = (id) => document.getElementById(id);
const ed = $("ed");
const state = { photo: null, name: "model", cut: null, field: null, result: null, turn: null, busy: false, job: 0 };
const BASE_TURN = [0, 1, 0, -1, 0, 0, 0, 0, 1]; // TripoSR faces +x with z up: face the front of the plate
state.turn = BASE_TURN.slice();

// Local test runs may point the engine at a copy on this site (a path, never another address).
const models = new URLSearchParams(location.search).get("models");
const modelBase = models && /^\/[\w\-/.]*$/.test(models) ? models.replace(/\/?$/, "/") : gen.MODEL_BASE;
const ortLocal = new URLSearchParams(location.search).get("ort");
if (ortLocal && /^\/[\w\-/.]*$/.test(ortLocal)) gen.setOrtBase(new URL(ortLocal.replace(/\/?$/, "/"), location.origin).href);

function toast(msg) {
  let box = document.querySelector(".toasts");
  if (!box) { box = Object.assign(document.createElement("div"), { className: "toasts" }); box.setAttribute("role", "status"); document.body.append(box); }
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  box.append(t); setTimeout(() => t.remove(), 4200);
}
function showError(msg) { const e = $("err"); e.textContent = msg; e.hidden = !msg; if (msg) openTool("photo"); }

// ---------- tools and sheets ----------
function openTool(tool) {
  for (const b of document.querySelectorAll(".ed-rail button")) b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
  for (const s of document.querySelectorAll("[data-panel]")) s.hidden = s.dataset.panel !== tool;
  ed.dataset.sheet = matchMedia("(max-width:860px)").matches ? (tool === "print" ? "print" : "tool") : "";
}
for (const b of document.querySelectorAll(".ed-rail button")) b.addEventListener("click", () => {
  const phone = matchMedia("(max-width:860px)").matches;
  if (phone && b.getAttribute("aria-pressed") === "true" && ed.dataset.sheet) { ed.dataset.sheet = ""; return; }
  if (b.dataset.tool === "print") { for (const x of document.querySelectorAll(".ed-rail button")) x.setAttribute("aria-pressed", String(x === b)); ed.dataset.sheet = "print"; return; }
  openTool(b.dataset.tool);
});
for (const x of document.querySelectorAll("[data-close]")) x.addEventListener("click", () => { ed.dataset.sheet = ""; });
const rail = document.querySelector(".ed-rail");
new ResizeObserver(() => document.documentElement.style.setProperty("--barh", rail.offsetHeight + "px")).observe(rail);

// ---------- photo ----------
const fileIn = $("file");
const pick = () => fileIn.click();
$("drop").addEventListener("click", pick); $("emptyAdd").addEventListener("click", pick); $("topNew").addEventListener("click", pick);
fileIn.addEventListener("change", () => fileIn.files[0] && usePhoto(fileIn.files[0]));
const drop = $("drop");
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) usePhoto(f); });

async function usePhoto(file) {
  showError("");
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return showError("Use a JPG, PNG or WebP photo.");
  if (file.size > 25 * 1024 * 1024) return showError("That photo is over 25 MB. Use a smaller one.");
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return showError("That photo couldn't be opened."); }
  // big photos are slow and add nothing at 512 px: keep the long side at 1600 px
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  if (k < 1) bmp = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: "high" });
  state.photo = bmp; state.cut = null; state.field = null;
  state.name = file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "model";
  $("thumbIn").src = URL.createObjectURL(file);
  const tc = $("thumbCut"); tc.getContext("2d").clearRect(0, 0, tc.width, tc.height);
  $("thumbs").hidden = false; $("make").disabled = false; $("topNew").hidden = false;
  openTool("photo");
}

// ---------- making the model ----------
const STEPS = ["engine", "cut", "shape", "detail", "print"];
function step(name, note = "") {
  const at = STEPS.indexOf(name);
  for (const li of $("steps").children) { const i = STEPS.indexOf(li.dataset.step); li.className = i < at ? "done" : i === at ? "on" : ""; }
  $("busyNote").textContent = note;
  if (name !== "engine") $("barFill").style.width = `${Math.round(((at + 0.5) / STEPS.length) * 100)}%`;
}
function setBusy(on) {
  state.busy = on; $("busy").hidden = !on; $("make").disabled = on || !state.photo;
  if (on) $("empty").hidden = true;
}

$("make").addEventListener("click", makeModel);
async function makeModel() {
  if (!state.photo || state.busy) return;
  showError(""); setBusy(true);
  if (matchMedia("(max-width:860px)").matches) ed.dataset.sheet = "";
  try {
    step("engine", gen.hasWebGpu() ? "First time only: about 490 MB, then it's kept on this device." : "This browser has no WebGPU, so this will be slow. Chrome or Edge on a computer is fastest.");
    const s = await loadEngine((f) => { $("barFill").style.width = `${Math.round(f * 100 * 0.2)}%`; $("busyNote").textContent = `Downloading the 3D engine: ${Math.round(f * 100)}%`; });
    step("cut");
    const cut = await gen.cutOut(state.photo, s);
    const input = gen.modelInput(cut);
    const tc = $("thumbCut"), g = tc.getContext("2d"); g.clearRect(0, 0, tc.width, tc.height); g.drawImage(input.preview, 0, 0, tc.width, tc.height);
    state.field = await gen.generateField(s, input.tensor, { onStep: (n) => step(n) });
    state.turn = BASE_TURN.slice();
    await buildPrint();
  } catch (e) {
    console.error(e);
    setBusy(false);
    showError(String(e?.message ?? e).slice(0, 300) || "Something went wrong. Try again.");
    if (!state.result) $("empty").hidden = false;
  }
}
let engineP = null;
function loadEngine(onProgress) {
  if (modelBase !== gen.MODEL_BASE) gen.setModelBase?.(modelBase);
  engineP ??= gen.loadEngine(onProgress).catch((e) => { engineP = null; throw e; });
  return engineP;
}

// ---------- print prep in a worker ----------
const worker = new Worker(new URL("./prep-worker.js", import.meta.url), { type: "module" });
const pending = new Map();
worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); } };
function options() { return { sizeMm: Number($("size").value), minWallMm: Number($("wall").value), flatBase: $("base").value === "1" }; }

async function buildPrint() {
  if (!state.field) return;
  const id = ++state.job;
  setBusy(true); step("print");
  const f = state.field;
  const out = await new Promise((ok) => { pending.set(id, ok); worker.postMessage({ id, field: f.field, res: f.res, threshold: f.threshold, turn: state.turn, options: options(), title: state.name }); });
  if (id !== state.job) return; // a newer change is on its way
  setBusy(false);
  if (!out.ok) return showError(out.error);
  state.result = out;
  $("barFill").style.width = "100%";
  showModel(out.positions, out.indices);
  showReport(out.report);
  $("top3mf").disabled = false;
}
let timer = 0;
const rebuild = () => { clearTimeout(timer); timer = setTimeout(buildPrint, 250); };
$("size").addEventListener("input", () => { $("sizeOut").textContent = `${$("size").value} mm`; });
for (const id of ["size", "wall", "base"]) $(id).addEventListener("change", rebuild);
const ROT = { x: [1, 0, 0, 0, 0, -1, 0, 1, 0], y: [0, 0, 1, 0, 1, 0, -1, 0, 0], z: [0, -1, 0, 1, 0, 0, 0, 0, 1] };
const mul = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
for (const b of document.querySelectorAll("[data-turn]")) b.addEventListener("click", () => { state.turn = mul(ROT[b.dataset.turn], state.turn); rebuild(); });
$("turnReset").addEventListener("click", () => { state.turn = BASE_TURN.slice(); rebuild(); });

// ---------- report and downloads ----------
const ICON = { ok: '<path d="M20 6 9 17l-5-5"/>', warn: '<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>', bad: '<path d="M6 6l12 12M18 6 6 18"/>' };
function li(kind, text) {
  const el = document.createElement("li"); el.className = kind;
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[kind]}</svg>`;
  el.append(Object.assign(document.createElement("span"), { textContent: text }));
  return el;
}
function showReport(r) {
  $("noResult").hidden = true; $("result").hidden = false;
  const facts = [["Size", r.sizeMm.map((v) => v.toFixed(1)).join(" × ") + " mm"], ["Weight if solid", `${r.gramsPla100} g PLA`], ["Triangles", r.triangles.toLocaleString()]];
  $("facts").replaceChildren(...facts.flatMap(([k, v]) => [Object.assign(document.createElement("dt"), { textContent: k }), Object.assign(document.createElement("dd"), { textContent: v })]));
  const list = [
    r.watertight && r.manifold ? li("ok", "Solid and watertight: slices cleanly") : li("bad", "Not watertight. Try another photo."),
    li("ok", `Every wall at least ${r.minWallMm} mm`),
    r.stable ? li("ok", "Stands on its base") : null,
  ].filter(Boolean);
  for (const w of r.warnings) if (!/^(Thickened|Joined)/.test(w)) list.push(li(/tip over|supports/.test(w) ? "warn" : "ok", w));
  $("checks").replaceChildren(...list);
}
function save(bytes, name, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const fileName = (ext) => `${state.name}-${$("size").value}mm.${ext}`;
const dl3mf = () => state.result && save(state.result.tmf, fileName("3mf"), "model/3mf");
$("dl3mf").addEventListener("click", dl3mf); $("top3mf").addEventListener("click", dl3mf);
$("dlStl").addEventListener("click", () => state.result && save(state.result.stl, fileName("stl"), "model/stl"));

// ---------- 3D view ----------
let three = null;
function loadScript(srcs) {
  return new Promise((ok, no) => { let i = 0; const next = () => { if (i >= srcs.length) return no(new Error("The 3D view couldn't load.")); const s = document.createElement("script"); s.src = srcs[i++]; s.onload = ok; s.onerror = () => { s.remove(); next(); }; document.head.append(s); }; next(); });
}
async function view() {
  if (three) return three;
  if (!window.THREE) await loadScript(["../vendor/three.min.js", "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", "https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"]);
  if (!window.THREE.OrbitControls) await loadScript(["../vendor/OrbitControls.js", "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"]);
  const canvas = $("view3d");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(-120, -200, 260); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35); rim.position.set(200, 160, 120); scene.add(rim);
  // the build plate: a soft square with a fine grid, like a slicer
  const dark = document.documentElement.dataset.theme === "dark";
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(256, 256), new THREE.MeshStandardMaterial({ color: dark ? 0x3a3f47 : 0x8c8c92, roughness: 0.9, metalness: 0.1 }));
  plate.position.z = -0.05; scene.add(plate);
  const grid = dark ? new THREE.GridHelper(256, 16, 0x5c636e, 0x4a5059) : new THREE.GridHelper(256, 16, 0x76767b, 0x7f7f85); grid.rotation.x = Math.PI / 2; scene.add(grid);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49;
  const fit = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(fit).observe(canvas); fit();
  (function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
  three = { scene, camera, controls, renderer, mesh: null };
  return three;
}
async function showModel(positions, indices) {
  const v = await view();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.62, metalness: 0.02 });
  if (v.mesh) { v.scene.remove(v.mesh); v.mesh.geometry.dispose(); v.mesh.material.dispose(); }
  v.mesh = new THREE.Mesh(geo, mat); v.scene.add(v.mesh);
  const r = geo.boundingSphere.radius, c = geo.boundingSphere.center;
  v.controls.target.copy(c);
  const d = (r / Math.sin((v.camera.fov * Math.PI) / 360)) * 1.15 / Math.min(1, v.camera.aspect);
  v.camera.position.set(c.x + d * 0.45, c.y - d * 0.8, c.z + d * 0.4);
  v.camera.near = r / 50; v.camera.far = r * 60; v.camera.updateProjectionMatrix();
  $("empty").hidden = true;
}

if (matchMedia("(max-width:860px)").matches) ed.dataset.sheet = "";
view().catch(() => {});

// ---------- EPIX3D: save, open, order (see the EPIX_MAKER block in index.html) ----------
function photoUrl(max = 1024) {
  const b = state.photo, k = Math.min(1, max / Math.max(b.width, b.height));
  const c = document.createElement("canvas"); c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
  c.getContext("2d").drawImage(b, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.88);
}
window.AI3D = {
  name: () => (state.name && state.name !== "model" ? state.name.replace(/-/g, " ") : "Photo to 3D model").slice(0, 80),
  hasContent: () => !!state.photo,
  getState: () => ({ v: 1, name: state.name, photo: state.photo ? photoUrl() : null, size: $("size").value, wall: $("wall").value, base: $("base").value, turn: state.turn }),
  async setState(d) {
    if (!d || !d.photo) throw new Error("no design");
    const blob = await (await fetch(d.photo)).blob();
    await usePhoto(new File([blob], `${d.name || "model"}.jpg`, { type: "image/jpeg" }));
    if (d.size) { $("size").value = d.size; $("sizeOut").textContent = `${d.size} mm`; }
    if (d.wall) $("wall").value = d.wall;
    if (d.base) $("base").value = d.base;
    toast("Photo loaded. Press Make 3D model to build it again.");
  },
  async thumb() {
    if (!three || !three.mesh) return state.photo ? photoUrl(480) : "";
    three.renderer.render(three.scene, three.camera);
    const src = three.renderer.domElement, W = 480, H = Math.max(1, Math.round(W * src.height / src.width));
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    g.fillStyle = "#ececec"; g.fillRect(0, 0, W, H); g.drawImage(src, 0, 0, W, H);
    return c.toDataURL("image/jpeg", 0.82);
  },
  async buildPrintFile() {
    if (!state.result) throw new Error("Make the 3D model first.");
    const r = state.result.report, name = fileName("3mf");
    return { blob: new Blob([state.result.tmf], { type: "model/3mf" }), name, details: `Photo to 3D model, ${r.sizeMm.map((v) => v.toFixed(0)).join(" x ")} mm, walls ${r.minWallMm} mm` };
  },
};
window.AI3D_READY?.();
