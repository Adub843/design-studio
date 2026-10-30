// License Plate Maker geometry: the product shapes in millimetres, raster masks traced into clean
// outlines, outlines extruded into closed meshes, and the .stl / Bambu .3mf / .zip writers.
// Everything runs in the browser; nothing is uploaded.
(function () {
  "use strict";
  const IN = 25.4;
  // A standard US plate is 12 x 6 in, with mounting holes 7 in apart across and 4.75 in apart up and down.
  const US = { w: 12 * IN, h: 6 * IN, holeX: 3.5 * IN, holeY: 2.375 * IN };

  const FRAME = {
    w: US.w + 8, h: US.h + 8, r: 6,
    side: 9, bar: 27, winR: 3, holeD: 7,
    thick: 3.0, rim: 2.4, rimH: 1.0,
  };
  FRAME.winX = FRAME.w / 2 - FRAME.side;   // 147.4
  FRAME.winY = FRAME.h / 2 - FRAME.bar;    // 53.2
  FRAME.zones = {
    top: { cy: (FRAME.winY + FRAME.h / 2) / 2, maxW: 152, maxCap: 14 },
    bottom: { cy: -(FRAME.winY + FRAME.h / 2) / 2, maxW: 152, maxCap: 14 },
  };

  const PLATE = {
    w: US.w, h: US.h, r: 6,
    thick: 2.6, rimIn: 3, rim: 2.2, rimH: 1.0,
    slotW: 6.4, slotL: 10,
  };
  PLATE.zones = {
    top: { cy: 59, maxW: 156, maxCap: 12 },
    main: { cy: -1, maxW: 274, maxCap: 70 },
    bottom: { cy: -59, maxW: 156, maxCap: 12 },
  };

  // Two-piece split for 256 mm beds: a straight cut 80 mm left of centre with dovetails on the right piece.
  const CUT = { x: -80, clear: 0.25 };
  CUT.tails = {
    frame: [{ y: 72, neck: 3, head: 4.5, depth: 6 }, { y: -72, neck: 3, head: 4.5, depth: 6 }],
    plate: [{ y: 30, neck: 4, head: 6, depth: 8 }, { y: -30, neck: 4, head: 6, depth: 8 }],
  };

  const BEDS = {
    two: { w: 256, h: 256, pieces: 2, label: "256 mm bed (X1, P1, A1)" },
    one: { w: 350, h: 320, pieces: 1, label: "350 mm bed (H2D)" },
  };

  function roundRect(p, x0, y0, x1, y1, r) {
    r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
    p.moveTo(x0 + r, y0);
    p.lineTo(x1 - r, y0); p.arcTo(x1, y0, x1, y0 + r, r);
    p.lineTo(x1, y1 - r); p.arcTo(x1, y1, x1 - r, y1, r);
    p.lineTo(x0 + r, y1); p.arcTo(x0, y1, x0, y1 - r, r);
    p.lineTo(x0, y0 + r); p.arcTo(x0, y0, x0 + r, y0, r);
    p.closePath();
  }
  const circle = (p, x, y, r) => { p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2); p.closePath(); };
  const slot = (p, x, y, len, w) => roundRect(p, x - len / 2, y - w / 2, x + len / 2, y + w / 2, w / 2);
  const holes = () => [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => [sx * US.holeX, sy * US.holeY]);

  // Shapes as Path2D in mm with y up. All of them fill with "evenodd".
  const shapes = {
    frameBody() {
      const p = new Path2D(), F = FRAME;
      roundRect(p, -F.w / 2, -F.h / 2, F.w / 2, F.h / 2, F.r);
      roundRect(p, -F.winX, -F.winY, F.winX, F.winY, F.winR);
      for (const [x, y] of holes()) circle(p, x, y, F.holeD / 2);
      return p;
    },
    frameRim() {
      const p = new Path2D(), F = FRAME, k = F.rim;
      roundRect(p, -F.w / 2, -F.h / 2, F.w / 2, F.h / 2, F.r);
      roundRect(p, -F.w / 2 + k, -F.h / 2 + k, F.w / 2 - k, F.h / 2 - k, F.r - k);
      roundRect(p, -F.winX - k, -F.winY - k, F.winX + k, F.winY + k, F.winR + k);
      roundRect(p, -F.winX, -F.winY, F.winX, F.winY, F.winR);
      return p;
    },
    plateBody() {
      const p = new Path2D(), P = PLATE;
      roundRect(p, -P.w / 2, -P.h / 2, P.w / 2, P.h / 2, P.r);
      for (const [x, y] of holes()) slot(p, x, y, P.slotL, P.slotW);
      return p;
    },
    plateRim() {
      const p = new Path2D(), P = PLATE, a = P.rimIn, b = P.rimIn + P.rim;
      roundRect(p, -P.w / 2 + a, -P.h / 2 + a, P.w / 2 - a, P.h / 2 - a, P.r - a + 1);
      roundRect(p, -P.w / 2 + b, -P.h / 2 + b, P.w / 2 - b, P.h / 2 - b, Math.max(1, P.r - b + 1));
      return p;
    },
    // The left piece's region: everything left of the cut line (dovetail sockets included).
    leftRegion(kind, bounds) {
      const pts = cutLine(kind, bounds), p = new Path2D();
      p.moveTo(bounds.x0 - 5, bounds.y1 + 5);
      for (const [x, y] of pts) p.lineTo(x, y);
      p.lineTo(bounds.x0 - 5, bounds.y0 - 5);
      p.closePath();
      return p;
    },
  };

  // The cut from top to bottom; each dovetail juts left from the cut, wider at its tip.
  function cutLine(kind, bounds) {
    const x = CUT.x, pts = [[x, bounds.y1 + 5]];
    const tails = [...CUT.tails[kind]].sort((a, b) => b.y - a.y);
    for (const t of tails) {
      pts.push([x, t.y + t.neck], [x - t.depth, t.y + t.head], [x - t.depth, t.y - t.head], [x, t.y - t.neck]);
    }
    pts.push([x, bounds.y0 - 5]);
    return pts;
  }

  /* ---------- Raster masks traced into outlines (marching squares) ---------- */

  // alpha: Uint8 array W x H. Returns closed loops in grid coordinates (pixel centres at i + 0.5).
  function traceLoops(alpha, W, H, t = 128) {
    const PW = W + 2, PH = H + 2, a = new Uint8Array(PW * PH);
    for (let y = 0; y < H; y++) a.set(alpha.subarray(y * W, y * W + W), (y + 1) * PW + 1);
    const pos = new Map(), adj = new Map();
    const segs = [];
    const hKey = (i, j) => (j * PW + i) * 2, vKey = (i, j) => (j * PW + i) * 2 + 1;
    const point = (k) => {
      if (pos.has(k)) return;
      const cell = k >> 1, i = cell % PW, j = (cell - i) / PW;
      if (k & 1) { const v0 = a[j * PW + i], v1 = a[(j + 1) * PW + i]; pos.set(k, [i, j + (t - v0) / (v1 - v0)]); }
      else { const v0 = a[j * PW + i], v1 = a[j * PW + i + 1]; pos.set(k, [i + (t - v0) / (v1 - v0), j]); }
    };
    const add = (k1, k2) => {
      const s = segs.length; segs.push(k1, k2);
      point(k1); point(k2);
      const l1 = adj.get(k1); if (l1) l1.push(s >> 1); else adj.set(k1, [s >> 1]);
      const l2 = adj.get(k2); if (l2) l2.push(s >> 1); else adj.set(k2, [s >> 1]);
    };
    for (let j = 0; j < PH - 1; j++) {
      for (let i = 0; i < PW - 1; i++) {
        const tl = a[j * PW + i], tr = a[j * PW + i + 1], bl = a[(j + 1) * PW + i], br = a[(j + 1) * PW + i + 1];
        const c = (tl >= t ? 8 : 0) | (tr >= t ? 4 : 0) | (br >= t ? 2 : 0) | (bl >= t ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const T = hKey(i, j), B = hKey(i, j + 1), L = vKey(i, j), R = vKey(i + 1, j);
        switch (c) {
          case 1: case 14: add(L, B); break;
          case 2: case 13: add(B, R); break;
          case 3: case 12: add(L, R); break;
          case 4: case 11: add(T, R); break;
          case 6: case 9: add(T, B); break;
          case 7: case 8: add(L, T); break;
          case 5: if ((tl + tr + bl + br) / 4 >= t) { add(L, T); add(B, R); } else { add(T, R); add(L, B); } break;
          case 10: if ((tl + tr + bl + br) / 4 >= t) { add(T, R); add(L, B); } else { add(L, T); add(B, R); } break;
        }
      }
    }
    const used = new Uint8Array(segs.length / 2), loops = [];
    for (let s0 = 0; s0 < used.length; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      const start = segs[s0 * 2];
      let key = segs[s0 * 2 + 1];
      const loop = [pos.get(start)];
      for (let guard = 0; key !== start && guard < 1e7; guard++) {
        loop.push(pos.get(key));
        const list = adj.get(key);
        let next = -1;
        for (const s of list) if (!used[s]) { next = s; break; }
        if (next < 0) break;
        used[next] = 1;
        key = segs[next * 2] === key ? segs[next * 2 + 1] : segs[next * 2];
      }
      if (loop.length >= 3) loops.push(loop.map(([x, y]) => [x - 1, y - 1]));
    }
    return loops;
  }

  // Douglas-Peucker on a closed loop.
  function simplify(loop, tol) {
    const n = loop.length;
    if (n < 8) return loop;
    let far = 0, best = -1;
    for (let i = 1; i < n; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > best) { best = d; far = i; } }
    const keep = new Uint8Array(n); keep[0] = keep[far] = 1;
    const stack = [[0, far], [far, n]];
    const t2 = tol * tol;
    while (stack.length) {
      const [s, e] = stack.pop();
      const A = loop[s], B = loop[e % n];
      const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1e-12;
      let idx = -1, md = t2;
      for (let i = s + 1; i < e; i++) {
        const P = loop[i];
        const c = ((P[0] - A[0]) * dy - (P[1] - A[1]) * dx);
        const d = c * c / L2;
        if (d > md) { md = d; idx = i; }
      }
      if (idx >= 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(loop[i]);
    return out;
  }

  const area = (l) => { let s = 0; for (let i = 0, j = l.length - 1; i < l.length; j = i++) s += (l[j][0] * l[i][1] - l[i][0] * l[j][1]); return s / 2; };
  function inside(pt, l) {
    let c = false;
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const [xi, yi] = l[i], [xj, yj] = l[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  // Loops (mm, y up) -> polygons [{outer, holes:[...]}] with outer counter-clockwise and holes clockwise.
  function polygons(loops) {
    const depth = loops.map((l, i) => { let d = 0; for (let k = 0; k < loops.length; k++) if (k !== i && inside(l[0], loops[k])) d++; return d; });
    const polys = [];
    const outerIdx = new Map();
    loops.forEach((l, i) => {
      if (depth[i] % 2 === 0) {
        if (area(l) < 0) l.reverse();
        outerIdx.set(i, polys.length);
        polys.push({ outer: l, holes: [] });
      }
    });
    loops.forEach((l, i) => {
      if (depth[i] % 2 === 0) return;
      if (area(l) > 0) l.reverse();
      let owner = -1;
      for (let k = 0; k < loops.length; k++) if (depth[k] === depth[i] - 1 && inside(l[0], loops[k])) { owner = k; break; }
      if (owner >= 0) polys[outerIdx.get(owner)].holes.push(l);
    });
    return polys;
  }

  // Mask -> polygons in mm. g = { x0, y1, res } maps grid to mm (y up).
  function maskToPolys(alpha, W, H, g) {
    const tol = 0.35; // grid px; 0.035 mm at 10 px/mm
    const minArea = 0.05 * g.res * g.res; // 0.05 mm^2
    const loops = traceLoops(alpha, W, H)
      .map((l) => simplify(l, tol))
      .filter((l) => l.length >= 3 && Math.abs(area(l)) > minArea)
      .map((l) => l.map(([x, y]) => [g.x0 + (x + 0.5) / g.res, g.y1 - (y + 0.5) / g.res]));
    return polygons(loops);
  }

  /* ---------- Extrusion ---------- */

  function extrude(polys, z0, z1) {
    const v = [], f = [];
    for (const poly of polys) {
      const rings = [poly.outer, ...poly.holes];
      const flat = [], holeIdx = [];
      let n = 0;
      for (let r = 0; r < rings.length; r++) {
        if (r > 0) holeIdx.push(n);
        for (const [x, y] of rings[r]) { flat.push(x, y); n++; }
      }
      const base = v.length / 3;
      for (let i = 0; i < n; i++) v.push(flat[i * 2], flat[i * 2 + 1], z0);
      for (let i = 0; i < n; i++) v.push(flat[i * 2], flat[i * 2 + 1], z1);
      const tris = window.earcut(flat, holeIdx.length ? holeIdx : null, 2);
      for (let k = 0; k < tris.length; k += 3) {
        let a = tris[k], b = tris[k + 1], c = tris[k + 2];
        const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
        if (cr < 0) { const t = b; b = c; c = t; }
        f.push(base + n + a, base + n + b, base + n + c); // top, facing up
        f.push(base + a, base + c, base + b);             // bottom, facing down
      }
      let off = 0;
      for (const ring of rings) {
        const m = ring.length;
        for (let i = 0; i < m; i++) {
          const a = off + i, b = off + (i + 1) % m;
          f.push(base + a, base + b, base + n + b);
          f.push(base + a, base + n + b, base + n + a);
        }
        off += m;
      }
    }
    return { v, f };
  }

  // Every edge of a closed mesh is shared by exactly two faces, once in each direction.
  function isClosed(mesh) {
    const e = new Map();
    const f = mesh.f;
    for (let i = 0; i < f.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = f[i + k], b = f[i + (k + 1) % 3];
        const key = a * 4194304 + b;
        e.set(key, (e.get(key) || 0) + 1);
      }
    }
    for (const [key, n] of e) {
      if (n !== 1) return false;
      const a = Math.floor(key / 4194304), b = key % 4194304;
      if (e.get(b * 4194304 + a) !== 1) return false;
    }
    return true;
  }

  function volume(mesh) {
    const v = mesh.v, f = mesh.f; let s = 0;
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
      s += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    return s / 6;
  }

  function translate(mesh, dx, dy) {
    const v = mesh.v.slice();
    for (let i = 0; i < v.length; i += 3) { v[i] += dx; v[i + 1] += dy; }
    return { v, f: mesh.f };
  }

  // For a one-shell STL the raised parts dip 0.02 mm into the body, so no faces touch edge to edge.
  function sink(mesh, dz) {
    const v = mesh.v.slice();
    for (let i = 2; i < v.length; i += 3) v[i] -= dz;
    return { v, f: mesh.f };
  }

  /* ---------- File writers ---------- */

  function toSTL(meshes, name) {
    const tri = meshes.reduce((s, m) => s + m.f.length / 3, 0);
    const buf = new ArrayBuffer(84 + tri * 50), dv = new DataView(buf);
    const head = `${name || "plate"} - EPIX3D License Plate Maker`.slice(0, 79);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 127);
    dv.setUint32(80, tri, true);
    let o = 84;
    for (const m of meshes) {
      const v = m.v, f = m.f;
      for (let i = 0; i < f.length; i += 3) {
        const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
        const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
        dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
        for (const p of [a, b, c]) { dv.setFloat32(o, v[p], true); dv.setFloat32(o + 4, v[p + 1], true); dv.setFloat32(o + 8, v[p + 2], true); o += 12; }
        o += 2;
      }
    }
    return new Uint8Array(buf);
  }

  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
  const num = (x) => (Math.round(x * 10000) / 10000).toString();

  function meshXML(id, name, m) {
    const v = m.v, f = m.f, parts = [];
    parts.push(`<object id="${id}" name="${esc(name)}" type="model"><mesh><vertices>`);
    for (let i = 0; i < v.length; i += 3) parts.push(`<vertex x="${num(v[i])}" y="${num(v[i + 1])}" z="${num(v[i + 2])}"/>`);
    parts.push(`</vertices><triangles>`);
    for (let i = 0; i < f.length; i += 3) parts.push(`<triangle v1="${f[i]}" v2="${f[i + 1]}" v3="${f[i + 2]}"/>`);
    parts.push(`</triangles></mesh></object>`);
    return parts.join("");
  }

  // One object made of parts, each part on its own filament (1 = body colour, 2 = text colour).
  function to3MF(parts, title, colors) {
    const ids = parts.map((_, i) => i + 1), top = parts.length + 1;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">BambuStudio-02.07.01.57</metadata>
<metadata name="BambuStudio:3mfVersion">1</metadata>
<metadata name="Designer">EPIX3D License Plate Maker</metadata>
<resources>
${parts.map((p, i) => meshXML(ids[i], p.name, p.mesh)).join("\n")}
<object id="${top}" name="${esc(title)}" type="model"><components>${ids.map((id) => `<component objectid="${id}"/>`).join("")}</components></object>
</resources>
<build><item objectid="${top}" printable="1"/></build>
</model>`;
    const cfg = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${top}">
    <metadata key="name" value="${esc(title)}"/>
    <metadata key="extruder" value="1"/>
${parts.map((p, i) => `    <part id="${ids[i]}" subtype="normal_part">
      <metadata key="name" value="${esc(p.name)}"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="${p.filament}"/>
    </part>`).join("\n")}
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${top}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="100"/>
    </model_instance>
  </plate>
  <assemble>
  </assemble>
</config>`;
    const enc = new TextEncoder();
    const files = [
      { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>`) },
      { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`) },
      { name: "3D/3dmodel.model", data: enc.encode(xml) },
      { name: "Metadata/model_settings.config", data: enc.encode(cfg) },
    ];
    if (colors) files.push({ name: "Metadata/filaments.txt", data: enc.encode(colors.map((c, i) => `Filament ${i + 1}: ${c.name} (${c.hex})`).join("\n") + "\n") });
    return zip(files);
  }

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  // Stored (uncompressed) zip: 3MF readers and every OS unzip accept it.
  function zip(files) {
    const enc = new TextEncoder(), chunks = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      chunks.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + size;
    }
    const cdSize = central.reduce((s, u) => s + u.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob([...chunks, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
  }

  /* ---------- Print checks on a text mask ---------- */

  // Finds letters or parts of letters thinner than minStroke mm, and specks smaller than minArea mm^2.
  function strokeCheck(alpha, W, H, res, minStroke = 0.9, minArea = 0.8) {
    const N = W * H, INF = 1e9;
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) d[i] = alpha[i] >= 128 ? INF : 0;
    // two-pass chamfer distance (3-4), in px
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!d[i]) continue;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + 1);
      if (y > 0) { m = Math.min(m, d[i - W] + 1); if (x > 0) m = Math.min(m, d[i - W - 1] + 1.4142); if (x < W - 1) m = Math.min(m, d[i - W + 1] + 1.4142); }
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) m = Math.min(m, 1);
      d[i] = m;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; if (!d[i]) continue;
      let m = d[i];
      if (x < W - 1) m = Math.min(m, d[i + 1] + 1);
      if (y < H - 1) { m = Math.min(m, d[i + W] + 1); if (x < W - 1) m = Math.min(m, d[i + W + 1] + 1.4142); if (x > 0) m = Math.min(m, d[i + W - 1] + 1.4142); }
      d[i] = m;
    }
    const lab = new Int32Array(N), stack = [];
    let thin = 0, specks = 0, parts = 0;
    const need = (minStroke / 2) * res, minPx = minArea * res * res;
    for (let s = 0; s < N; s++) {
      if (!d[s] || lab[s]) continue;
      parts++;
      let n = 0, peak = 0;
      lab[s] = parts; stack.push(s);
      while (stack.length) {
        const i = stack.pop(); n++; if (d[i] > peak) peak = d[i];
        const x = i % W;
        if (x > 0 && d[i - 1] && !lab[i - 1]) { lab[i - 1] = parts; stack.push(i - 1); }
        if (x < W - 1 && d[i + 1] && !lab[i + 1]) { lab[i + 1] = parts; stack.push(i + 1); }
        if (i >= W && d[i - W] && !lab[i - W]) { lab[i - W] = parts; stack.push(i - W); }
        if (i + W < N && d[i + W] && !lab[i + W]) { lab[i + W] = parts; stack.push(i + W); }
      }
      if (n < minPx) specks++;
      else if (peak < need) thin++;
    }
    return { parts, thin, specks };
  }

  window.LPM_GEOM = { IN, US, FRAME, PLATE, CUT, BEDS, shapes, cutLine, traceLoops, simplify, polygons, maskToPolys, extrude, isClosed, volume, translate, sink, toSTL, to3MF, zip, strokeCheck };
})();
