// The Design Studio Worker: serves the app's files (dist/, built from index.html and assets/) and the
// image library API. The library lives in the same Workers KV namespace as the Business Console's
// (wrangler.toml); the studio only shows and changes Charleston 3D and EPIX3D art (lib/images.mjs).
import { handleImages } from "../lib/images.mjs";
import { kvBlobStore } from "../lib/kv-store.mjs";
import { handleDrive } from "../lib/drive.mjs";
import { loadPlateOrder, NAMEPLATE_TAG } from "../lib/plate-order.mjs";

export const HQ_URL = "https://claude.ai/artifact/U8rNeWMPq7NfF7f88AEuPK";

export const SITE_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
// The 3D makers (makers/) are self-contained pages that load three.js and JSZip from public CDNs and
// run their own inline scripts, so they get their own policy. Maker Studio (makers/index.html) shows them
// in a frame and the studio shows Maker Studio in one, so they may be framed by this site only.
export const MAKER_HEADERS = {
  ...SITE_HEADERS,
  "x-frame-options": "SAMEORIGIN",
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
};
// The Photo to 3D Maker runs its 3D engine (ONNX Runtime, WebAssembly and WebGPU) in the visitor's browser,
// which needs WebAssembly compiling: 'wasm-unsafe-eval' allows that and nothing else (no eval of scripts).
export const PHOTO3D_HEADERS = {
  ...MAKER_HEADERS,
  "content-security-policy": MAKER_HEADERS["content-security-policy"].replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"),
};
// The License Plate and Nameplate Makers also post orders to the Charleston3D store's cart (lib/plate-order.mjs).
export const PLATE_HEADERS = {
  ...MAKER_HEADERS,
  "content-security-policy": MAKER_HEADERS["content-security-policy"].replace("form-action 'self'", "form-action 'self' https://charleston3d.com https://www.charleston3d.com"),
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const envReader = (env) => (k) => typeof env?.[k] === "string" ? env[k] : undefined;

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
    if (pathname === "/api" || pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("studio api error", pathname, e?.name);
    return json({ error: "Something went wrong on the server." }, 500);
  }
  if (!env?.ASSETS) return new Response("Not found", { status: 404, headers: SITE_HEADERS });
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  const headers = pathname.startsWith("/makers/license-plate") || pathname.startsWith("/makers/nameplate") ? PLATE_HEADERS : pathname.startsWith("/makers/ai3d") ? PHOTO3D_HEADERS : pathname.startsWith("/makers/") ? MAKER_HEADERS : SITE_HEADERS;
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export default { fetch: (req, env) => handleRequest(req, env) };
