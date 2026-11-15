// The print price for a design ordered from any EPIX3D maker. The same file runs in the browser (the live
// price in each maker, served as /assets/print-price.mjs) and in the Worker (the price is worked out again
// from the uploaded print file, so a changed page can't lower it).
//
// The model is Aaron's own 3D Print Calculator (Charleston3D, "3D Print Calculator" on his Desktop, matching
// the 3D Print Calculator tab of the Master Document), with its default settings:
//   cost per piece   = filament + power + printer wear + failed-print allowance + hardware + packaging
//   price            = cost x (1 + markup) + labour + print-time charge, at least the minimum order price,
//                      the order total rounded up to the whole dollar. Shipping and tax are added at checkout.
// Filament grams and print hours come from the 3MF itself (mesh volume and surface, the calculator's own
// estimate for an unsliced model). Each extra colour adds a purge allowance to the filament.
// Change a rate here and every maker, and the server check, follow it.

export const RATES = {
  kgPrice: 22.99,      // PLA, $ per kg
  density: 1.24,       // PLA, g per cm3
  infill: 15,          // %
  gramsPerHour: 22,    // Bambu Lab P1S, for the time estimate
  watts: 110, kwh: 0.16,
  printerCost: 549, life: 6000, upkeep: 0.04,   // $ per hour of printer wear and upkeep
  fail: 10,            // % extra filament for supports, purge and reprints
  colourPurge: 8,      // % extra filament for each colour after the first (AMS purge)
  hardware: 0,         // $ per piece
  pack: 1,             // $ per order
  rate: 20, design: 0, post: 0,                 // labour: $ per hour, minutes per job, minutes per piece
  markup: 100,         // % on cost
  timeRate: 3,         // $ per print hour
  minJob: 18,          // $ minimum order price
};

// Turns grams and hours into the calculator's price (the "Order total up to whole dollar" rounding).
export function priceFor({ grams, hours, colours = 1, qty = 1 }, R = RATES) {
  qty = Math.max(1, Math.round(qty || 1));
  const g = Math.max(0, grams) * (1 + Math.max(0, colours - 1) * R.colourPurge / 100);
  const h = Math.max(0, hours);
  const material = g / 1000 * R.kgPrice;
  const power = R.watts / 1000 * h * R.kwh;
  const machine = (R.printerCost / Math.max(1, R.life) + R.upkeep) * h;
  const buffer = material * R.fail / 100;
  const postLabor = R.post / 60 * R.rate;
  const extras = R.hardware + R.pack / qty;
  const designJob = R.design / 60 * R.rate;
  const timeCharge = h * qty * R.timeRate;
  const marked = (material + power + machine + buffer + extras) * qty;
  let gross = marked * (1 + R.markup / 100) + postLabor * qty + designJob + timeCharge;
  gross = Math.max(Math.round(gross * 100) / 100, R.minJob);
  const total = Math.ceil(gross - 1e-9);
  return { total, each: total / qty, grams: Math.round(g * 10) / 10, hours: Math.round(h * 100) / 100, colours, qty };
}

// Filament and time for a measured mesh (mm3 and mm2), as the calculator estimates an unsliced model.
export function estimate({ volume, area }, R = RATES) {
  const vol = Math.abs(volume) / 1000; // cm3
  if (!(vol > 0)) return { grams: 0, hours: 0 };
  const shell = Math.min(1, area * 1.2 / Math.max(1, Math.abs(volume)));
  const fill = shell + (1 - shell) * Math.min(1, R.infill / 100);
  const grams = vol * R.density * fill * 1.03;
  return { grams, hours: grams / R.gramsPerHour };
}

/* ---------- reading a 3MF (a zip of XML meshes) ---------- */
// The Worker re-measures a file only while that fits its CPU budget (about 1 microsecond per triangle,
// so 400,000 characters of model XML or about 7,000 triangles). Bigger files keep the price the page
// worked out with this same code, and the order is marked for Aaron to look over (lib/orders.mjs).
export const MAX_MODEL_CHARS = 400_000;
export const MAX_STL_BYTES = 350_000;

async function unzipEntries(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("not a zip");
  let p = dv.getUint32(e + 16, true);
  const count = dv.getUint16(e + 10, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    out.push({ name: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), method, csize, usize, lo });
    p += 46 + nl + xl + cl;
  }
  return {
    names: out.map((x) => x.name),
    entry: (name) => out.find((x) => x.name === name),
    async text(en) {
      const start = en.lo + 30 + dv.getUint16(en.lo + 26, true) + dv.getUint16(en.lo + 28, true);
      const data = u8.subarray(start, start + en.csize);
      if (en.method === 0) return new TextDecoder().decode(data);
      if (en.method !== 8) throw new Error("unsupported zip");
      const ab = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      return new TextDecoder().decode(ab);
    },
  };
}

// A number attribute inside one tag (s[from..to]): ` x="1.5"`, also after a tab or line break.
function attr(s, from, to, key) {
  let i = -1;
  for (const sep of [" ", "\n", "\t", "\r"]) { const j = s.indexOf(sep + key + '="', from); if (j >= 0 && j < to) { i = j; break; } }
  if (i < 0) return NaN;
  i += key.length + 3;
  return +s.slice(i, s.indexOf('"', i));
}
// Adds every <mesh> in one model file to acc (plain string scanning: several times faster than regexes).
function scanMeshes(xml, acc) {
  let p = 0;
  for (;;) {
    const ms = xml.indexOf("<mesh", p); if (ms < 0) break;
    const me = xml.indexOf("</mesh>", ms); const end = me < 0 ? xml.length : me;
    const V = [];
    let q = ms;
    for (;;) {
      q = xml.indexOf("<vertex", q); if (q < 0 || q > end) break;
      const gt = xml.indexOf(">", q);
      const x = attr(xml, q, gt, "x"), y = attr(xml, q, gt, "y"), z = attr(xml, q, gt, "z");
      V.push(x, y, z);
      if (x < acc.min[0]) acc.min[0] = x; if (x > acc.max[0]) acc.max[0] = x;
      if (y < acc.min[1]) acc.min[1] = y; if (y > acc.max[1]) acc.max[1] = y;
      if (z < acc.min[2]) acc.min[2] = z; if (z > acc.max[2]) acc.max[2] = z;
      q = gt;
    }
    const nv = V.length / 3;
    q = ms;
    for (;;) {
      q = xml.indexOf("<triangle", q); if (q < 0 || q > end) break;
      const gt = xml.indexOf(">", q);
      const a = attr(xml, q, gt, "v1"), b = attr(xml, q, gt, "v2"), c = attr(xml, q, gt, "v3");
      q = gt;
      if (!(a >= 0 && b >= 0 && c >= 0 && a < nv && b < nv && c < nv)) continue;
      addTri(acc, V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2], V[c * 3], V[c * 3 + 1], V[c * 3 + 2]);
    }
    p = end + 1;
  }
}
function addTri(acc, ax, ay, az, bx, by, bz, cx, cy, cz) {
  acc.volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  acc.area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
  acc.tris++;
}
const newAcc = () => ({ volume: 0, area: 0, tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const sizeOf = (acc) => (acc.tris ? [0, 1, 2].map((i) => Math.round((acc.max[i] - acc.min[i]) * 10) / 10) : [0, 0, 0]);
const tooBig = () => { const err = new Error("too_big"); err.code = "too_big"; return err; };

// Volume and surface of every mesh in the 3MF model files, how many colours (materials or filament slots)
// it uses, and its size. Throws "too_big" when the models are larger than `max` characters.
export async function measure3MF(bytes, { max = Infinity } = {}) {
  const z = await unzipEntries(bytes);
  const models = z.names.filter((n) => /\.model$/i.test(n)).map(z.entry);
  if (models.reduce((n, m) => n + m.usize, 0) > max) throw tooBig();
  const acc = newAcc();
  const colours = new Set();
  for (const en of models) {
    const xml = await z.text(en);
    for (const m of xml.matchAll(/<base\b[^>]*displaycolor="([^"]+)"/gi)) colours.add(m[1].toLowerCase());
    scanMeshes(xml, acc);
  }
  // Bambu's project settings name the filaments used, when the maker wrote them.
  const settings = z.names.find((n) => /model_settings\.config$/i.test(n));
  if (settings && colours.size === 0) {
    const xml = await z.text(z.entry(settings));
    for (const m of xml.matchAll(/key="extruder"\s+value="(\d+)"/g)) colours.add(`slot:${m[1]}`);
  }
  return { volume: Math.abs(acc.volume), area: acc.area, tris: acc.tris, size: sizeOf(acc), colours: Math.max(1, Math.min(8, colours.size || 1)) };
}

// A binary or text STL (one colour).
export function measureSTL(bytes, { max = Infinity } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length > max) throw tooBig();
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const acc = newAcc();
  const tri = (a, b, c) => {
    addTri(acc, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (const v of [a, b, c]) for (let i = 0; i < 3; i++) { if (v[i] < acc.min[i]) acc.min[i] = v[i]; if (v[i] > acc.max[i]) acc.max[i] = v[i]; }
  };
  const n = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  if (n > 0 && u8.length === 84 + n * 50) {
    for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; const f = (k) => dv.getFloat32(o + k * 4, true); tri([f(0), f(1), f(2)], [f(3), f(4), f(5)], [f(6), f(7), f(8)]); }
  } else {
    const t = new TextDecoder().decode(u8); const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g; let m, v = [];
    while ((m = re.exec(t))) { v.push([+m[1], +m[2], +m[3]]); if (v.length === 3) { tri(...v); v = []; } }
  }
  return { volume: Math.abs(acc.volume), area: acc.area, tris: acc.tris, size: sizeOf(acc), colours: 1 };
}

// The whole thing for one print file (3MF or STL): measure, estimate, price.
export async function quoteFile(bytes, name, opts = {}) {
  const m = /\.stl$/i.test(name) ? measureSTL(bytes, { max: opts.maxStl ?? opts.max }) : await measure3MF(bytes, opts);
  const e = estimate(m, opts.rates);
  return { ...priceFor({ grams: e.grams, hours: e.hours, colours: m.colours, qty: opts.qty }, opts.rates), size: m.size, tris: m.tris };
}
export async function quote3MF(bytes, opts = {}) {
  const m = await measure3MF(bytes, opts);
  const e = estimate(m, opts.rates);
  return { ...priceFor({ grams: e.grams, hours: e.hours, colours: m.colours, qty: opts.qty }, opts.rates), size: m.size, tris: m.tris };
}
