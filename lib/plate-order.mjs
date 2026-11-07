// Ordering a print from the License Plate Maker. The order goes through the Charleston3D Shopify store:
// the maker posts the design and its print file to the store's /cart/add, and the buyer finishes at
// Shopify checkout. Nothing here holds a price: every price comes from the store's own product feed.
//
// Two ways to sell, found on the store at run time:
//   buy   - a product tagged "plate-maker" with priced variants (titles say "Frame" or "Plate").
//   quote - the store's free custom request product: the order comes in at $0 and Aaron quotes it.
// If the store has neither, the maker hides the order button and keeps the downloads.

export const STORE = "https://charleston3d.com";
export const SALE_TAG = "plate-maker";
export const REQUEST_TAG = "request-product";
export const REQUEST_HANDLES = ["custom-request", "custom-print-request", "free-custom-request", "request"];
const CACHE_SECONDS = 600;

const tagsOf = (p) => (Array.isArray(p.tags) ? p.tags : String(p.tags ?? "").split(","))
  .map((t) => String(t).trim().toLowerCase()).filter(Boolean);
const cents = (v) => Math.round(Number(v) * 100);

export function pickPlateOrder(products, store) {
  const sale = products.find((p) => tagsOf(p).includes(SALE_TAG) && (p.variants ?? []).some((v) => cents(v.price) > 0));
  if (sale) {
    const variants = sale.variants.filter((v) => cents(v.price) > 0 && v.available !== false)
      .map((v) => ({ id: v.id, title: String(v.title ?? ""), price: cents(v.price) }));
    if (variants.length) return { mode: "buy", store, title: String(sale.title ?? ""), variants };
  }
  // Same rule as the Charleston3D app: a request product only counts when every variant is free.
  const free = (p) => (p.variants ?? []).length > 0 && p.variants.every((v) => cents(v.price) === 0);
  const req = products.find((p) => tagsOf(p).includes(REQUEST_TAG) && free(p))
    ?? products.find((p) => REQUEST_HANDLES.includes(p.handle) && free(p));
  const v = req?.variants.find((x) => x.available !== false);
  if (v) return { mode: "quote", store, title: String(req.title ?? ""), variants: [{ id: v.id, title: "", price: 0 }] };
  return { mode: "none", store };
}

// Reads the store's public product feed (no token needed). Cart posts must go to the store's primary
// domain, because a redirect would turn the POST into a GET, so the answer carries the final origin.
export async function loadPlateOrder(fetchImpl = fetch, store = STORE) {
  const products = [];
  let origin = store;
  for (let page = 1; page <= 8; page++) {
    const res = await fetchImpl(`${store}/products.json?limit=250&page=${page}`, { headers: { accept: "application/json" }, cf: { cacheTtl: CACHE_SECONDS } });
    if (!res.ok) throw new Error(`store answered ${res.status}`);
    if (res.url) origin = new URL(res.url).origin;
    const batch = (await res.json()).products ?? [];
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return pickPlateOrder(products, origin);
}

// Picks the variant for what's on screen: "frame" or "plate". One variant serves both.
export function variantFor(order, product) {
  const vs = order?.variants ?? [];
  if (vs.length <= 1) return vs[0] ?? null;
  return vs.find((v) => (product === "frame" ? /frame/i.test(v.title) : /plate/i.test(v.title) && !/frame/i.test(v.title))) ?? null;
}
