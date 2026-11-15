// Design files: the second paid plan on epix3d.com (Aaron, 15 Nov 2026), $15 a month on its own.
// Members browse and download the Elevated Designs art on the E: drive: SVG, PNG and other pictures and
// DTF prints, kept up to date as Aaron adds files (the PC's index, drive-server/). The files stay on the
// PC and come through the Cloudflare Tunnel (DRIVE_ORIGIN), so the library is open while the PC is on.
//
//   GET /api/designs/search?q=&kind=&page=   Design files members: one page of art with preview links
//   GET /api/designs/file/:id                Design files members: counts the download, then sends them on
//                                            to a one-hour signed download link
//
// Only finished art is listed (kinds svg, image, dtf): no source files (AI, EPS, PSD...), no logos, no
// Charleston3D files and no Kittl items (those can't be downloaded from the PC).
import { createHmac } from "node:crypto";
import { ApiError, json, safeEqual } from "./http.mjs";
import { requireUser, hasDesigns } from "./accounts.mjs";
import { driveFetch, signedLink, OFFLINE } from "./drive.mjs";

export const KINDS = ["svg", "image", "dtf"];
export const DOWNLOADS_PER_DAY = 60;
export const PER_PAGE = 48;
const ID_RE = /^[0-9a-f]{20}$/;
// Download links carry a tag for that file id, so a member can only download files the library showed them.
const fileTag = (key, id) => createHmac("sha256", `designs:${key}`).update(id).digest("base64url").slice(0, 22);

async function requireDesigns(req, kv, now) {
  const user = await requireUser(req, kv);
  if (!hasDesigns(user, now)) throw new ApiError(402, "designs_required", "The design library is part of the Design files plan.");
  return user;
}

export async function handleDesigns(req, kv, { env, fetchImpl = fetch, now = Date.now() }) {
  if (req.method !== "GET") throw new ApiError(405, "method", "Not allowed.");
  const url = new URL(req.url);
  const sub = url.pathname.replace(/^\/api\/designs\/?/, "");
  const user = await requireDesigns(req, kv, now);
  const key = env("CONSOLE_KEY") ?? "";
  if (!env("DRIVE_ORIGIN") || !key) throw new ApiError(503, "drive_not_set_up", "The design library isn't connected yet.");

  if (sub === "search") {
    const kind = url.searchParams.get("kind");
    const kinds = KINDS.includes(kind) ? [kind] : KINDS;
    const q = (url.searchParams.get("q") ?? "").slice(0, 100);
    const page = Math.max(0, Math.min(500, Number(url.searchParams.get("page")) || 0));
    // "All" asks the PC for every Elevated Designs file and keeps the finished art (source files sort last).
    const params = new URLSearchParams({ brand: "ed", per: String(PER_PAGE), page: String(page) });
    if (q) params.set("q", q);
    if (kinds.length === 1) params.set("kind", kinds[0]);
    const res = await driveFetch(env, `/search?${params}`, fetchImpl);
    if (!res) return json(OFFLINE, 503);
    if (!res.ok) return json({ error: "The design library couldn't be searched." }, 502);
    const body = await res.json();
    const items = (body.items ?? [])
      .filter((i) => ID_RE.test(i.id) && i.src !== "kittl" && i.brand !== "c3d" && KINDS.includes(i.kind))
      .map((i) => ({ id: i.id, name: i.name, kind: i.kind, ext: i.ext, size: i.size, thumbUrl: i.thumb ? signedLink(key, "thumb", i.id, now) : null, downloadUrl: `/api/designs/file/${i.id}?t=${fileTag(key, i.id)}` }));
    return json({ items, page, per: PER_PAGE, total: kinds.length === 1 ? body.total ?? items.length : null, more: (body.items ?? []).length === PER_PAGE });
  }

  const m = sub.match(/^file\/([^/]+)$/);
  if (m) {
    if (!ID_RE.test(m[1]) || !safeEqual(url.searchParams.get("t") ?? "", fileTag(key, m[1]))) throw new ApiError(404, "not_found", "Not found");
    // A daily cap per member keeps the PC's connection and the shared KV write budget safe.
    const dayKey = `rl:designdl:${user.id}`;
    const n = Number((await kv.get(dayKey, "json"))?.n || 0);
    if (n >= DOWNLOADS_PER_DAY) throw new ApiError(429, "rate_limited", `That's ${DOWNLOADS_PER_DAY} downloads today, the daily limit. Try again tomorrow.`);
    await kv.put(dayKey, JSON.stringify({ n: n + 1 }), { expirationTtl: 86400 });
    return new Response(null, { status: 302, headers: { location: signedLink(key, "file", m[1], now), "cache-control": "no-store" } });
  }
  throw new ApiError(404, "not_found", "Not found");
}
