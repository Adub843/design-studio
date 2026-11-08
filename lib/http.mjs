// Small helpers shared by the EPIX3D site API (accounts, projects, orders, webhook).
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export const API_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
export function json(body, status = 200, extra = {}) {
  const res = new Response(JSON.stringify(body), { status, headers: API_HEADERS });
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) for (const x of v) res.headers.append(k, x); else res.headers.set(k, v);
  }
  return res;
}
export const errorResponse = (e) => json({ error: e.message, code: e.code }, e.status);

// Reads at most `max` bytes of the body, failing as soon as it's bigger.
export async function readBody(req, max) {
  if (Number(req.headers.get("content-length")) > max) throw new ApiError(413, "too_big", "That's too big to save.");
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* already closed */ } throw new ApiError(413, "too_big", "That's too big to save."); }
    parts.push(value);
  }
  const out = new Uint8Array(size); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}
export async function readJson(req, max = 64 * 1024) {
  const bytes = await readBody(req, max);
  try { const v = JSON.parse(new TextDecoder().decode(bytes)); if (v && typeof v === "object") return v; } catch { /* fall through */ }
  throw new ApiError(400, "bad_json", "The request wasn't readable.");
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    const k = part.slice(0, i).trim(); if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

// Forms on other sites can't change anything here: writes must come from this site's own pages.
// (The session cookie is SameSite=Lax too; this is the second lock.)
export function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers and server-to-server tests
  return origin === new URL(req.url).origin;
}

export const clientIp = (req) => req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomId = (n = 18) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Compares two strings without leaking where they differ.
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
// Drops control characters and caps the length.
export const cleanText = (v, max) => [...String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim()].slice(0, max).join("");
