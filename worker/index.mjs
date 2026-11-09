// The epix3d.com Worker. It serves the EPIX3D site (dist/, built by scripts/build.mjs: the pages, the
// makers and assets/), the site API (accounts, projects, print orders, Platinum) and, unchanged, the
// image library and E: drive APIs that the Elevated Designs shirt app and the Creative Lab engine use.
// The image library lives in the same Workers KV namespace as the Creative Lab engine's (IMAGES); accounts,
// projects and orders live in their own namespace (ACCOUNTS).
import { handleImages } from "../lib/images.mjs";
import { kvBlobStore } from "../lib/kv-store.mjs";
import { handleDrive } from "../lib/drive.mjs";
import { loadPlateOrder, NAMEPLATE_TAG } from "../lib/plate-order.mjs";
import { ApiError, json as apiJson, errorResponse, sameOrigin } from "../lib/http.mjs";
import { handleAuth } from "../lib/accounts.mjs";
import { handleProjects } from "../lib/projects.mjs";
import { createOrder, listOrders, serveFile, checkExport } from "../lib/orders.mjs";
import { handleWebhook, handleAdminPlatinum } from "../lib/webhook.mjs";
import { platinumReady, PLATINUM_VARIANT_ID, PLATINUM_SELLING_PLAN_ID, PLATINUM_PRICE_LABEL, ACCOUNT_PROPERTY, STORE } from "../lib/shop-config.mjs";

export const HQ_URL = "https://claude.ai/artifact/U8rNeWMPq7NfF7f88AEuPK";

// The Charleston3D store: ordered prints and Platinum check out there, so pages may post to its cart.
const CART = "https://charleston3d.com https://www.charleston3d.com";
export const SITE_HEADERS = {
  "content-security-policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' ${CART}`,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
// The 3D makers (makers/<maker>/) are self-contained pages that load three.js and JSZip from public CDNs
// and run their own inline scripts, so they get their own policy. Every maker can order a print, so every
// maker may post to the Charleston3D cart. Only this site may frame them.
export const MAKER_HEADERS = {
  ...SITE_HEADERS,
  "x-frame-options": "SAMEORIGIN",
  "content-security-policy": `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'self' ${CART}`,
};
export const PLATE_HEADERS = MAKER_HEADERS;
// The Photo to 3D Maker runs its 3D engine (ONNX Runtime, WebAssembly and WebGPU) in the visitor's browser,
// which needs WebAssembly compiling: 'wasm-unsafe-eval' allows that and nothing else (no eval of scripts).
export const PHOTO3D_HEADERS = {
  ...MAKER_HEADERS,
  "content-security-policy": MAKER_HEADERS["content-security-policy"].replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"),
};
const MAKER_PAGE = /^\/makers\/[a-z0-9-]+\//;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const envReader = (env) => (k) => typeof env?.[k] === "string" ? env[k] : undefined;

// The site API: accounts, projects, orders, Platinum. Everything but /api/config needs ACCOUNTS.
const SITE_API = /^\/api\/(config$|me$|auth\/|projects($|\/)|orders$|exports\/|shopify\/webhook$|admin\/platinum$)/;
async function handleSite(req, env, pathname, fetchImpl) {
  const kv = env?.ACCOUNTS;
  if (pathname === "/api/config") {
    if (req.method !== "GET") throw new ApiError(405, "method", "Not allowed.");
    return apiJson({ accounts: !!kv, platinum: { available: platinumReady(), price: PLATINUM_PRICE_LABEL, store: STORE, variant: PLATINUM_VARIANT_ID, sellingPlan: PLATINUM_SELLING_PLAN_ID, accountProperty: ACCOUNT_PROPERTY } });
  }
  if (!kv || typeof kv.get !== "function") throw new ApiError(503, "storage_not_set_up", "Accounts aren't switched on yet. Try again soon.");
  if (pathname === "/api/shopify/webhook") return handleWebhook(req, kv, envReader(env));
  if (pathname === "/api/admin/platinum") return handleAdminPlatinum(req, kv, envReader(env));
  // Writes must come from this site's own pages.
  if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) throw new ApiError(403, "cross_site", "Not allowed from another site.");
  if (pathname === "/api/me" || pathname.startsWith("/api/auth/")) return handleAuth(req, kv);
  if (pathname === "/api/projects" || pathname.startsWith("/api/projects/")) return handleProjects(req, kv);
  if (pathname === "/api/orders") {
    if (req.method === "POST") return createOrder(req, kv, { fetchImpl });
    if (req.method === "GET") return listOrders(req, kv);
    throw new ApiError(405, "method", "Not allowed.");
  }
  if (pathname === "/api/exports/check" && req.method === "POST") return checkExport(req, kv);
  throw new ApiError(404, "not_found", "Not found");
}

export async function handleRequest(req, env, fetchImpl = fetch) {
  const { pathname } = new URL(req.url);
  // Short link to Aaron's main console (Creative Lab Studios on claude.ai).
  if (pathname === "/hq" || pathname === "/hq/") return new Response(null, { status: 302, headers: { ...SITE_HEADERS, location: HQ_URL, "cache-control": "no-store" } });
  try {
    if (pathname === "/api/images" || pathname.startsWith("/api/images/")) {
      if (!env?.IMAGES || typeof env.IMAGES.list !== "function")
        return json({ error: "The image library isn't set up yet: add the IMAGES KV namespace binding (see the README).", code: "storage_not_set_up" }, 503);
      return await handleImages(req, { blobs: kvBlobStore(env.IMAGES), env: envReader(env) });
    }
    if (pathname === "/api/drive" || pathname.startsWith("/api/drive/")) return await handleDrive(req, { env: envReader(env) });
    if (pathname === "/api/plate-order" && req.method === "GET") {
      try { return json(await loadPlateOrder(fetchImpl)); }
      catch (e) { console.error("plate order lookup failed", e?.message); return json({ mode: "none", error: "The store couldn't be reached." }); }
    }
    if (pathname === "/api/nameplate-order" && req.method === "GET") {
      try { return json(await loadPlateOrder(fetchImpl, undefined, NAMEPLATE_TAG)); }
      catch (e) { console.error("nameplate order lookup failed", e?.message); return json({ mode: "none", error: "The store couldn't be reached." }); }
    }
    if (SITE_API.test(pathname)) {
      try { return await handleSite(req, env, pathname, fetchImpl); }
      catch (e) { if (e instanceof ApiError) return errorResponse(e); throw e; }
    }
    if (pathname.startsWith("/files/")) {
      if (req.method !== "GET" || !env?.ACCOUNTS) return new Response("Not found", { status: 404 });
      return await serveFile(pathname, env.ACCOUNTS);
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("site api error", pathname, e?.name);
    return json({ error: "Something went wrong on the server." }, 500);
  }
  if (!env?.ASSETS) return new Response("Not found", { status: 404, headers: SITE_HEADERS });
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  const headers = pathname.startsWith("/makers/ai3d/") ? PHOTO3D_HEADERS : MAKER_PAGE.test(pathname) ? MAKER_HEADERS : SITE_HEADERS;
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export default { fetch: (req, env) => handleRequest(req, env) };
