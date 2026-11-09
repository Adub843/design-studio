// EPIX3D accounts: email + password, kept in the ACCOUNTS Workers KV namespace.
//
// Keys in ACCOUNTS:
//   user:<email>              { id, email, salt, hash, iter, ver, createdAt, platinumUntil, platinumSource }
//   session:<sha256(token)>   { email, ver, exp }   (expires by itself after 30 days)
//   rl:<kind>:<who>           { n }                 (rate limit counters, expire by themselves)
//   pending-platinum:<email>  { until, order }      (a paid membership for an email with no account yet)
//
// Passwords: PBKDF2-SHA256 with a random 16-byte salt per user, 100,000 rounds (the most Cloudflare
// Workers allow). Passwords are never logged or returned. Sign-in and sign-up answer with generic
// messages so they don't tell anyone which emails have accounts.
import { ApiError, json, readJson, cookies, clientIp, randomId, sha256Hex, safeEqual } from "./http.mjs";

export const PBKDF2_ITERATIONS = 100_000;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;
export const SESSION_DAYS = 30;
export const COOKIE = "epx_session";
export const SIGNIN_LIMIT = { perEmail: 5, perIp: 20, windowSec: 15 * 60 };
export const SIGNUP_LIMIT = { perIp: 10, windowSec: 60 * 60 };
const DAY = 86_400_000;

export const normEmail = (e) => String(e ?? "").trim().toLowerCase();
export const validEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function hashPassword(password, saltB64, iter = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(saltB64), iterations: iter }, key, 256);
  return toB64(bits);
}
const newSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));
// Used when the email has no account, so a miss takes as long as a wrong password.
const DUMMY_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

export const userKey = (email) => `user:${email}`;
export async function getUser(kv, email) { return email ? kv.get(userKey(email), "json") : null; }
export async function putUser(kv, user) { await kv.put(userKey(user.email), JSON.stringify(user)); }

export const isPlatinum = (user, now = Date.now()) => !!user && Number(user.platinumUntil || 0) > now;
export const publicUser = (user, now = Date.now()) => user && ({
  email: user.email,
  createdAt: new Date(user.createdAt).toISOString(),
  platinum: isPlatinum(user, now),
  platinumUntil: user.platinumUntil ? new Date(user.platinumUntil).toISOString() : null,
});

/* ---------- rate limits ---------- */
async function hits(kv, key) { return Number((await kv.get(key, "json"))?.n || 0); }
async function hit(kv, key, windowSec) { const n = (await hits(kv, key)) + 1; await kv.put(key, JSON.stringify({ n }), { expirationTtl: Math.max(60, windowSec) }); return n; }

/* ---------- sessions ---------- */
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export async function startSession(kv, user, now = Date.now()) {
  const token = randomId(32);
  const exp = now + SESSION_DAYS * DAY;
  await kv.put(`session:${await sha256Hex(token)}`, JSON.stringify({ email: user.email, ver: user.ver || 0, exp }), { expirationTtl: SESSION_DAYS * 86400 });
  return sessionCookie(token, SESSION_DAYS * 86400);
}
const clearCookie = () => sessionCookie("", 0);

// The signed-in user for this request, or null. Sessions end at their date, or when the password changes.
export async function currentUser(req, kv, now = Date.now()) {
  const token = cookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const s = await kv.get(`session:${await sha256Hex(token)}`, "json");
  if (!s || s.exp < now) return null;
  const user = await getUser(kv, s.email);
  if (!user || (user.ver || 0) !== s.ver) return null;
  return user;
}
export async function requireUser(req, kv) {
  const user = await currentUser(req, kv);
  if (!user) throw new ApiError(401, "signed_out", "Sign in first.");
  return user;
}

function checkPassword(pw) {
  if (typeof pw !== "string" || [...pw].length < MIN_PASSWORD) throw new ApiError(400, "weak_password", `Use a password of at least ${MIN_PASSWORD} characters.`);
  if (pw.length > MAX_PASSWORD) throw new ApiError(400, "weak_password", `Use a password of at most ${MAX_PASSWORD} characters.`);
}

/* ---------- handlers: /api/auth/* and /api/me ---------- */
export async function handleAuth(req, kv, { now = Date.now() } = {}) {
  const { pathname } = new URL(req.url);
  const action = pathname.slice("/api/auth/".length);

  if (pathname === "/api/me") {
    if (req.method !== "GET") throw new ApiError(405, "method", "Not allowed.");
    return json({ user: publicUser(await currentUser(req, kv, now), now) });
  }
  if (req.method !== "POST") throw new ApiError(405, "method", "Not allowed.");

  if (action === "signup") {
    const ip = clientIp(req);
    const ipKey = `rl:signup:${ip}`;
    if ((await hits(kv, ipKey)) >= SIGNUP_LIMIT.perIp) throw new ApiError(429, "rate_limited", "Too many tries. Wait a while and try again.");
    const body = await readJson(req);
    const email = normEmail(body.email);
    if (!validEmail(email)) throw new ApiError(400, "bad_email", "Enter a real email address.");
    checkPassword(body.password);
    await hit(kv, ipKey, SIGNUP_LIMIT.windowSec);
    if (await getUser(kv, email)) throw new ApiError(409, "signup_failed", "We couldn't create that account. If you already have one, sign in instead.");
    const salt = newSalt();
    const user = { id: randomId(12), email, salt, hash: await hashPassword(body.password, salt), iter: PBKDF2_ITERATIONS, ver: 0, createdAt: now, platinumUntil: 0 };
    // A membership paid for before the account existed.
    const pending = await kv.get(`pending-platinum:${email}`, "json");
    if (pending?.until > now) { user.platinumUntil = pending.until; user.platinumSource = pending.order ? `order ${pending.order}` : "shopify"; }
    if (pending) await kv.delete(`pending-platinum:${email}`);
    await putUser(kv, user);
    return json({ user: publicUser(user, now) }, 201, { "set-cookie": await startSession(kv, user, now) });
  }

  if (action === "signin") {
    const body = await readJson(req);
    const email = normEmail(body.email);
    const emailKey = `rl:signin:${await sha256Hex(email)}`, ipKey = `rl:signin-ip:${clientIp(req)}`;
    if ((await hits(kv, emailKey)) >= SIGNIN_LIMIT.perEmail || (await hits(kv, ipKey)) >= SIGNIN_LIMIT.perIp)
      throw new ApiError(429, "rate_limited", "Too many tries. Wait 15 minutes and try again.");
    const pw = typeof body.password === "string" ? body.password.slice(0, MAX_PASSWORD) : "";
    const user = validEmail(email) ? await getUser(kv, email) : null;
    const hash = await hashPassword(pw, user?.salt ?? DUMMY_SALT, user?.iter ?? PBKDF2_ITERATIONS);
    if (!user || !pw || !safeEqual(hash, user.hash)) {
      await hit(kv, emailKey, SIGNIN_LIMIT.windowSec); await hit(kv, ipKey, SIGNIN_LIMIT.windowSec);
      throw new ApiError(401, "signin_failed", "That email and password don't match.");
    }
    await kv.delete(emailKey);
    return json({ user: publicUser(user, now) }, 200, { "set-cookie": await startSession(kv, user, now) });
  }

  if (action === "signout") {
    const token = cookies(req)[COOKIE];
    if (token && token.length <= 100) await kv.delete(`session:${await sha256Hex(token)}`);
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }

  if (action === "password") {
    const user = await requireUser(req, kv);
    const body = await readJson(req);
    const emailKey = `rl:signin:${await sha256Hex(user.email)}`;
    if ((await hits(kv, emailKey)) >= SIGNIN_LIMIT.perEmail) throw new ApiError(429, "rate_limited", "Too many tries. Wait 15 minutes and try again.");
    const cur = typeof body.current === "string" ? body.current.slice(0, MAX_PASSWORD) : "";
    if (!safeEqual(await hashPassword(cur, user.salt, user.iter), user.hash)) {
      await hit(kv, emailKey, SIGNIN_LIMIT.windowSec);
      throw new ApiError(401, "signin_failed", "Your current password isn't right.");
    }
    checkPassword(body.next);
    user.salt = newSalt(); user.hash = await hashPassword(body.next, user.salt); user.iter = PBKDF2_ITERATIONS;
    user.ver = (user.ver || 0) + 1; // signs out every other device
    await putUser(kv, user);
    return json({ ok: true }, 200, { "set-cookie": await startSession(kv, user, now) });
  }

  throw new ApiError(404, "not_found", "Not found");
}

/* ---------- Platinum ---------- */
// Extends the membership to `until` (never shortens it). Used by the Shopify webhook.
export async function grantPlatinum(kv, email, until, source) {
  const user = await getUser(kv, email);
  if (!user) {
    const pending = await kv.get(`pending-platinum:${email}`, "json");
    if (!pending || pending.until < until) await kv.put(`pending-platinum:${email}`, JSON.stringify({ until, order: source }), { expirationTtl: Math.max(60, Math.ceil((until - Date.now()) / 1000) + 86400) });
    return { found: false };
  }
  if (Number(user.platinumUntil || 0) < until) { user.platinumUntil = until; user.platinumSource = source; await putUser(kv, user); }
  return { found: true, user };
}
// Sets it to exactly `until` (0 clears it). Used by the admin endpoint.
export async function setPlatinum(kv, email, until, source) {
  const user = await getUser(kv, email);
  if (!user) return null;
  user.platinumUntil = until; user.platinumSource = source;
  await putUser(kv, user);
  return user;
}
