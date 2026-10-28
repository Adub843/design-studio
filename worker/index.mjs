// The Design Studio Worker: serves the app's files (dist/, built from index.html and assets/) and the
// image library API. The library lives in the same Workers KV namespace as the Business Console's
// (wrangler.toml), so a design saved here is listed from the console and read by the shirt apps.
import { handleImages } from "../lib/images.mjs";
import { kvBlobStore } from "../lib/kv-store.mjs";
import { handleDrive } from "../lib/drive.mjs";

// Where the console's hourly Kittl sync keeps its last result, in the same namespace.
export const SYNC_STATE_KEY = "sync:kittl";

export const SITE_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};
// The 3D makers (makers/) are self-contained pages that load three.js and JSZip from public CDNs and
// run their own inline scripts, so they get their own policy. They still can't be framed elsewhere.
export const MAKER_HEADERS = {
  ...SITE_HEADERS,
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const envReader = (env) => (k) => typeof env?.[k] === "string" ? env[k] : undefined;

export async function handleRequest(req, env) {
  const { pathname } = new URL(req.url);
  try {
    if (pathname === "/api/images" || pathname.startsWith("/api/images/")) {
      if (!env?.IMAGES || typeof env.IMAGES.list !== "function")
        return json({ error: "The image library isn't set up yet: add the IMAGES KV namespace binding (see the README).", code: "storage_not_set_up" }, 503);
      return await handleImages(req, { blobs: kvBlobStore(env.IMAGES), env: envReader(env) });
    }
    if (pathname === "/api/drive" || pathname.startsWith("/api/drive/")) return await handleDrive(req, { env: envReader(env) });
    if (pathname === "/api/library-sync" && req.method === "GET") {
      const last = env?.IMAGES ? await env.IMAGES.get(SYNC_STATE_KEY, "json") : null;
      const { failed = [], ...rest } = last ?? {};
      return json(last ? { ...rest, failed: failed.length } : { ok: false, error: "No sync has run yet." });
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error("studio api error", pathname, e?.name);
    return json({ error: "Something went wrong on the server." }, 500);
  }
  if (!env?.ASSETS) return new Response("Not found", { status: 404, headers: SITE_HEADERS });
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  const headers = pathname.startsWith("/makers/") ? MAKER_HEADERS : SITE_HEADERS;
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

export default { fetch: (req, env) => handleRequest(req, env) };
