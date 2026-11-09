// Ordering a print from any maker, and the Platinum download check.
//
// POST /api/orders (signed in, multipart form): maker, project, details, product?, file (the 3MF the
//   maker built), preview? (PNG/JPEG). The file is kept under an unguessable order id, and the answer
//   carries the Charleston3D cart post the page sends the buyer to: the store's free "Custom request"
//   product at $0 (Aaron prices it himself), with the maker, project, details and a link to the file as
//   line-item properties. The License Plate Maker sells at the store's own prices instead when the store
//   has a product tagged "plate-maker" (lib/plate-order.mjs).
// GET  /api/orders           the signed-in user's print requests
// GET  /files/<order id>/<file name>   the stored print file, for anyone with the link (so Aaron can open
//   it from the Shopify order). The id is 24 random bytes; the link only goes into the order.
// POST /api/exports/check    200 for a signed-in Platinum member, 403 otherwise. The makers build their
//   files in the browser, so this is the server's say on each download; see README "Platinum" for limits.
//
// Keys in ACCOUNTS: order:<id> (details), orderfile:<id> (the file's bytes, metadata = name/type/size),
// orderprev:<id> (preview picture), orderidx:<user id> (the user's last 100 order ids).
import { ApiError, json, readBody, randomId, cleanText } from "./http.mjs";
import { requireUser, isPlatinum } from "./accounts.mjs";
import { loadPlateOrder, variantFor } from "./plate-order.mjs";
import { STORE, QUOTE_VARIANT_ID, ACCOUNT_PROPERTY } from "./shop-config.mjs";
import { MAKERS } from "./projects.mjs";

export const MAX_FILE = 20 * 1024 * 1024; // Workers KV holds 25 MiB per value; Shopify's file limit is 20 MB too
export const MAX_PREVIEW = 3 * 1024 * 1024;
export const ORDERS_PER_DAY = 20;
const ORDER_ID_RE = /^[A-Za-z0-9_-]{32}$/;
export const MAKER_NAMES = { lightbox: "Light box", "license-plate": "License plate", nameplate: "Nameplate", "hype-chain": "Hype chain" };
const MODE_NAMES = { lightbox: "Light box", keychain: "Keychain", sign: "Sign", litho: "Lithophane" };

const sniffZip = (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const sniffStl = (b) => b.length >= 84; // binary STL: 80-byte header + count; ASCII starts with "solid"
const FILE_TYPES = { ".3mf": ["model/3mf", sniffZip], ".zip": ["application/zip", sniffZip], ".stl": ["model/stl", sniffStl] };
export const safeFileName = (n) => (cleanText(n, 100).replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/\s+/g, "-").replace(/^[.-]+/, "") || "print-file").slice(0, 100);

// Which product and variant an order goes on, read from the store's public feed (falls back to the config).
async function pickVariant(fetchImpl, maker, product) {
  let found = null;
  try { found = await loadPlateOrder(fetchImpl); } catch (e) { console.error("store feed", e?.message); }
  const store = found?.store ?? STORE;
  if (maker === "license-plate" && found?.mode === "buy") {
    const v = variantFor(found, product === "plate" ? "plate" : "frame");
    if (v) return { store, variant: v.id, priced: true };
  }
  if (found?.mode === "quote") return { store, variant: found.variants[0].id, priced: false };
  return { store, variant: QUOTE_VARIANT_ID, priced: false };
}

export async function createOrder(req, kv, { fetchImpl = fetch, now = Date.now() } = {}) {
  const user = await requireUser(req, kv);
  const dayKey = `rl:orders:${user.id}`;
  const today = Number((await kv.get(dayKey, "json"))?.n || 0);
  if (today >= ORDERS_PER_DAY) throw new ApiError(429, "rate_limited", "That's a lot of orders for one day. Try again tomorrow, or email us.");
  const type = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data/i.test(type)) throw new ApiError(400, "bad_form", "Send the order as a form.");
  const raw = await readBody(req, MAX_FILE + MAX_PREVIEW + 64 * 1024);
  const form = await new Response(raw, { headers: { "content-type": type } }).formData();

  const maker = String(form.get("maker") ?? "");
  if (!MAKERS.includes(maker)) throw new ApiError(400, "bad_maker", "That maker isn't one of ours.");
  const file = form.get("file");
  if (!file || typeof file === "string") throw new ApiError(400, "no_file", "The print file is missing.");
  if (file.size > MAX_FILE) throw new ApiError(413, "too_big", "This design is too large to order online (20 MB). Make it smaller or simpler.");
  const name = safeFileName(file.name);
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
  const kind = FILE_TYPES[ext];
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!kind || !kind[1](bytes)) throw new ApiError(400, "bad_file", "The print file must be a 3MF, STL or ZIP.");
  const preview = form.get("preview");
  let prevBytes = null, prevType = null;
  if (preview && typeof preview !== "string" && preview.size) {
    if (preview.size > MAX_PREVIEW) throw new ApiError(413, "too_big", "The preview picture is too big.");
    prevBytes = new Uint8Array(await preview.arrayBuffer());
    prevType = prevBytes[0] === 0x89 && prevBytes[1] === 0x50 ? "image/png" : prevBytes[0] === 0xff && prevBytes[1] === 0xd8 ? "image/jpeg" : null;
    if (!prevType) prevBytes = null;
  }
  const mode = String(form.get("mode") ?? "");
  const project = cleanText(form.get("project"), 80) || "Untitled design";
  const details = cleanText(form.get("details"), 400);
  const product = String(form.get("product") ?? "");

  const id = randomId(24);
  const origin = new URL(req.url).origin;
  const fileUrl = `${origin}/files/${id}/${encodeURIComponent(name)}`;
  const pick = await pickVariant(fetchImpl, maker, product);
  const item = maker === "lightbox" && MODE_NAMES[mode] ? MODE_NAMES[mode] : MAKER_NAMES[maker];
  const fields = {
    id: String(pick.variant), quantity: "1",
    "properties[Item]": `EPIX3D ${item}`,
    "properties[Project]": project,
    ...(details ? { "properties[Details]": details } : {}),
    "properties[Order ref]": id.slice(0, 8),
    // Hidden from the cart (leading "_"), shown on the order in Shopify admin.
    "properties[_Print file]": fileUrl,
    ...(prevBytes ? { "properties[_Preview]": `${origin}/files/${id}/preview` } : {}),
    [`properties[${ACCOUNT_PROPERTY}]`]: user.email,
    "properties[_Source]": `epix3d-${maker}`,
    return_to: "/cart",
  };
  const order = { id, uid: user.id, email: user.email, maker, mode: mode || null, project, details, file: { name, type: kind[0], size: bytes.length }, variant: pick.variant, priced: pick.priced, createdAt: now };
  await kv.put(`orderfile:${id}`, bytes, { metadata: { name, type: kind[0], size: bytes.length } });
  if (prevBytes) await kv.put(`orderprev:${id}`, prevBytes, { metadata: { type: prevType } });
  await kv.put(`order:${id}`, JSON.stringify(order));
  const idx = (await kv.get(`orderidx:${user.id}`, "json")) ?? [];
  idx.unshift(id); await kv.put(`orderidx:${user.id}`, JSON.stringify(idx.slice(0, 100)));
  await kv.put(dayKey, JSON.stringify({ n: today + 1 }), { expirationTtl: 86400 });
  return json({ orderId: id, fileUrl, priced: pick.priced, cart: { action: `${pick.store}/cart/add`, method: "post", fields } }, 201);
}

export async function listOrders(req, kv) {
  const user = await requireUser(req, kv);
  const ids = ((await kv.get(`orderidx:${user.id}`, "json")) ?? []).slice(0, 20);
  const items = [];
  for (const id of ids) {
    const o = await kv.get(`order:${id}`, "json");
    if (o) items.push({ ref: id.slice(0, 8), maker: o.maker, mode: o.mode, project: o.project, file: o.file.name, createdAt: new Date(o.createdAt).toISOString() });
  }
  return json({ items });
}

// /files/<id>/<name> and /files/<id>/preview
export async function serveFile(pathname, kv) {
  const [, , id, rawName] = pathname.split("/");
  const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "x-robots-tag": "noindex" } });
  if (!ORDER_ID_RE.test(id ?? "") || !rawName) return notFound();
  const base = { "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "cache-control": "private, max-age=3600", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; sandbox" };
  if (rawName === "preview") {
    const p = await kv.getWithMetadata(`orderprev:${id}`, { type: "arrayBuffer" });
    if (!p?.value) return notFound();
    return new Response(p.value, { headers: { ...base, "content-type": p.metadata?.type ?? "image/png" } });
  }
  let name; try { name = decodeURIComponent(rawName); } catch { return notFound(); }
  const f = await kv.getWithMetadata(`orderfile:${id}`, { type: "arrayBuffer" });
  if (!f?.value || f.metadata?.name !== name) return notFound();
  return new Response(f.value, { headers: { ...base, "content-type": f.metadata.type ?? "application/octet-stream", "content-disposition": `attachment; filename="${name}"` } });
}

export async function checkExport(req, kv) {
  const user = await requireUser(req, kv);
  if (!isPlatinum(user)) throw new ApiError(403, "platinum_required", "Downloads are part of Platinum.");
  return json({ ok: true });
}
