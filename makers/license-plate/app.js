// License Plate Maker: the editor, the design preview and the downloads.
(function () {
  "use strict";
  const G = window.LPM_GEOM;
  const RES = 10; // raster resolution for the print files: 10 px per mm (0.1 mm)

  const FONTS = [
    { id: "oswald", label: "Oswald", css: '700 {s}px "Oswald"' },
    { id: "anton", label: "Anton", css: '400 {s}px "Anton"' },
    { id: "archivo", label: "Archivo Black", css: '400 {s}px "Archivo Black"' },
    { id: "montserrat", label: "Montserrat", css: '800 {s}px "Montserrat"' },
    { id: "slab", label: "Roboto Slab", css: '800 {s}px "Roboto Slab"' },
    { id: "bebas", label: "Bebas Neue", css: '400 {s}px "Bebas Neue"' },
  ];
  // Bambu Lab PLA Basic colours.
  const COLORS = [
    { id: "black", name: "Black", hex: "#1b1b1b" },
    { id: "white", name: "Jade White", hex: "#f4f4f1" },
    { id: "gray", name: "Gray", hex: "#8e9089" },
    { id: "silver", name: "Silver", hex: "#a6a9aa" },
    { id: "red", name: "Red", hex: "#c12e1f" },
    { id: "orange", name: "Orange", hex: "#ff6a13" },
    { id: "yellow", name: "Yellow", hex: "#f4d53f" },
    { id: "gold", name: "Gold", hex: "#e4bd68" },
    { id: "green", name: "Bambu Green", hex: "#00ae42" },
    { id: "blue", name: "Blue", hex: "#0a2989" },
    { id: "cyan", name: "Cyan", hex: "#0086d6" },
    { id: "purple", name: "Purple", hex: "#5e43b7" },
  ];
  const color = (id) => COLORS.find((c) => c.id === id) || COLORS[0];

  // Words we can't print: car brands, leagues and teams we don't own.
  const BLOCKED = ["ford", "chevy", "chevrolet", "gmc", "dodge", "ram trucks", "jeep", "chrysler", "cadillac", "buick", "tesla",
    "toyota", "lexus", "honda", "acura", "nissan", "infiniti", "mazda", "subaru", "mitsubishi", "hyundai", "kia", "bmw",
    "mercedes", "benz", "amg", "audi", "volkswagen", "vw", "porsche", "volvo", "land rover", "range rover", "fiat",
    "alfa romeo", "ferrari", "lamborghini", "maserati", "bentley", "rolls royce", "aston martin", "mclaren", "bugatti",
    "corvette", "camaro", "silverado", "f-150", "f150", "harley", "harley-davidson", "yamaha", "kawasaki", "ducati",
    "nfl", "nba", "mlb", "nhl", "ncaa", "nascar", "yankees", "red sox", "lakers", "steelers", "dallas cowboys"];
  const blockedIn = (s) => {
    const t = ` ${String(s).toLowerCase().replace(/[^a-z0-9-]+/g, " ")} `;
    return BLOCKED.filter((w) => t.includes(` ${w} `));
  };

  const DEFAULTS = {
    product: "frame",
    font: "oswald", upper: true,
    base: "black", accent: "white", edge: "raised", textH: 1.2,
    bed: "two", mounted: true, seam: true,
    frame: { top: { text: "", cap: 10, sp: 0.06 }, bottom: { text: "Charleston, SC", cap: 11, sp: 0.12 } },
    plate: { top: { text: "Charleston", cap: 10, sp: 0.2 }, main: { text: "HOLY CITY", cap: 48, sp: 0.04 }, bottom: { text: "South Carolina", cap: 9, sp: 0.2 } },
  };
  const KEY = "lpm:design:v1";
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { S = null; }
  S = merge(structuredClone(DEFAULTS), S || {});
  function merge(a, b) {
    for (const k of Object.keys(b || {})) {
      if (!(k in a)) continue;
      if (a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) merge(a[k], b[k]);
      else if (typeof a[k] === typeof b[k]) a[k] = b[k];
    }
    return a;
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* private mode: the design just isn't remembered */ } };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- Text layout (mm, y up) ---------- */

  const metricsCache = new Map();
  function fontCss(fontId, sizePx) { return (FONTS.find((f) => f.id === fontId) || FONTS[0]).css.replace("{s}", sizePx); }
  function capRatio(fontId) {
    if (metricsCache.has(fontId)) return metricsCache.get(fontId);
    const c = document.createElement("canvas").getContext("2d");
    c.font = fontCss(fontId, 100);
    const m = c.measureText("H");
    const r = (m.actualBoundingBoxAscent || 70) / 100;
    if (document.fonts.check(fontCss(fontId, 100))) metricsCache.set(fontId, r);
    return r;
  }
  const lines = () => (S.product === "frame" ? ["top", "bottom"] : ["top", "main", "bottom"]);
  const zones = () => (S.product === "frame" ? G.FRAME.zones : G.PLATE.zones);
  const shown = (t) => (S.upper ? t.toLocaleUpperCase() : t).trim();

  // Measures each line at 100 px and scales it to the cap height, shrinking it to fit its zone.
  function layout() {
    const c = document.createElement("canvas").getContext("2d");
    const out = [];
    for (const key of lines()) {
      const L = S[S.product][key], z = zones()[key], txt = shown(L.text);
      if (!txt) continue;
      const ratio = capRatio(S.font);
      c.font = fontCss(S.font, 100);
      const chars = [...txt];
      const widths = chars.map((ch) => c.measureText(ch).width);
      const full = L.sp ? widths.reduce((s, w) => s + w, 0) + L.sp * 100 * (chars.length - 1) : c.measureText(txt).width;
      const wantCap = Math.min(L.cap, z.maxCap);
      let size = wantCap / ratio; // font size in mm
      let width = full / 100 * size;
      let fitted = false;
      if (width > z.maxW) { size *= z.maxW / width; width = z.maxW; fitted = true; }
      out.push({ key, txt, chars, widths: widths.map((w) => w / 100 * size), size, cap: size * ratio, sp: L.sp * size, width, cy: z.cy, fitted, wanted: wantCap });
    }
    return out;
  }

  function drawText(ctx, lay) {
    for (const t of lay) {
      ctx.save();
      ctx.translate(-t.width / 2, t.cy - t.cap / 2);
      ctx.scale(1, -1);
      ctx.font = fontCss(S.font, t.size);
      ctx.textBaseline = "alphabetic";
      if (!t.sp) ctx.fillText(t.txt, 0, 0);
      else { let x = 0; t.chars.forEach((ch, i) => { ctx.fillText(ch, x, 0); x += t.widths[i] + t.sp; }); }
      ctx.restore();
    }
  }

  /* ---------- The model: parts as fills in mm ---------- */

  function model() {
    const frame = S.product === "frame";
    const T = frame ? G.FRAME.thick : G.PLATE.thick;
    const w = frame ? G.FRAME.w : G.PLATE.w, h = frame ? G.FRAME.h : G.PLATE.h;
    const parts = [
      { id: "body", name: frame ? "Frame" : "Plate", color: "base", z0: 0, z1: T, fill: (ctx) => ctx.fill(frame ? G.shapes.frameBody() : G.shapes.plateBody(), "evenodd") },
    ];
    if (S.edge === "raised") parts.push({ id: "edge", name: "Raised edge", color: "accent", z0: T, z1: T + (frame ? G.FRAME.rimH : G.PLATE.rimH), fill: (ctx) => ctx.fill(frame ? G.shapes.frameRim() : G.shapes.plateRim(), "evenodd") });
    const lay = layout();
    if (lay.length) parts.push({ id: "text", name: "Text", color: "accent", z0: T, z1: T + S.textH, fill: (ctx) => drawText(ctx, lay) });
    return { frame, kind: frame ? "frame" : "plate", w, h, T, parts, lay, bounds: { x0: -w / 2 - 1, x1: w / 2 + 1, y0: -h / 2 - 1, y1: h / 2 + 1 } };
  }

  function raster(fill, b, clip) {
    const W = Math.ceil((b.x1 - b.x0) * RES), H = Math.ceil((b.y1 - b.y0) * RES);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(RES, 0, 0, -RES, -b.x0 * RES, b.y1 * RES);
    ctx.fillStyle = "#000";
    fill(ctx);
    if (clip) { ctx.globalCompositeOperation = "destination-in"; clip(ctx); }
    const d = ctx.getImageData(0, 0, W, H).data, a = new Uint8Array(W * H);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return { a, W, H };
  }

  // The two pieces' regions. The right piece gives up a thin gap along the cut so the dovetails slide in.
  function pieceClips(m) {
    if (S.bed === "one") return [null];
    const left = G.shapes.leftRegion(m.kind, m.bounds);
    const cut = G.cutLine(m.kind, m.bounds);
    return [
      (ctx) => { ctx.fill(left); },
      (ctx) => {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.fill(left);
        ctx.lineWidth = G.CUT.clear * 2; ctx.lineJoin = "miter";
        ctx.beginPath(); cut.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        ctx.restore();
      },
    ];
  }

  function buildPieces() {
    const m = model();
    const bed = G.BEDS[S.bed];
    const g = { x0: m.bounds.x0, y1: m.bounds.y1, res: RES };
    return pieceClips(m).map((clip, pi) => {
      const parts = [];
      for (const p of m.parts) {
        const r = raster(p.fill, m.bounds, clip);
        const polys = G.maskToPolys(r.a, r.W, r.H, g);
        if (!polys.length) continue;
        parts.push({ name: p.name, filament: p.color === "base" ? 1 : 2, mesh: G.extrude(polys, p.z0, p.z1) });
      }
      // Centre the piece on the bed.
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of parts) for (let i = 0; i < p.mesh.v.length; i += 3) { const x = p.mesh.v[i], y = p.mesh.v[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const dx = bed.w / 2 - (x0 + x1) / 2, dy = bed.h / 2 - (y0 + y1) / 2;
      for (const p of parts) p.mesh = G.translate(p.mesh, dx, dy);
      return { parts, size: [x1 - x0, y1 - y0], closed: parts.every((p) => G.isClosed(p.mesh)), name: S.bed === "one" ? "" : pi === 0 ? "left" : "right" };
    });
  }

  /* ---------- Print checks ---------- */

  let lastCheck = { thin: 0, specks: 0 };
  let checkTimer = 0;
  function scheduleStrokeCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      const m = model();
      const text = m.parts.find((p) => p.id === "text");
      if (!text) { lastCheck = { thin: 0, specks: 0 }; renderChecks(); return; }
      const r = raster(text.fill, m.bounds);
      lastCheck = G.strokeCheck(r.a, r.W, r.H, RES);
      renderChecks();
    }, 300);
  }

  function checks() {
    const m = model(), bed = G.BEDS[S.bed], out = [];
    const words = blockedIn(lines().map((k) => S[S.product][k].text).join(" "));
    if (words.length) out.push({ bad: true, text: `We can't print car brands or team names (${words.join(", ")}). Change the text to download.` });
    const pieceW = S.bed === "one" ? m.w : m.w / 2 - G.CUT.x + 8;
    out.push(pieceW <= bed.w - 4 && m.h <= bed.h - 4
      ? { ok: true, text: S.bed === "one" ? `Prints in one piece on a ${bed.label}.` : `Prints in two pieces on a ${bed.label}. Glue the dovetails.` }
      : { bad: true, text: `Too big for a ${bed.label}.` });
    if (m.frame) out.push({ ok: true, text: "Fits a standard 12 × 6 in US plate. Holes line up with the plate's 7 in × 4.75 in screw pattern." });
    else out.push({ ok: true, text: "12 × 6 in with standard screw slots. Novelty plate for walls and garages, not for road use." });
    if (!m.lay.length) out.push({ warn: true, text: "No text yet. Add a line in Text." });
    for (const t of m.lay) {
      const name = { top: "Top line", main: "Main text", bottom: "Bottom line" }[t.key];
      if (t.cap < 5) out.push({ bad: true, text: `${name} letters are ${t.cap.toFixed(1)} mm tall. Use a shorter line so they stay 5 mm or taller.` });
      else if (t.fitted) out.push({ warn: true, text: `${name} was shrunk to fit: letters are ${t.cap.toFixed(1)} mm tall.` });
    }
    if (lastCheck.thin) out.push({ bad: true, text: `${lastCheck.thin} letter part${lastCheck.thin > 1 ? "s are" : " is"} thinner than 0.9 mm and may not print. Pick a bolder font or bigger text.` });
    if (lastCheck.specks) out.push({ warn: true, text: `${lastCheck.specks} tiny speck${lastCheck.specks > 1 ? "s" : ""} under 0.8 mm² (dots or punctuation) may not stick.` });
    if (m.lay.length && !lastCheck.thin && !m.lay.some((t) => t.cap < 5)) out.push({ ok: true, text: "Letters are 5 mm or taller with strokes of 0.9 mm or more." });
    out.push({ ok: true, text: `${m.frame ? "Frame" : "Plate"} is ${m.T.toFixed(1)} mm thick; raised text and edge sit ${S.textH.toFixed(1)} mm on top.` });
    if (m.frame) out.push({ note: true, text: "The bars cover about 23 mm at the top and bottom of the plate. Check your state's rules about covering the state name and stickers." });
    return out;
  }
  const blocked = () => checks().some((c) => c.bad);

  /* ---------- Preview ---------- */

  const stage = $("#stage"), cv = $("#preview"), pctx = cv.getContext("2d");
  let texturePattern = null;
  function surfaceTexture() {
    if (texturePattern) return texturePattern;
    const t = document.createElement("canvas"); t.width = t.height = 8;
    const c = t.getContext("2d");
    c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, 8); c.lineTo(8, 0); c.stroke();
    texturePattern = pctx.createPattern(t, "repeat");
    return texturePattern;
  }
  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  };
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };

  function draw() {
    const m = model();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const box = stage.getBoundingClientRect();
    const W = Math.max(200, box.width), H = Math.max(160, box.height);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    cv.style.width = W + "px"; cv.style.height = H + "px";
    const pad = Math.min(W, H) < 420 ? 14 : 48;
    const s = Math.min((W - pad * 2) / (m.w + 6), (H - pad * 2 - 24) / (m.h + 6));
    const ctx = pctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const k = s * dpr;
    ctx.setTransform(k, 0, 0, -k, (W / 2) * dpr, (H / 2 - 6) * dpr);
    const px = 1 / s; // one CSS pixel in mm
    const base = color(S.base).hex, accent = color(S.accent).hex;

    const shadow = (blur, dy, a) => { ctx.shadowColor = `rgba(20,24,32,${a})`; ctx.shadowBlur = blur * dpr; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = dy * dpr; };
    const noShadow = () => { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };

    // The car plate behind a frame: plain embossed aluminium, no state or numbers.
    if (m.frame && S.mounted) {
      const p = new Path2D(); roundPath(p, -G.US.w / 2, -G.US.h / 2, G.US.w / 2, G.US.h / 2, 6);
      shadow(10, 4, 0.22); ctx.fillStyle = "#e9ecef"; ctx.fill(p); noShadow();
      const gr = ctx.createLinearGradient(0, G.US.h / 2, 0, -G.US.h / 2);
      gr.addColorStop(0, "#f7f8f9"); gr.addColorStop(1, "#d9dde2");
      ctx.fillStyle = gr; ctx.fill(p);
      const e = new Path2D(); roundPath(e, -G.US.w / 2 + 4, -G.US.h / 2 + 4, G.US.w / 2 - 4, G.US.h / 2 - 4, 4);
      ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.stroke(e);
      ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(90,98,110,.35)"; ctx.stroke(e);
    }

    // Body with its height shadow, a soft light falloff, a matte top-surface texture and a bevel.
    const body = m.frame ? G.shapes.frameBody() : G.shapes.plateBody();
    shadow(m.frame ? 8 : 14, m.frame ? 3 : 6, m.frame ? 0.35 : 0.28);
    ctx.fillStyle = base; ctx.fill(body, "evenodd"); noShadow();
    ctx.save(); ctx.clip(body, "evenodd");
    const lg = ctx.createLinearGradient(-m.w / 2, m.h / 2, m.w / 2, -m.h / 2);
    lg.addColorStop(0, "rgba(255,255,255,.10)"); lg.addColorStop(0.5, "rgba(255,255,255,0)"); lg.addColorStop(1, "rgba(0,0,0,.10)");
    ctx.fillStyle = lg; ctx.fillRect(-m.w, -m.h, m.w * 2, m.h * 2);
    ctx.globalAlpha = lum(base) > 0.6 ? 0.05 : 0.035;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = surfaceTexture(); ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1.2, 2.4 * px); ctx.strokeStyle = lum(base) > 0.5 ? "rgba(0,0,0,.16)" : "rgba(255,255,255,.12)"; ctx.stroke(body);
    ctx.restore();

    // Raised parts: a contact shadow, a lit top-left edge, then the face.
    const raised = (fill) => {
      ctx.save();
      shadow(Math.max(1, 0.8 * s), Math.max(0.6, 0.45 * s), 0.45); ctx.fillStyle = shade(accent, -0.35); fill(ctx); noShadow();
      ctx.translate(-0.12, 0.12); ctx.fillStyle = shade(accent, lum(accent) > 0.8 ? 0 : 0.35); fill(ctx);
      ctx.translate(0.12, -0.12); ctx.fillStyle = accent; fill(ctx);
      ctx.restore();
    };
    for (const p of m.parts) if (p.id !== "body") raised(p.fill);

    // Screws when mounted.
    if (S.mounted) {
      for (const [x, y] of [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([a, b]) => [a * G.US.holeX, b * G.US.holeY])) {
        const r = m.frame ? 4.6 : 4.2;
        shadow(2, 1, 0.4);
        const rg = ctx.createRadialGradient(x - 1.2, y + 1.4, 0.4, x, y, r);
        rg.addColorStop(0, "#fbfcfd"); rg.addColorStop(0.55, "#b9bfc6"); rg.addColorStop(1, "#7d848c");
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); noShadow();
        ctx.strokeStyle = "rgba(40,44,50,.55)"; ctx.lineWidth = 0.9; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y); ctx.moveTo(x, y - r * 0.5); ctx.lineTo(x, y + r * 0.5); ctx.stroke();
      }
    }

    // Where a two-piece print splits.
    if (S.bed === "two" && S.seam) {
      const cut = G.cutLine(m.kind, { y0: -m.h / 2 + 5, y1: m.h / 2 - 5 });
      ctx.save(); ctx.clip(body, "evenodd");
      ctx.setLineDash([4 * px, 3 * px]); ctx.lineWidth = 1.4 * px;
      ctx.strokeStyle = lum(base) > 0.5 ? "rgba(20,24,32,.6)" : "rgba(255,255,255,.7)";
      ctx.beginPath(); cut.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.restore();
    }

    // Size line under the product.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const inch = (mm) => (mm / G.IN).toFixed(2).replace(/\.?0+$/, "");
    $("#dims").textContent = `${m.w.toFixed(1)} × ${m.h.toFixed(1)} mm (${inch(m.w)} × ${inch(m.h)} in)`;
  }
  function roundPath(p, x0, y0, x1, y1, r) {
    p.moveTo(x0 + r, y0); p.lineTo(x1 - r, y0); p.arcTo(x1, y0, x1, y0 + r, r); p.lineTo(x1, y1 - r); p.arcTo(x1, y1, x1 - r, y1, r);
    p.lineTo(x0 + r, y1); p.arcTo(x0, y1, x0, y1 - r, r); p.lineTo(x0, y0 + r); p.arcTo(x0, y0, x0 + r, y0, r); p.closePath();
  }

  /* ---------- Panels ---------- */

  const ICON = {
    ok: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warn: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3l8 14H2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 8v4M10 14.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    bad: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    note: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 9v5M10 6v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };
  const escHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function renderChecks() {
    const list = checks();
    const html = list.map((c) => {
      const kind = c.bad ? "bad" : c.warn ? "warn" : c.note ? "note" : "ok";
      return `<li class="chk ${kind}">${ICON[kind]}<span>${escHTML(c.text)}</span></li>`;
    }).join("");
    for (const ul of $$(".checks")) ul.innerHTML = html;
    const off = list.some((c) => c.bad);
    for (const b of $$("[data-download], [data-order]")) b.disabled = off;
    const m = model();
    const filaments = [color(S.base)];
    if (m.parts.some((p) => p.color === "accent")) filaments.push(color(S.accent));
    const det = [
      ["Product", m.frame ? "Plate frame" : "Novelty plate"],
      ["Size", `${m.w.toFixed(1)} × ${m.h.toFixed(1)} mm`],
      ["Pieces", S.bed === "one" ? "1" : "2, joined with dovetails"],
      ["Filament 1", filaments[0].name],
      ...(filaments[1] ? [["Filament 2", filaments[1].name]] : []),
      ["Files", "3MF for Bambu Studio, or STL"],
    ];
    for (const dl of $$(".details")) dl.innerHTML = det.map(([k, v]) => `<div><dt>${k}</dt><dd>${escHTML(v)}</dd></div>`).join("");
    renderOrder();
  }

  function textFields() {
    const labels = { top: "Top line", main: "Main text", bottom: "Bottom line" };
    const max = { top: 28, main: 10, bottom: 28 };
    const z = zones();
    $("#text-lines").innerHTML = lines().map((k) => {
      const L = S[S.product][k];
      return `<div class="field-group" data-line="${k}">
        <label class="lbl" for="t-${k}">${labels[k]}${k === "top" && S.product === "frame" ? ' <span class="opt">optional</span>' : ""}</label>
        <input id="t-${k}" class="inp" type="text" maxlength="${max[k]}" value="${escHTML(L.text)}" autocomplete="off" spellcheck="false" placeholder="${k === "top" && S.product === "frame" ? "Leave empty for a plain top bar" : "Type your text"}">
        <div class="row2">
          <label class="mini">Letter height <output id="o-cap-${k}">${L.cap} mm</output>
            <input type="range" id="cap-${k}" min="5" max="${z[k].maxCap}" step="0.5" value="${Math.min(L.cap, z[k].maxCap)}"></label>
          <label class="mini">Spacing <output id="o-sp-${k}">${Math.round(L.sp * 100)}</output>
            <input type="range" id="sp-${k}" min="0" max="0.4" step="0.01" value="${L.sp}"></label>
        </div>
      </div>`;
    }).join("");
    for (const k of lines()) {
      const L = S[S.product][k];
      $(`#t-${k}`).addEventListener("input", (e) => { L.text = e.target.value; changed(); });
      $(`#cap-${k}`).addEventListener("input", (e) => { L.cap = +e.target.value; $(`#o-cap-${k}`).textContent = `${L.cap} mm`; changed(); });
      $(`#sp-${k}`).addEventListener("input", (e) => { L.sp = +e.target.value; $(`#o-sp-${k}`).textContent = Math.round(L.sp * 100); changed(); });
    }
  }

  function swatches(id, key) {
    const el = $(id);
    el.innerHTML = COLORS.map((c) => `<button type="button" class="sw" role="radio" aria-checked="${S[key] === c.id}" data-c="${c.id}" title="${c.name}" aria-label="${c.name}" style="--c:${c.hex}"></button>`).join("");
    el.addEventListener("click", (e) => {
      const b = e.target.closest(".sw"); if (!b) return;
      S[key] = b.dataset.c; syncControls(); changed();
    });
  }

  function seg(name) {
    for (const b of $$(`[data-seg="${name}"] button`)) {
      b.addEventListener("click", () => {
        const v = b.dataset.v;
        S[name] = name === "textH" ? +v : v;
        if (name === "product") textFields();
        syncControls(); changed(true);
      });
    }
  }

  function syncControls() {
    for (const g of $$("[data-seg]")) for (const b of $$("button", g)) b.setAttribute("aria-pressed", String(b.dataset.v === String(S[g.dataset.seg])));
    for (const [id, key] of [["#sw-base", "base"], ["#sw-accent", "accent"]]) for (const b of $$(".sw", $(id))) b.setAttribute("aria-checked", String(b.dataset.c === S[key]));
    $("#sw-base-name").textContent = color(S.base).name;
    $("#sw-accent-name").textContent = color(S.accent).name;
    $("#font").value = S.font;
    $("#upper").checked = S.upper;
    $("#mounted").checked = S.mounted;
    $("#seam").checked = S.seam;
    $("#seam-row").hidden = S.bed !== "two";
    $("#mounted-label").textContent = S.product === "frame" ? "Show it on a plate with screws" : "Show screws";
    $("#title").textContent = S.product === "frame" ? "License plate frame" : "Novelty license plate";
    document.title = `${S.product === "frame" ? "License Plate Frame" : "Novelty Plate"} | License Plate Maker`;
  }

  let raf = 0;
  function changed(now) {
    save();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { draw(); renderChecks(); });
    scheduleStrokeCheck();
    if (now) { draw(); renderChecks(); }
  }

  /* ---------- Tools: rail, drawer and the phone sheet ---------- */

  function openTool(name, toggle) {
    const phone = matchMedia("(max-width: 760px)").matches;
    const current = document.body.dataset.tool;
    if (phone && toggle && current === name && document.body.classList.contains("sheet-open")) { document.body.classList.remove("sheet-open"); setPressed(""); return; }
    document.body.dataset.tool = name;
    for (const p of $$(".tool-panel")) p.hidden = p.dataset.panel !== name;
    setPressed(name);
    if (phone) document.body.classList.add("sheet-open");
  }
  const setPressed = (name) => { for (const b of $$("[data-tool]")) b.setAttribute("aria-pressed", String(b.dataset.tool === name)); };

  /* ---------- Downloads ---------- */

  const slug = () => {
    const words = lines().map((k) => S[S.product][k].text).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return `${S.product === "frame" ? "plate-frame" : "novelty-plate"}${words ? "-" + words : ""}`;
  };
  function save_(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // Builds the print file: one 3MF/STL, or a zip of both pieces with a short README.
  async function printFile(kind) {
    await document.fonts.ready;
    const pieces = buildPieces();
    if (!pieces.every((p) => p.closed)) throw new Error("open mesh");
    const base = slug(), cols = [color(S.base), color(S.accent)];
    const title = S.product === "frame" ? "License plate frame" : "Novelty license plate";
    const file = (p) => kind === "3mf"
      ? G.to3MF(p.parts, p.name ? `${title} (${p.name} piece)` : title, cols)
      : new Blob([G.toSTL(p.parts.map((q) => (q.filament === 1 ? q.mesh : G.sink(q.mesh, 0.02))), title)], { type: "model/stl" });
    const tris = pieces.reduce((s, p) => s + p.parts.reduce((t, q) => t + q.mesh.f.length / 3, 0), 0);
    if (pieces.length === 1) return { blob: file(pieces[0]), name: `${base}.${kind}`, pieces: 1, tris };
    const enc = new TextEncoder();
    const files = [];
    for (const p of pieces) files.push({ name: `${base}-${p.name}.${kind}`, data: new Uint8Array(await file(p).arrayBuffer()) });
    files.push({ name: "README.txt", data: enc.encode(`Two pieces that fit a 256 mm bed. Print both, slide the dovetails together and glue with CA glue.\nFilament 1: ${cols[0].name}. Filament 2: ${cols[1].name}.\nMade with the EPIX3D License Plate Maker.\n`) });
    return { blob: G.zip(files), name: `${base}-2-pieces-${kind}.zip`, pieces: pieces.length, tris };
  }
  const busy = (on) => { for (const b of $$("[data-download], [data-order]")) b.disabled = on; };
  const say = (t) => { for (const s of $$(".dl-status")) s.textContent = t; };

  async function download(kind) {
    if (blocked()) return;
    busy(true);
    say("Building the print file…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const f = await printFile(kind);
      save_(f.blob, f.name);
      say(`Ready: ${f.pieces} piece${f.pieces > 1 ? "s" : ""}, closed meshes, ${f.tris.toLocaleString()} triangles.`);
    } catch (e) {
      console.error(e);
      say("The print file couldn't be built. Try again, or change the text.");
    } finally {
      busy(false); renderChecks();
    }
  }

  /* ---------- Ordering a print (lib/plate-order.mjs on the server picks the product) ---------- */

  const MAX_FILE = 20 * 1024 * 1024; // Shopify's limit for a file on a cart line
  let order = null;
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  const orderVariant = () => {
    const vs = order?.variants ?? [];
    if (vs.length <= 1) return vs[0] ?? null;
    return vs.find((v) => (S.product === "frame" ? /frame/i.test(v.title) : /plate/i.test(v.title) && !/frame/i.test(v.title))) ?? null;
  };
  function renderOrder() {
    const v = order && order.mode !== "none" ? orderVariant() : null;
    document.body.classList.toggle("can-order", !!v);
    if (v) for (const b of $$(".bar-order")) b.textContent = order.mode === "buy" ? "Order print" : "Request print";
    for (const box of $$(".order")) {
      box.hidden = !v;
      if (!v) continue;
      $(".order-note", box).textContent = order.mode === "buy"
        ? `${money(v.price)} each, printed in Charleston, SC. Shipping and tax are added at checkout.`
        : "Free request. We print it in Charleston, SC and reply with a price within 1-2 business days. You pay nothing now.";
      $("[data-order]", box).textContent = order.mode === "buy" ? "Order this print" : "Request this print";
    }
  }
  async function loadOrder() {
    try {
      const r = await fetch("/api/plate-order", { headers: { accept: "application/json" } });
      order = r.ok ? await r.json() : null;
    } catch { order = null; }
    renderOrder();
  }
  const previewBlob = () => new Promise((res) => cv.toBlob(res, "image/png"));
  function fileInput(name, blob, filename) {
    const dt = new DataTransfer();
    dt.items.add(new File([blob], filename, { type: blob.type || "application/octet-stream" }));
    const inp = document.createElement("input");
    inp.type = "file"; inp.name = name; inp.files = dt.files;
    return inp;
  }
  async function placeOrder() {
    const v = orderVariant();
    if (!v || blocked()) return;
    busy(true);
    say("Building the print file…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const f = await printFile("3mf");
      const png = await previewBlob();
      if (f.blob.size > MAX_FILE || (png && png.size > MAX_FILE)) throw new Error("too big");
      const cols = [color(S.base), color(S.accent)];
      const m = model();
      const fields = {
        id: String(v.id), quantity: "1",
        "properties[Item]": m.frame ? "License plate frame" : "Novelty license plate",
        "properties[Text]": lines().map((k) => S[S.product][k].text.trim()).filter(Boolean).join(" / ") || "(no text)",
        "properties[Font]": FONTS.find((x) => x.id === S.font)?.label ?? S.font,
        "properties[Colors]": m.parts.some((p) => p.color === "accent") ? `${cols[0].name} with ${cols[1].name}` : cols[0].name,
        "properties[Size]": `${m.w.toFixed(1)} x ${m.h.toFixed(1)} mm`,
        "properties[Pieces]": S.bed === "one" ? "1" : "2, dovetailed",
        "properties[_Source]": "epix3d-license-plate-maker",
        return_to: "/cart",
      };
      const form = document.createElement("form");
      form.method = "post"; form.enctype = "multipart/form-data"; form.action = `${order.store}/cart/add`; form.hidden = true;
      for (const [k, val] of Object.entries(fields)) {
        const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = val; form.append(i);
      }
      form.append(fileInput("properties[Print file]", f.blob, f.name));
      if (png) form.append(fileInput("properties[Design preview]", png, `${slug()}-preview.png`));
      document.body.append(form);
      say("Uploading your design and opening the cart…");
      form.submit();
      // If the store is slow or they come back with the back button, let them try again.
      setTimeout(() => { busy(false); renderChecks(); form.remove(); }, 20000);
    } catch (e) {
      console.error(e);
      say(e.message === "too big" ? "This design is too large to send with the order. Download the 3MF instead." : "The order couldn't be started. Try again.");
      busy(false); renderChecks();
    }
  }

  /* ---------- Start ---------- */

  function init() {
    $("#font").innerHTML = FONTS.map((f) => `<option value="${f.id}">${f.label}</option>`).join("");
    $("#font").addEventListener("change", (e) => { S.font = e.target.value; changed(true); });
    $("#upper").addEventListener("change", (e) => { S.upper = e.target.checked; changed(); });
    $("#mounted").addEventListener("change", (e) => { S.mounted = e.target.checked; changed(); });
    $("#seam").addEventListener("change", (e) => { S.seam = e.target.checked; changed(); });
    swatches("#sw-base", "base"); swatches("#sw-accent", "accent");
    for (const n of ["product", "edge", "textH", "bed"]) seg(n);
    for (const b of $$("[data-tool]")) b.addEventListener("click", () => openTool(b.dataset.tool, true));
    $("#sheet-close").addEventListener("click", () => { document.body.classList.remove("sheet-open"); setPressed(""); });
    for (const b of $$("[data-download]")) b.addEventListener("click", () => download(b.dataset.download));
    for (const b of $$("[data-order]")) b.addEventListener("click", placeOrder);
    loadOrder();
    $("#reset").addEventListener("click", () => { S = structuredClone(DEFAULTS); textFields(); syncControls(); changed(true); });
    textFields(); syncControls();
    openTool("product");
    if (matchMedia("(max-width: 760px)").matches) { document.body.classList.remove("sheet-open"); setPressed(""); }
    new ResizeObserver(() => draw()).observe(stage);
    changed(true);
    // Redraw once the web fonts arrive, with fresh letter measurements.
    Promise.all(FONTS.map((f) => document.fonts.load(fontCss(f.id, 40), "ABC")))
      .catch(() => {}).then(() => { metricsCache.clear(); changed(true); document.documentElement.dataset.ready = "1"; });
  }

  // For tests: pixels where the two pieces' bodies overlap (should be 0) and the narrowest gap along the cut.
  function jointCheck() {
    const m = model(); const clips = pieceClips(m); if (clips.length < 2) return null;
    const body = m.parts[0];
    const [L, R] = clips.map((c) => raster(body.fill, m.bounds, c));
    let overlap = 0; for (let i = 0; i < L.a.length; i++) if (L.a[i] >= 128 && R.a[i] >= 128) overlap++;
    return { overlap };
  }
  window.LPM = { state: () => S, order: () => order, buildPieces, checks, jointCheck, set: (patch) => { merge(S, patch); textFields(); syncControls(); changed(true); } };
  init();
})();
