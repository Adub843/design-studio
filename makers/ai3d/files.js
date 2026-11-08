// Reading the generator's GLB and writing print files (STL and a 3MF that Bambu Studio opens in millimetres).
// No dependencies; works in the browser and in Node 18+.

// ---------- GLB (binary glTF 2.0): every triangle mesh in the scene, with node transforms ----------
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function readAccessor(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const Type = TYPES[acc.componentType];
  const n = COMPONENTS[acc.type], size = Type.BYTES_PER_ELEMENT;
  const offset = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride && view.byteStride !== n * size ? view.byteStride : 0;
  const out = new (Type === Float32Array ? Float32Array : Uint32Array)(acc.count * n);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = { 5120: "getInt8", 5121: "getUint8", 5122: "getInt16", 5123: "getUint16", 5125: "getUint32", 5126: "getFloat32" }[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    const base = offset + i * (stride || n * size);
    for (let k = 0; k < n; k++) out[i * n + k] = dv[get](base + k * size, true);
  }
  return out;
}

const mul4 = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0], [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1];
}

/** @param {ArrayBuffer|Uint8Array} data  a .glb file */
export function readGlb(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file.");
  let off = 12, gltf = null, bin = null;
  while (off < u8.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = u8.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!gltf || !bin) throw new Error("The GLB file is missing its data.");
  if ((gltf.extensionsRequired ?? []).some((e) => /draco|meshopt/i.test(e))) throw new Error("Compressed GLB files aren't supported yet.");
  const positions = [], indices = [];
  const visit = (ni, parent) => {
    const node = gltf.nodes[ni];
    const m = mul4(parent, nodeMatrix(node));
    if (node.mesh !== undefined) for (const prim of gltf.meshes[node.mesh].primitives) {
      if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
      const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
      const base = positions.length / 3;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        positions.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      const ind = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      for (let i = 0; i < ind.length; i++) indices.push(ind[i] + base);
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  for (const ni of scene?.nodes ?? gltf.nodes.map((_, i) => i)) visit(ni, I);
  if (!indices.length) throw new Error("The GLB file has no triangles.");
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

// ---------- STL (binary) ----------
export function writeStl(mesh, name = "EPIX3D model") {
  const p = mesh.positions, t = mesh.indices, n = t.length / 3;
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode(name.slice(0, 79)));
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
    o += 2;
  }
  return new Uint8Array(buf);
}

// ---------- zip (deflate when the platform has it, stored otherwise) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function deflateRaw(u8) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function zip(files) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  const le16 = (v) => [v & 255, (v >> 8) & 255], le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(raw), packed = await deflateRaw(raw);
    const method = packed && packed.length < raw.length ? 8 : 0, body = method ? packed : raw;
    const hdr = new Uint8Array([0x50, 0x4b, 3, 4, ...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(body.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...name]);
    parts.push(hdr, body);
    cd.push(new Uint8Array([0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0x21), ...le32(crc), ...le32(body.length), ...le32(raw.length), ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(off), ...name]));
    off += hdr.length + body.length;
  }
  const cdLen = cd.reduce((s, a) => s + a.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length), ...le32(cdLen), ...le32(off), ...le16(0)]);
  const all = new Uint8Array(off + cdLen + end.length);
  let p = 0; for (const a of [...parts, ...cd, end]) { all.set(a, p); p += a.length; }
  return all;
}

// ---------- 3MF (core spec, millimetres, one object on the plate) ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
export async function write3mf(mesh, title = "EPIX3D model") {
  const p = mesh.positions, t = mesh.indices;
  const v = new Array(p.length / 3), tr = new Array(t.length / 3);
  for (let i = 0; i < p.length; i += 3) v[i / 3] = `<vertex x="${p[i].toFixed(3)}" y="${p[i + 1].toFixed(3)}" z="${p[i + 2].toFixed(3)}"/>`;
  for (let i = 0; i < t.length; i += 3) tr[i / 3] = `<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>`;
  // Bambu Studio's plate is 256 x 256 mm with its origin in a corner: place the part in the middle.
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${esc(title)}</metadata><metadata name="Application">EPIX3D</metadata><resources><object id="1" name="${esc(title)}" type="model"><mesh><vertices>${v.join("")}</vertices><triangles>${tr.join("")}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build></model>`;
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: "3D/3dmodel.model", data: model },
  ]);
}
