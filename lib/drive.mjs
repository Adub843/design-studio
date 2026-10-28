// The E: drive library: the files stay on Aaron's PC and are reached through the Cloudflare Tunnel at
// DRIVE_ORIGIN (drive-server/ in this repo). Everything here needs the studio key; previews and downloads
// use short-lived signed links so an <img> or a download link can load them.
//   GET /api/drive/search?q=&brand=&kind=&page=   needs the key; each item comes back with thumb and file links
//   GET /api/drive/stats                           needs the key
//   GET /api/drive/thumb/:id, /api/drive/file/:id  the key or a signed link (?exp=&sig=)
// Every request to the PC is signed with CONSOLE_KEY (x-drive-exp, x-drive-sig), which the PC checks.
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireKey, HttpError } from "./auth.mjs";

const ID_RE = /^[0-9a-f]{20}$/;
const LINK_TTL_S = 3600;
const BASE_HEADERS = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export const driveSig = (key, exp, pathAndQuery) => createHmac("sha256", `drive:${key}`).update(`${exp}\n${pathAndQuery}`).digest("base64url");
const linkSig = (key, what, id, exp) => createHmac("sha256", `drive-link:${key}`).update(`${what}/${id}.${exp}`).digest("base64url");
const signedLink = (key, what, id, now) => { const exp = Math.floor(now / 1000) + LINK_TTL_S; return `/api/drive/${what}/${id}?exp=${exp}&sig=${linkSig(key, what, id, exp)}`; };
function validLink(key, what, id, url, now) {
  const exp = Number(url.searchParams.get("exp")), sig = url.searchParams.get("sig") ?? "";
  if (!key || !Number.isInteger(exp) || exp < now / 1000 || exp > now / 1000 + LINK_TTL_S + 60) return false;
  const want = Buffer.from(linkSig(key, what, id, exp)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

const OFFLINE = { error: "The E: drive library opens while Aaron's PC is on and the E: drive is plugged in.", code: "pc_offline" };

export async function handleDrive(req, { env, fetchImpl = fetch, now = Date.now() }) {
  const url = new URL(req.url);
  if (req.method !== "GET") return json({ error: "Read only" }, 405);
  const origin = env("DRIVE_ORIGIN"), key = env("CONSOLE_KEY") ?? "";
  if (!origin) return json({ error: "The E: drive library isn't connected yet (DRIVE_ORIGIN).", code: "drive_not_set_up" }, 503);
  const sub = url.pathname.replace(/^\/api\/drive\/?/, "");
  const m = sub.match(/^(thumb|file)\/([^/]+)$/);
  let pcPath;
  if (m) {
    if (!ID_RE.test(m[2])) return json({ error: "Not found" }, 404);
    if (!validLink(key, m[1], m[2], url, now)) {
      try { requireKey({ header: (k) => req.headers.get(k) }, env, "The E: drive library"); }
      catch (e) { if (e instanceof HttpError) return json({ error: "Not found" }, 404); throw e; }
    }
    pcPath = `/${m[1]}/${m[2]}`;
  } else if (sub === "search" || sub === "stats") {
    try { requireKey({ header: (k) => req.headers.get(k) }, env, "The E: drive library"); }
    catch (e) { if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status); throw e; }
    const q = new URLSearchParams();
    for (const k of ["q", "brand", "kind", "page", "per"]) { const v = url.searchParams.get(k); if (v) q.set(k, v.slice(0, 200)); }
    pcPath = `/${sub}${q.size ? `?${q}` : ""}`;
  } else return json({ error: "Not found" }, 404);

  const exp = String(Math.floor(now / 1000));
  let res;
  try {
    res = await fetchImpl(new URL(pcPath, origin).toString(), { headers: { "x-drive-exp": exp, "x-drive-sig": driveSig(key, exp, pcPath) }, signal: AbortSignal.timeout(25_000) });
  } catch { return json(OFFLINE, 503); }
  // The tunnel answers 502/530 (and similar) when the PC or its server is off.
  if (res.status >= 502 || res.status === 500 && !/json/.test(res.headers.get("content-type") ?? "")) return json(OFFLINE, 503);
  if (!res.ok) return json(await res.json().catch(() => ({ error: "Not found" })), res.status === 401 ? 502 : res.status);
  if (m) {
    const headers = { ...BASE_HEADERS, "content-type": res.headers.get("content-type") ?? "application/octet-stream", "cache-control": m[1] === "thumb" ? "private, max-age=3600" : "private, no-store" };
    for (const h of ["content-length", "content-disposition"]) if (res.headers.get(h)) headers[h] = res.headers.get(h);
    if (m[1] === "file") headers["content-disposition"] ??= "attachment";
    return new Response(res.body, { status: 200, headers });
  }
  const body = await res.json();
  if (sub === "search") for (const i of body.items ?? []) {
    if (!ID_RE.test(i.id)) continue;
    i.thumbUrl = i.thumb ? signedLink(key, "thumb", i.id, now) : null;
    i.fileUrl = i.src === "kittl" ? null : signedLink(key, "file", i.id, now);
  }
  return json(body);
}
