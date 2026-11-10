// EPIX3D parametric maker engine: one shared editor for the makers that are built from numbers rather than
// pictures (vase, organizer, pixel puzzle, dice, flexi animals). Each maker page loads this module with its
// own generator (makers/<id>/gen.js). The page's inline script sets window.EPIX_MAKER, which waits for
// window.PARAM (filled in here); the site bridge (/assets/epix-bridge.js) then adds Save, Order and the
// Platinum gate on downloads.
//
// A generator is { id, title, fileName, intro, sections:[{ title, fields:[field] }], defaults, build(p, kit) }.
// A field is { key, label, type: "range"|"select"|"check"|"color"|"text"|"image", min, max, step, unit, options, hint, show(p) }.
// build() returns { objects:[{ name, color, plate, mesh:{ pos:Float32Array, idx:Uint32Array } }], checks:[[level, text]], notes:[text] }.
// Meshes are in mm, Z up, resting on Z = 0. Objects on plate 2+ go on extra build plates in the 3MF.

const THREE = window.THREE;
const PLATE = 256;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const round = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;

import { loadManifold, meshOf, boxMesh, joinMeshes, bounds, translate, isClosed, volume } from "/makers/param/geom.js";
export { loadManifold, meshOf, boxMesh, joinMeshes, bounds, translate, isClosed, volume };

/* CSG makers build in a worker: manifold-3d's bindings compile code at run time, which the page's security
   policy forbids; only the worker script (which can't touch the page) is allowed to. */
let csgWorker = null, csgSeq = 0; const csgWait = new Map();
function csgBuild(id, p) {
  if (!csgWorker) { csgWorker = new Worker("/makers/param/csg-worker.js", { type: "module" }); csgWorker.onmessage = (e) => { const w = csgWait.get(e.data.seq); if (!w) return; csgWait.delete(e.data.seq); e.data.error ? w.no(new Error(e.data.error)) : w.ok(e.data.result); };
    csgWorker.onerror = (e) => { for (const w of csgWait.values()) w.no(new Error(e.message || "The 3D engine stopped.")); csgWait.clear(); csgWorker = null; }; }
  const seq = ++csgSeq; return new Promise((ok, no) => { csgWait.set(seq, { ok, no }); csgWorker.postMessage({ seq, id, p }); });
}

/* ---------------- file writers ---------------- */
function hex2rgb(h) { const n = parseInt(String(h).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function stl(mesh, name) {
  const I = mesh.idx, P = mesh.pos, n = I.length / 3; const buf = new ArrayBuffer(84 + n * 50); const dv = new DataView(buf);
  const head = (name || "EPIX3D").slice(0, 79); for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 127); dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) { const o = 84 + t * 50; const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (const [j, v] of [[0, a], [1, b], [2, c]]) for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + j * 12 + k * 4, P[v + k], true); }
  return new Blob([buf], { type: "model/stl" });
}
// 3MF with one object per part, a colour per object, and a build item per object placed on its plate
// (Bambu Studio and PrusaSlicer both read the objects; Bambu splits plates by position).
async function threeMF(objects, title) {
  const zip = new window.JSZip(); const f = (v) => (Math.round(v * 1000) / 1000).toString();
  const mats = objects.map((o, i) => `<base name="${esc(o.name)}" displaycolor="${(o.color || "#cccccc").toUpperCase()}FF"/>`).join("");
  let res = `<basematerials id="1">${mats}</basematerials>`; let items = "";
  objects.forEach((o, i) => { const id = i + 2; const m = o.placed; const P = m.pos, I = m.idx; const vs = []; for (let v = 0; v < P.length; v += 3) vs.push(`<vertex x="${f(P[v])}" y="${f(P[v + 1])}" z="${f(P[v + 2])}"/>`);
    const ts = []; for (let t = 0; t < I.length; t += 3) ts.push(`<triangle v1="${I[t]}" v2="${I[t + 1]}" v3="${I[t + 2]}"/>`);
    res += `<object id="${id}" name="${esc(o.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${vs.join("")}</vertices><triangles>${ts.join("")}</triangles></mesh></object>`;
    items += `<item objectid="${id}" printable="1"/>`; });
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`);
  zip.file("3D/3dmodel.model", `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${esc(title)}</metadata><metadata name="Application">EPIX3D</metadata><metadata name="Designer">EPIX3D (epix3d.com)</metadata><resources>${res}</resources><build>${items}</build></model>`);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "model/3mf" });
}

// Normals smoothed only across edges flatter than 35°: flat faces stay flat, curves look round.
function creased(mesh) {
  const P = mesh.pos, I = mesh.idx, nt = I.length / 3; const pos = new Float32Array(nt * 9), fn = new Float32Array(nt * 3); const at = new Map();
  for (let t = 0; t < nt; t++) { const v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]; for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) pos[t * 9 + j * 3 + k] = P[v[j] * 3 + k];
    const o = t * 9, ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2], vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l;
    for (let j = 0; j < 3; j++) { const key = `${Math.round(pos[o + j * 3] * 1e3)},${Math.round(pos[o + j * 3 + 1] * 1e3)},${Math.round(pos[o + j * 3 + 2] * 1e3)}`; let list = at.get(key); if (!list) at.set(key, (list = [])); list.push(t); } }
  const nor = new Float32Array(nt * 9), lim = Math.cos(35 * Math.PI / 180);
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) { const o = t * 9 + j * 3; const key = `${Math.round(pos[o] * 1e3)},${Math.round(pos[o + 1] * 1e3)},${Math.round(pos[o + 2] * 1e3)}`; let x = 0, y = 0, z = 0;
    for (const f of at.get(key)) { const d = fn[f * 3] * fn[t * 3] + fn[f * 3 + 1] * fn[t * 3 + 1] + fn[f * 3 + 2] * fn[t * 3 + 2]; if (d >= lim) { x += fn[f * 3]; y += fn[f * 3 + 1]; z += fn[f * 3 + 2]; } }
    const l = Math.hypot(x, y, z) || 1; nor[o] = x / l; nor[o + 1] = y / l; nor[o + 2] = z / l; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); return g;
}

/* ---------------- the editor ---------------- */
const ICON = { ok: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 6v5M10 13.6v.1" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  bad: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' };

export function startMaker(gen) {
  const S = { p: structuredClone(gen.defaults), name: gen.title + " design", result: null, busy: false, gen: 0, images: {} };
  const root = $("#pm");
  root.innerHTML = `
  <div class="pm-ed">
    <aside class="pm-panel" id="pmPanel" aria-label="Settings"><div class="pm-head"><input class="pm-name" id="pmName" aria-label="Design name" maxlength="80" value="${esc(S.name)}"><p class="pm-intro">${esc(gen.intro)}</p></div><div id="pmFields"></div></aside>
    <main class="pm-view" id="pmView"><div class="pm-gl" id="pmGl"></div><div class="pm-tag">Design preview</div><div class="pm-busy" id="pmBusy" hidden>Building…</div>
      <div class="pm-cam" role="toolbar" aria-label="Camera"><button type="button" data-cam="iso">Iso</button><button type="button" data-cam="top">Top</button><button type="button" data-cam="front">Front</button></div>
      <div class="pm-plates" id="pmPlates" hidden></div></main>
    <aside class="pm-print" id="pmPrint" aria-label="Print"><h2>Print</h2><dl class="pm-kv" id="pmSize"></dl><h3>Print check</h3><ul class="pm-checks" id="pmChecks"></ul>
      <button type="button" class="pm-btn pm-primary" id="pmExport">Download 3MF</button><button type="button" class="pm-btn" id="pmStl">Download STL</button>
      <p class="pm-note" id="pmNote"></p></aside>
  </div>
  <nav class="pm-tabs" aria-label="Sections"><button type="button" data-tab="pmPanel" aria-pressed="true">Design</button><button type="button" data-tab="pmPrint" aria-pressed="false">Print</button></nav>`;

  /* settings panel */
  const fieldHTML = (f) => {
    const v = S.p[f.key]; const id = "f_" + f.key; const hint = f.hint ? `<small>${esc(f.hint)}</small>` : "";
    if (f.type === "range") return `<label class="pm-f" data-k="${f.key}"><span>${esc(f.label)}<b id="${id}_v">${esc(fmt(f, v))}</b></span><input type="range" id="${id}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${v}">${hint}</label>`;
    if (f.type === "select") return `<label class="pm-f" data-k="${f.key}"><span>${esc(f.label)}</span><select id="${id}">${f.options.map(([k, t]) => `<option value="${esc(k)}"${String(k) === String(v) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>${hint}</label>`;
    if (f.type === "check") return `<label class="pm-f pm-chk" data-k="${f.key}"><input type="checkbox" id="${id}"${v ? " checked" : ""}><span>${esc(f.label)}</span>${hint}</label>`;
    if (f.type === "color") return `<label class="pm-f pm-col" data-k="${f.key}"><span>${esc(f.label)}</span><input type="color" id="${id}" value="${esc(v)}">${hint}</label>`;
    if (f.type === "text") return `<label class="pm-f" data-k="${f.key}"><span>${esc(f.label)}</span><input type="text" id="${id}" maxlength="${f.max || 40}" value="${esc(v)}">${hint}</label>`;
    if (f.type === "image") return `<div class="pm-f" data-k="${f.key}"><span>${esc(f.label)}</span><button type="button" class="pm-drop" id="${id}_b">${S.images[f.key] ? "Change the picture" : "Choose a picture"}</button><input type="file" id="${id}" accept="image/*" hidden>${hint}</div>`;
    return "";
  };
  const fmt = (f, v) => (f.format ? f.format(v) : `${v}${f.unit || ""}`);
  function renderFields() {
    $("#pmFields").innerHTML = gen.sections.map((s) => `<section class="pm-sec"><h3>${esc(s.title)}</h3>${s.fields.filter((f) => !f.show || f.show(S.p)).map(fieldHTML).join("")}</section>`).join("");
    for (const s of gen.sections) for (const f of s.fields) {
      const el = $("#f_" + f.key); if (!el) continue;
      if (f.type === "image") { $("#f_" + f.key + "_b").onclick = () => el.click(); el.onchange = async () => { const file = el.files[0]; el.value = ""; if (!file) return; S.images[f.key] = await readImage(file); S.p[f.key] = S.images[f.key].url; renderFields(); schedule(); }; continue; }
      const read = () => f.type === "check" ? el.checked : f.type === "range" ? Number(el.value) : f.type === "select" ? (typeof gen.defaults[f.key] === "number" ? Number(el.value) : el.value) : el.value;
      el.addEventListener(f.type === "range" || f.type === "text" ? "input" : "change", () => { S.p[f.key] = read(); const o = $("#f_" + f.key + "_v"); if (o) o.textContent = fmt(f, S.p[f.key]); if (gen.sections.some((x) => x.fields.some((y) => y.show))) { const prev = document.activeElement?.id; renderFields(); if (prev) $("#" + prev)?.focus(); } schedule(); });
    }
  }
  async function readImage(file) {
    // kept small (longest side 800 px, JPEG) so a saved project stays light
    const raw = URL.createObjectURL(file); const im = await loadImg(raw); URL.revokeObjectURL(raw);
    const k = Math.min(1, 800 / Math.max(im.width, im.height)); const c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); const url = c.toDataURL("image/jpeg", 0.88);
    return { url, img: await loadImg(url) };
  }
  const loadImg = (url) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("That picture couldn't be opened.")); im.src = url; });
  $("#pmName").oninput = (e) => { S.name = e.target.value; };

  /* 3D view: studio light, a textured build plate, matte PLA */
  const gl = $("#pmGl"); const R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setPixelRatio(Math.min(2, devicePixelRatio || 1)); R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap; R.outputEncoding = THREE.sRGBEncoding; R.toneMapping = THREE.ACESFilmicToneMapping; R.setClearColor(0, 0); gl.appendChild(R.domElement);
  const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(30, 1, 1, 6000); cam.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d929b, 0.75));
  const key = new THREE.DirectionalLight(0xfff6ee, 1.0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.3; Object.assign(key.shadow.camera, { left: -400, right: 400, top: 400, bottom: -400, near: 10, far: 2500 }); scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0xdfe7ff, 0.35); scene.add(fill);
  const pm = new THREE.PMREMGenerator(R); const es = new THREE.Scene(); es.add(new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), new THREE.MeshBasicMaterial({ color: 0x9a9fa8, side: THREE.BackSide })));
  const lamp = (x, y, z, w, h, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m); };
  lamp(0, -10, 70, 80, 60, 2.2); lamp(-60, -40, 35, 34, 60, 1.4); lamp(65, 30, 30, 30, 55, 1.1); scene.environment = pm.fromScene(es, 0.04).texture;
  const orbit = new THREE.OrbitControls(cam, R.domElement); orbit.enableDamping = true; orbit.dampingFactor = 0.12; orbit.screenSpacePanning = true; orbit.maxPolarAngle = Math.PI * 0.495;
  const plates = new THREE.Group(), parts = new THREE.Group(); scene.add(plates, parts);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.ShadowMaterial({ opacity: 0.15 })); ground.position.z = -6.3; ground.receiveShadow = true; scene.add(ground);
  const plateTex = (label) => { const c = document.createElement("canvas"); c.width = c.height = 1024; const x = c.getContext("2d"); const id = x.createImageData(1024, 1024);
    for (let i = 0; i < id.data.length; i += 4) { const n = 44 + (Math.random() - 0.5) * 18; id.data[i] = id.data[i + 1] = id.data[i + 2] = n; id.data[i + 3] = 255; } x.putImageData(id, 0, 0);
    const st = 1024 / (PLATE / 10); for (let k = 1; k < PLATE / 10; k++) { const major = k % 5 === 0; x.strokeStyle = major ? "rgba(255,255,255,.085)" : "rgba(255,255,255,.035)"; x.lineWidth = major ? 2 : 1; x.beginPath(); x.moveTo(k * st, 0); x.lineTo(k * st, 1024); x.stroke(); x.beginPath(); x.moveTo(0, k * st); x.lineTo(1024, k * st); x.stroke(); }
    x.strokeStyle = "rgba(255,255,255,.18)"; x.lineWidth = 4; x.strokeRect(10, 10, 1004, 1004); x.fillStyle = "rgba(255,255,255,.55)"; x.font = '600 30px Inter, "Segoe UI", Arial, sans-serif'; x.fillText(label, 34, 988);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; };
  const STRIDE = PLATE * 1.15; const plateXY = (i) => [i * STRIDE, 0];
  function drawPlates(n) {
    while (plates.children.length) { const o = plates.children.pop(); o.geometry.dispose(); }
    for (let i = 0; i < n; i++) { const [cx, cy] = plateXY(i);
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(PLATE, PLATE, 1.2), [0, 1, 2, 3, 4, 5].map((k) => k === 4 ? new THREE.MeshStandardMaterial({ map: plateTex(`Plate ${i + 1}`), roughness: 0.88, metalness: 0.05, envMapIntensity: 0.35 }) : new THREE.MeshStandardMaterial({ color: 0x2e3035, roughness: 0.6, metalness: 0.4 })));
      sheet.position.set(cx, cy, -0.62); sheet.receiveShadow = true; plates.add(sheet);
      const bed = new THREE.Mesh(new THREE.BoxGeometry(PLATE + 10, PLATE + 10, 5), new THREE.MeshStandardMaterial({ color: 0xaeb3bb, roughness: 0.42, metalness: 0.65, envMapIntensity: 0.8 })); bed.position.set(cx, cy, -3.75); bed.castShadow = bed.receiveShadow = true; plates.add(bed); }
    const bar = $("#pmPlates"); bar.hidden = n < 2; bar.innerHTML = n < 2 ? "" : Array.from({ length: n }, (_, i) => `<span>Plate ${i + 1}: ${esc(S.plateNames?.[i] || "")}</span>`).join("");
  }
  const mat = (hex) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex || "#cccccc").convertSRGBToLinear(), roughness: 0.6, metalness: 0, envMapIntensity: 0.6, clearcoat: 0.03, clearcoatRoughness: 0.8 });
  let dirty = true; const req = () => { dirty = true; };
  orbit.addEventListener("change", req);
  new ResizeObserver(() => { const b = gl.getBoundingClientRect(); if (!b.width) return; R.setSize(b.width, b.height, false); cam.aspect = b.width / b.height; cam.updateProjectionMatrix(); req(); }).observe(gl);
  (function loop() { requestAnimationFrame(loop); orbit.update(); if (dirty) { dirty = false; const t = orbit.target; key.position.set(t.x - 260, t.y - 340, 560); key.target.position.copy(t); fill.position.set(t.x + 380, t.y + 200, 260); R.render(scene, cam); } })();
  function frame(view) { if (!S.result) return; const all = S.result.objects.map((o) => o.box); const mn = [0, 1, 2].map((k) => Math.min(...all.map((b) => b.mn[k]))), mx = [0, 1, 2].map((k) => Math.max(...all.map((b) => b.mx[k])));
    const c = new THREE.Vector3((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mx[2]) / 2); const size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 40);
    const d = size / (2 * Math.tan(cam.fov * Math.PI / 360)) * 1.35; orbit.target.copy(c);
    cam.position.copy(view === "top" ? new THREE.Vector3(c.x, c.y - 0.01, c.z + d) : view === "front" ? new THREE.Vector3(c.x, c.y - d, c.z + d * 0.12) : new THREE.Vector3(c.x + d * 0.45, c.y - d * 0.75, c.z + d * 0.6)); orbit.update(); req(); }
  root.querySelectorAll("[data-cam]").forEach((b) => (b.onclick = () => frame(b.dataset.cam)));

  /* build */
  let timer = 0; const schedule = () => { clearTimeout(timer); timer = setTimeout(build, 220); };
  async function build() {
    const my = ++S.gen; $("#pmBusy").hidden = false;
    try {
      const r = gen.csg ? await csgBuild(gen.id, S.p) : await gen.build(S.p, { images: S.images, loadManifold });
      if (my !== S.gen) return;
      // place each object on its plate: centred, resting on the bed
      const byPlate = new Map(); for (const o of r.objects) { const p = o.plate || 1; if (!byPlate.has(p)) byPlate.set(p, []); byPlate.get(p).push(o); }
      const nPlates = Math.max(1, ...byPlate.keys()); S.plateNames = r.plateNames || [];
      for (const [p, list] of byPlate) { const bb = list.map((o) => bounds(o.mesh)); const mn = [0, 1].map((k) => Math.min(...bb.map((b) => b.mn[k]))), mx = [0, 1].map((k) => Math.max(...bb.map((b) => b.mx[k]))); const z0 = Math.min(...bb.map((b) => b.mn[2]));
        const [px, py] = plateXY(p - 1); list.forEach((o) => { o.placed = translate(o.mesh, -(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -z0); o.view = translate(o.placed, px, py, 0); o.box = bounds(o.view); }); }
      while (parts.children.length) { const o = parts.children.pop(); o.geometry.dispose(); o.material.dispose(); }
      for (const o of r.objects) { const g = creased(o.view);
        const m = new THREE.Mesh(g, mat(o.color)); m.castShadow = m.receiveShadow = true; parts.add(m); }
      drawPlates(nPlates);
      // print check: closed solids, fits the bed, plus the maker's own checks
      const checks = []; const open = r.objects.filter((o) => !isClosed(o.placed));
      checks.push(open.length ? ["bad", `${open.length} part${open.length > 1 ? "s are" : " is"} not a closed solid.`] : ["ok", "Every part is a closed solid: it slices cleanly."]);
      const tooBig = r.objects.some((o) => { const s = bounds(o.placed).size; return s[0] > PLATE || s[1] > PLATE || s[2] > PLATE; });
      checks.push(tooBig ? ["bad", "Too big for a 256 × 256 × 256 mm printer. Make it smaller."] : ["ok", "Fits a 256 mm printer (X1, P1, A1)."]);
      checks.push(...(r.checks || []));
      const first = S.result == null; S.result = r; S.checks = checks;
      const all = bounds(joinMeshes(r.objects.filter((o) => (o.plate || 1) === 1).map((o) => o.placed)));
      $("#pmSize").innerHTML = `<dt>Size</dt><dd>${round(all.size[0])} × ${round(all.size[1])} × ${round(all.size[2])} mm</dd><dt>Parts</dt><dd>${r.objects.length}</dd><dt>Plates</dt><dd>${nPlates}</dd>` + (r.weight ? `<dt>Filament</dt><dd>about ${Math.round(r.weight)} g</dd>` : "");
      $("#pmChecks").innerHTML = checks.map(([k, t]) => `<li class="${k}">${ICON[k]}<span>${esc(t)}</span></li>`).join("");
      $("#pmNote").textContent = (r.notes || []).join(" ");
      if (first) frame("iso"); else req();
    } catch (e) { console.error(e); $("#pmChecks").innerHTML = `<li class="bad">${ICON.bad}<span>${esc("That combination couldn't be built: " + (e.message || e))}</span></li>`; }
    if (my === S.gen) $("#pmBusy").hidden = true;
  }
  const slug = () => (S.name || gen.fileName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || gen.fileName;
  async function files() { if (!S.result) await build(); if (!S.result) throw new Error("The design couldn't be built. Check the settings and try again."); const objs = S.result.objects; return { m3f: await threeMF(objs, S.name), stl: stl(joinMeshes(objs.filter((o) => (o.plate || 1) === 1).map((o) => o.placed)), S.name) }; }
  async function download(kind) {
    const f = await files(); const zip = new window.JSZip();
    if (kind === "3mf") zip.file(slug() + ".3mf", f.m3f); else zip.file(slug() + ".stl", f.stl);
    zip.file("HOW TO PRINT.txt", (gen.howTo || "Open the file in Bambu Studio, PrusaSlicer or Cura and slice.") + "\r\nMade on epix3d.com.\r\n");
    const blob = await zip.generateAsync({ type: "blob" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${slug()}-${kind}.zip`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  $("#pmExport").onclick = () => download("3mf"); $("#pmStl").onclick = () => download("stl");
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { root.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); root.dataset.tab = b.dataset.tab; }));
  root.dataset.tab = "pmPanel";

  renderFields(); build();

  window.PARAM = {
    name: () => S.name,
    hasContent: () => !!S.result && (!gen.needsContent || gen.needsContent(S.p, S.images)),
    getState: () => ({ v: 1, gen: gen.id, name: S.name, p: S.p }),
    async setState(d) { if (!d || d.gen !== gen.id) throw new Error("That design is from another maker."); S.p = { ...structuredClone(gen.defaults), ...d.p }; S.name = d.name || S.name; $("#pmName").value = S.name;
      for (const s of gen.sections) for (const f of s.fields) if (f.type === "image" && S.p[f.key]) S.images[f.key] = { url: S.p[f.key], img: await loadImg(S.p[f.key]) };
      renderFields(); S.result = null; await build(); },
    async thumb() { if (!S.result) await build(); frame("iso"); R.render(scene, cam); const c = document.createElement("canvas"); const w = 480, h = Math.round(480 * R.domElement.height / R.domElement.width) || 360; c.width = w; c.height = h; const x = c.getContext("2d"); x.fillStyle = "#e4e6ea"; x.fillRect(0, 0, w, h); x.drawImage(R.domElement, 0, 0, w, h); return c.toDataURL("image/jpeg", 0.8); },
    async buildPrintFile() { const f = await files(); return { blob: f.m3f, name: slug() + ".3mf", details: S.result.objects.map((o) => o.name).join(", ") }; },
  };
  window.PARAM_READY && window.PARAM_READY();
}
