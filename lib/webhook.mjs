// Turning on the paid plans: 3D makers ("EPIX3D Platinum") and Design files, both on the Charleston3D store.
//
// POST /api/shopify/webhook  Shopify calls this (topic orders/paid). The body is checked against
//   x-shopify-hmac-sha256 with the plan's store secret (SHOPIFY_WEBHOOK_SECRET; set in Cloudflare by
//   Aaron, never in a file). Each plan's line in the order turns on that plan. A paid order holding the Platinum variant gives the account Platinum until
//   35 days after the payment date. Each monthly renewal of a Shopify subscription makes a new paid
//   order, so the same topic covers renewals. The account is the email in the line's
//   "_EPIX3D account" property (set by the Go Platinum button), else the order's email. If no account has
//   that email yet, the membership waits for it and is applied when the account is made.
//   Subscription billing topics are accepted and acknowledged; they carry no email, so the paid order does the work.
//
// GET/POST /api/admin/platinum  set or clear a plan by hand, with the console key (x-console-key).
//   GET ?email=  -> status. POST { email, days } or { email, until } or { email, clear: true }, plus
//   plan: "makers" (the default) or "designs".
import { ApiError, json, readBody, readJson } from "./http.mjs";
import { requireKey, HttpError } from "./auth.mjs";
import { normEmail, validEmail, getUser, grantPlan, setPlan, publicUser } from "./accounts.mjs";
import { PLATINUM_PRODUCT_ID, PLATINUM_VARIANT_ID, PLATINUM_DAYS, ACCOUNT_PROPERTY, SHOP_DOMAIN, PLANS } from "./shop-config.mjs";

const DAY = 86_400_000;
export const MAX_WEBHOOK = 1024 * 1024;

export async function shopifyHmac(secret, bodyBytes) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, bodyBytes);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function hmacOk(secret, bodyBytes, given) {
  if (!given) return false;
  const want = await shopifyHmac(secret, bodyBytes);
  // Compare digests of both, so the time taken says nothing about the expected value.
  const d = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([d(want), d(given)]);
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const propOf = (li, name) => (Array.isArray(li?.properties) ? li.properties : []).find((p) => p?.name === name)?.value;
export function platinumLines(order, ids = { variant: PLATINUM_VARIANT_ID, product: PLATINUM_PRODUCT_ID }) {
  if (ids.variant == null && ids.product == null) return [];
  return (order?.line_items ?? []).filter((li) => (ids.variant != null && String(li.variant_id) === String(ids.variant)) || (ids.product != null && String(li.product_id) === String(ids.product)));
}

export async function handleWebhook(req, kv, env, { ids, plans = PLANS, now = Date.now() } = {}) {
  if (req.method !== "POST") throw new ApiError(405, "method", "Not allowed.");
  // Which store is calling decides the secret and which plans it can turn on. A missing header means
  // the Charleston3D store (older test calls).
  const shop = req.headers.get("x-shopify-shop-domain") || SHOP_DOMAIN;
  const mine = Object.values(plans).filter((p) => p.shop === shop);
  if (!mine.length) throw new ApiError(401, "wrong_shop", "Wrong store.");
  const secret = env(mine[0].secret);
  if (!secret) throw new ApiError(503, "not_set_up", "The webhook secret isn't set.");
  const body = await readBody(req, MAX_WEBHOOK);
  if (!(await hmacOk(secret, body, req.headers.get("x-shopify-hmac-sha256")))) throw new ApiError(401, "bad_signature", "Bad signature.");
  const topic = req.headers.get("x-shopify-topic") ?? "";
  let payload; try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { throw new ApiError(400, "bad_json", "Bad body."); }

  if (topic !== "orders/paid") return json({ ok: true, ignored: topic || "no topic" });
  const paid = Date.parse(payload.processed_at || payload.created_at || "") || now;
  const done = {};
  for (const plan of mine) {
    const lines = platinumLines(payload, plan === plans.makers && ids ? ids : { variant: plan.variant, product: plan.product });
    if (!lines.length) continue;
    const email = normEmail(lines.map((li) => propOf(li, ACCOUNT_PROPERTY)).find(Boolean) || payload.email || payload.contact_email || payload.customer?.email);
    if (!validEmail(email)) { done[plan.field] = "no email"; continue; }
    const months = lines.reduce((n, li) => n + Math.max(1, Number(li.quantity) || 1), 0);
    const until = paid + PLATINUM_DAYS * DAY * months;
    const r = await grantPlan(kv, email, until, `order ${payload.id ?? "?"}`, plan);
    done[plan.field] = { account: r.found ? "updated" : "pending", until: new Date(until).toISOString() };
  }
  const keys = Object.keys(done);
  if (!keys.length) return json({ ok: true, ignored: "no platinum line" });
  if (keys.length === 1 && typeof done[keys[0]] === "string") return json({ ok: true, ignored: done[keys[0]] });
  const first = Object.values(done).find((v) => typeof v === "object");
  return json({ ok: true, ...first, plans: done });
}

export async function handleAdminPlatinum(req, kv, env, { now = Date.now() } = {}) {
  try { requireKey({ header: (k) => req.headers.get(k) }, env, "Admin changes"); }
  catch (e) { if (e instanceof HttpError) throw new ApiError(e.status, e.code, e.message); throw e; }
  if (req.method === "GET") {
    const email = normEmail(new URL(req.url).searchParams.get("email"));
    const user = await getUser(kv, email);
    if (!user) throw new ApiError(404, "no_account", "No account has that email.");
    return json({ user: publicUser(user, now) });
  }
  if (req.method !== "POST") throw new ApiError(405, "method", "Not allowed.");
  const body = await readJson(req);
  const email = normEmail(body.email);
  if (!validEmail(email)) throw new ApiError(400, "bad_email", "Give the account's email.");
  let until;
  if (body.clear) until = 0;
  else if (body.until) { until = Date.parse(body.until); if (!until) throw new ApiError(400, "bad_date", "until must be a date."); }
  else { const days = Number(body.days ?? PLATINUM_DAYS); if (!(days > 0 && days <= 3660)) throw new ApiError(400, "bad_days", "days must be 1 to 3660."); until = now + days * DAY; }
  const plan = PLANS[body.plan ?? "makers"];
  if (!plan) throw new ApiError(400, "bad_plan", "plan must be makers or designs.");
  const user = await setPlan(kv, email, until, body.clear ? "cleared by admin" : "set by admin", plan);
  if (!user) throw new ApiError(404, "no_account", "No account has that email.");
  return json({ user: publicUser(user, now) });
}
