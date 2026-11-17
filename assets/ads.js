// Ad measurement for EPIX3D: Meta (Facebook and Instagram, the account Holo Ads boosts through) and TikTok.
// Nothing loads unless Aaron has set a pixel id (wrangler.toml vars META_PIXEL_ID / TIKTOK_PIXEL_ID, served
// by /api/config) AND the visitor presses Allow on the notice. "No thanks" is remembered and loads nothing.
// Campaign tags (utm_*, fbclid, ttclid) from ads and Holo posts are kept for the visit so orders can be
// credited to them (window.EPIX_ADS.source()).
// Events: PageView on every page, ViewContent on a maker, InitiateCheckout on Place order / Join, sent with
// window.EPIX_ADS.track(name, data) by the bridge and site.js.
(() => {
  if (window.EPIX_ADS) return;
  const KEY = "epx-ads-consent";
  const SRC = "epx-ads-source";
  const get = (k, store = localStorage) => { try { return store.getItem(k); } catch { return null; } };
  const set = (k, v, store = localStorage) => { try { store.setItem(k, v); } catch { /* private mode */ } };
  const params = new URLSearchParams(location.search);
  const tags = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid", "ttclid"]) { const v = params.get(k); if (v) tags[k] = v.slice(0, 120); }
  if (Object.keys(tags).length) set(SRC, JSON.stringify(tags), sessionStorage);
  let ids = null, on = false;
  const queue = [];
  const META = { ViewContent: "ViewContent", InitiateCheckout: "InitiateCheckout", PageView: "PageView", Subscribe: "Subscribe" };
  const TT = { ViewContent: "ViewContent", InitiateCheckout: "InitiateCheckout", Subscribe: "Subscribe" };

  function loadMeta(id) {
    /* Meta's standard pixel loader */
    const f = window; if (f.fbq) return;
    const n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    const s = document.createElement("script"); s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js"; document.head.append(s);
    f.fbq("init", id); f.fbq("track", "PageView");
  }
  function loadTikTok(id) {
    /* TikTok's standard pixel loader */
    const w = window; if (w.ttq) return;
    const ttq = w.ttq = [];
    ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie"];
    ttq.setAndDefer = (t, e) => { t[e] = function () { t.push([e].concat([].slice.call(arguments, 0))); }; };
    for (const m of ttq.methods) ttq.setAndDefer(ttq, m);
    ttq.load = (e) => { const s = document.createElement("script"); s.async = true; s.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(e)}&lib=ttq`; document.head.append(s); };
    ttq.load(id); ttq.page();
  }
  function send(name, data) {
    if (!on) { queue.push([name, data]); return; }
    if (ids.meta && window.fbq && META[name] && name !== "PageView") window.fbq("track", META[name], data || {});
    if (ids.tiktok && window.ttq && TT[name]) window.ttq.track(TT[name], data || {});
  }
  function enable() {
    if (on || !ids) return;
    on = true;
    if (ids.meta) loadMeta(ids.meta);
    if (ids.tiktok) loadTikTok(ids.tiktok);
    for (const [n, d] of queue.splice(0)) send(n, d);
  }
  function notice() {
    const bar = document.createElement("div");
    bar.className = "epx-consent"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Cookie notice");
    bar.innerHTML = '<p>We use cookies from Meta and TikTok to measure our ads. Allow them? <a href="/privacy/">Privacy</a></p><div><button type="button" data-no>No thanks</button><button type="button" data-yes>Allow</button></div>';
    bar.querySelector("[data-no]").addEventListener("click", () => { set(KEY, "no"); bar.remove(); });
    bar.querySelector("[data-yes]").addEventListener("click", () => { set(KEY, "yes"); bar.remove(); enable(); });
    document.body.append(bar);
  }
  const style = document.createElement("style");
  style.textContent = '.epx-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483300;max-width:640px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;padding:14px 16px;background:#15171c;color:#fff;border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.3);font:500 14.5px/1.45 "Inter","Segoe UI",system-ui,sans-serif}.epx-consent p{margin:0;flex:1 1 260px}.epx-consent a{color:#fff}.epx-consent div{display:flex;gap:8px}.epx-consent button{height:38px;padding:0 16px;border-radius:8px;border:1px solid #4a4e58;background:transparent;color:#fff;font:600 14px/1 inherit;font-family:inherit;cursor:pointer}.epx-consent [data-yes]{background:#fff;color:#15171c;border-color:#fff}';
  document.head.append(style);

  window.EPIX_ADS = {
    track: send,
    source: () => { try { return JSON.parse(get(SRC, sessionStorage) || "null"); } catch { return null; } },
  };
  const valid = (v, re) => (typeof v === "string" && re.test(v) ? v : "");
  fetch("/api/config", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((cfg) => {
    ids = { meta: valid(cfg?.ads?.meta, /^\d{6,20}$/), tiktok: valid(cfg?.ads?.tiktok, /^[A-Z0-9]{8,30}$/) };
    if (!ids.meta && !ids.tiktok) return;
    const c = get(KEY);
    if (c === "yes") enable(); else if (c !== "no") notice();
  }).catch(() => { /* no ads config: nothing loads */ });
})();
