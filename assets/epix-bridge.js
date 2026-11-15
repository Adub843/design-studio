// EPIX3D bridge: links each maker page (makers/<maker>/) to the site.
//
// A maker sets window.EPIX_MAKER before this file loads:
//   { id, title(), mode(), name(), hasContent(), getState(), setState(data), thumb(),
//     buildPrintFile() -> { blob, name, details, product?, preview? }, downloadSelector, orderNote?() }
// The bridge then adds the EPIX3D bar (or wires [data-epix-*] buttons already on the page) and handles:
//   Save to my projects   POST/PUT /api/projects (signed in; otherwise it keeps the design and asks them to sign in)
//   Opening a project     ?project=<id> loads it from /api/projects/<id>
//   Live price            the bar shows the print price as they design (lib/print-price.mjs, Aaron's 3D Print
//                         Calculator), worked out from the maker's own print file
//   Place order           builds the maker's print file, POST /api/orders keeps it on epix3d.com and works the
//                         price out again from the file, then the page posts to the Charleston3D cart with
//                         the matching "EPIX3D Custom Print" price line (or the $0 quote line it returns)
//   Export                Platinum members get an Export button and the maker's own download buttons (checked
//                         with /api/exports/check); everyone else gets Place order, and the maker's download
//                         buttons are hidden
(() => {
  const M = window.EPIX_MAKER;
  if (!M) return;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PENDING = `epx-pending:${M.id}`;
  const params = new URLSearchParams(location.search);
  let me;            // undefined while loading, null when signed out
  let canDownload = false;
  let projectId = params.get("project");
  let busy = false;
  let cfg = {};
  let quote = null;  // the last live price: { total, grams, hours, colours, size }

  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true" width="26" height="26"><rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#15171c"/><path d="M16 7.6 23.6 11.8v8.4L16 24.4l-7.6-4.2v-8.4z" fill="#ffffff"/><path d="M16 16v8.4l7.6-4.2v-8.4z" fill="#6d28d9"/><path d="M16 16 8.4 11.8v8.4l7.6 4.2z" fill="#c4c8cf"/></svg>';

  /* ---------- API ---------- */
  async function api(path, opts = {}) {
    const init = { credentials: "same-origin", ...opts, headers: { accept: "application/json", ...(opts.headers || {}) } };
    if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers["content-type"] = "application/json"; delete init.json; }
    const r = await fetch(path, init);
    let body = null; try { body = await r.json(); } catch { body = null; }
    if (!r.ok) { const e = new Error(body?.error || `Something went wrong (${r.status}).`); e.status = r.status; e.code = body?.code; throw e; }
    return body;
  }

  /* ---------- bar ---------- */
  const title = () => (M.title ? M.title() : M.id);
  function renderBar() {
    const slot = $("#epix-bar");
    if (!slot) return;
    slot.className = "epx-bar";
    slot.setAttribute("role", "banner");
    slot.innerHTML = `<a class="epx-logo" href="/" aria-label="EPIX3D home">${LOGO}<span>EPIX3D</span></a>
      <span data-epix-switch></span>
      <span class="epx-title" data-epix-title>${esc(title())}</span>
      <span class="epx-status" role="status" aria-live="polite"></span>
      <span class="epx-price" data-epix-price hidden></span>
      <button type="button" class="epx-btn" data-epix-save>Save</button>
      <a class="epx-plat" data-epix-plat href="/pricing/#platinum" hidden>Export with Platinum</a>
      <button type="button" class="epx-btn" data-epix-export hidden><span class="epx-long">Export</span><span class="epx-short">Export</span></button>
      <button type="button" class="epx-btn epx-primary" data-epix-order><span class="epx-long">Place order</span><span class="epx-short">Order</span></button>
      <a class="epx-acct" data-epix-account href="/account/">Sign in</a>`;
  }
  function renderAccount() {
    for (const a of document.querySelectorAll("[data-epix-account]")) {
      if (me) { a.href = "/projects/"; a.innerHTML = `${me.platinum ? '<span class="epx-pill">Platinum</span>' : ""}<span>My projects</span>`; a.title = me.email; }
      else { a.href = `/account/?next=${encodeURIComponent(location.pathname + location.search)}`; a.textContent = "Sign in"; a.removeAttribute("title"); }
    }
  }
  const say = (t) => { for (const s of document.querySelectorAll(".epx-status")) s.textContent = t || ""; };
  let toastT = 0;
  function toast(text) {
    let t = $("#epx-toast");
    if (!t) { t = document.createElement("div"); t.id = "epx-toast"; t.className = "epx-toast"; t.setAttribute("role", "status"); document.body.append(t); }
    t.textContent = text; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 5000);
  }

  /* ---------- dialogs ---------- */
  function dialog({ title: head, body, actions }) {
    const old = $("#epx-dialog"); if (old) old.remove();
    const back = document.activeElement;
    const wrap = document.createElement("div");
    wrap.id = "epx-dialog"; wrap.className = "epx-modal";
    wrap.innerHTML = `<div class="epx-dlg" role="dialog" aria-modal="true" aria-labelledby="epx-dlg-t"><h2 id="epx-dlg-t">${esc(head)}</h2><div class="epx-dlg-b">${body}</div><div class="epx-dlg-f"></div></div>`;
    const foot = $(".epx-dlg-f", wrap);
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey, true); if (back && back.focus) try { back.focus(); } catch { /* gone */ } };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    for (const a of actions) {
      const el = document.createElement(a.href ? "a" : "button");
      el.className = "epx-btn" + (a.primary ? " epx-primary" : "");
      el.textContent = a.label;
      if (a.href) el.href = a.href; else el.type = "button";
      el.addEventListener("click", (e) => { if (a.onClick) { e.preventDefault(); a.onClick(); } if (a.close !== false) close(); });
      foot.append(el);
    }
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.append(wrap);
    (foot.querySelector(".epx-primary") || foot.firstElementChild)?.focus();
    return { close };
  }
  const nextUrl = () => `${location.pathname}${location.search}`;
  async function stash(action) {
    try { sessionStorage.setItem(PENDING, JSON.stringify({ action, data: await M.getState(), name: M.name(), mode: M.mode ? M.mode() : null, projectId })); } catch { /* too big for this browser: they keep the maker's own draft */ }
  }
  function askSignIn(action) {
    const what = action === "order" ? "order a print" : "save to My projects";
    dialog({
      title: action === "order" ? "Sign in to order" : "Sign in to save",
      body: `<p>Make a free account to ${what}. Your design stays right here while you sign in.</p>`,
      actions: [
        { label: "Not now" },
        { label: "Create an account", href: `/account/?mode=signup&next=${encodeURIComponent(nextUrl())}`, onClick: () => go("signup", action) },
        { label: "Sign in", primary: true, href: `/account/?next=${encodeURIComponent(nextUrl())}`, onClick: () => go("signin", action) },
      ],
    });
  }
  async function go(mode, action) {
    await stash(action);
    location.href = `/account/?${mode === "signup" ? "mode=signup&" : ""}next=${encodeURIComponent(nextUrl())}`;
  }
  function askPlatinum() {
    dialog({
      title: "Export comes with Platinum",
      body: `<p>Free accounts can design, save and order prints made in Charleston, SC, priced as they design.</p><p><b>Platinum</b> is ${esc(cfg.platinum?.price || "$15 a month")} and adds Export: 3MF and STL files to print anywhere. Members can still order prints from us.</p>${me ? "" : '<p class="epx-muted">Already a member? Sign in first.</p>'}`,
      actions: [
        { label: "Not now" },
        ...(me ? [] : [{ label: "Sign in", href: `/account/?next=${encodeURIComponent(nextUrl())}`, onClick: () => go("signin", "download") }]),
        { label: "Place an order instead", onClick: () => setTimeout(order, 0) },
        { label: "See Platinum", primary: true, href: "/pricing/#platinum" },
      ],
    });
  }

  /* ---------- save / open ---------- */
  function setProjectInUrl(id) {
    const u = new URL(location.href);
    if (id) u.searchParams.set("project", id); else u.searchParams.delete("project");
    history.replaceState(history.state, "", u);
  }
  async function save() {
    if (busy) return;
    if (me === undefined) await loadMe();
    if (!me) return askSignIn("save");
    if (M.hasContent && !M.hasContent()) { toast("Add something to your design first."); return; }
    busy = true; say("Saving…");
    try {
      const body = { name: M.name(), mode: M.mode ? M.mode() : null, data: await M.getState(), thumb: await thumb() };
      let r;
      if (projectId) {
        try { r = await api(`/api/projects/${encodeURIComponent(projectId)}`, { method: "PUT", json: body }); }
        catch (e) { if (e.status !== 404) throw e; projectId = null; }
      }
      if (!projectId) r = await api("/api/projects", { method: "POST", json: { maker: M.id, ...body } });
      projectId = r.project.id; setProjectInUrl(projectId);
      say(""); toast("Saved to My projects.");
    } catch (e) {
      say(""); toast(e.status === 401 ? "You were signed out. Sign in and save again." : e.message);
      if (e.status === 401) { me = null; renderAccount(); }
    } finally { busy = false; }
  }
  async function thumb() {
    try { const t = M.thumb ? await M.thumb() : ""; return /^data:image\/(jpeg|png|webp);base64,/.test(t || "") && t.length < 290000 ? t : null; } catch { return null; }
  }
  async function openProject(id) {
    say("Opening your project…");
    try {
      const { project } = await api(`/api/projects/${encodeURIComponent(id)}`);
      if (project.maker !== M.id) { location.replace(`/makers/${project.maker}/?project=${encodeURIComponent(id)}`); return; }
      await M.setState(project.data, project);
      projectId = project.id; say(""); toast(`Opened "${project.name}".`);
    } catch (e) {
      say(""); projectId = null; setProjectInUrl(null);
      toast(e.status === 401 ? "Sign in to open your saved projects." : "That project couldn't be opened.");
    }
  }

  /* ---------- order a print ---------- */
  async function order() {
    if (busy) return;
    if (me === undefined) await loadMe();
    if (!me) return askSignIn("order");
    if (M.hasContent && !M.hasContent()) { toast("Add something to your design first."); return; }
    if (pricing() && !quote) await refreshPrice(true);
    const priced = pricing() && quote && quote.total <= PRICE_CAP;
    const note = (M.orderNote && M.orderNote()) || (priced
      ? "We print it in Charleston, SC, check it over and ship it to you."
      : "We print it in Charleston, SC. Your design goes to checkout as a free print request: we look it over and reply with a price within 1-2 business days. You pay nothing now.");
    const lines = priced ? `<dl class="epx-quote"><div><dt>Your print</dt><dd>${money(quote.total)}</dd></div><div><dt>Filament</dt><dd>about ${Math.round(quote.grams)} g${quote.colours > 1 ? `, ${quote.colours} colours` : ""}</dd></div><div><dt>Print time</dt><dd>about ${hm(quote.hours)}</dd></div>${quote.size && quote.size[0] ? `<div><dt>Size</dt><dd>${quote.size.map((n) => Math.round(n)).join(" x ")} mm</dd></div>` : ""}</dl><p class="epx-muted">Shipping and tax are added at checkout. The price is checked again from your print file.</p>` : "";
    dialog({
      title: "Place order",
      body: `<p>${esc(note)}</p>${lines}<p class="epx-muted">Checkout is on the Charleston3D store, where EPIX3D prints are sold.</p>`,
      actions: [{ label: "Cancel" }, { label: priced ? `Checkout, ${money(quote.total)}` : "Continue to checkout", primary: true, onClick: () => setTimeout(placeOrder, 0) }],
    });
  }
  async function placeOrder() {
    busy = true; say("Building the print file…");
    for (const b of document.querySelectorAll("[data-epix-order]")) b.disabled = true;
    try {
      await new Promise((r) => setTimeout(r, 30));
      const f = await M.buildPrintFile();
      say("Sending your design…");
      const fd = new FormData();
      fd.append("maker", M.id);
      if (M.mode && M.mode()) fd.append("mode", M.mode());
      fd.append("project", M.name());
      if (f.details) fd.append("details", f.details);
      if (f.product) fd.append("product", f.product);
      if (quote) fd.append("price", String(quote.total));
      fd.append("file", new File([f.blob], f.name, { type: f.blob.type || "application/octet-stream" }));
      if (f.preview) fd.append("preview", new File([f.preview], "preview" + (f.preview.type === "image/jpeg" ? ".jpg" : ".png"), { type: f.preview.type || "image/png" }));
      const src = window.EPIX_ADS?.source();
      if (src) fd.append("source", Object.entries(src).map(([k, v]) => `${k}=${v}`).join("&").slice(0, 300));
      const r = await api("/api/orders", { method: "POST", body: fd });
      window.EPIX_ADS?.track("InitiateCheckout", { content_name: title(), value: r.price || 0, currency: "USD" });
      say("Opening the cart…");
      const form = document.createElement("form");
      form.method = "post"; form.action = r.cart.action; form.target = "_top"; form.hidden = true;
      form.setAttribute("data-epix-cart", "");
      for (const [k, v] of Object.entries(r.cart.fields)) { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; form.append(i); }
      document.body.append(form);
      form.submit();
      setTimeout(() => { busy = false; say(""); form.remove(); for (const b of document.querySelectorAll("[data-epix-order]")) b.disabled = false; }, 15000);
    } catch (e) {
      console.error("order", e);
      busy = false; say("");
      for (const b of document.querySelectorAll("[data-epix-order]")) b.disabled = false;
      toast(e.status === 401 ? "You were signed out. Sign in and try again." : e.message && e.status ? e.message : "The print file couldn't be built. Check the print check, then try again.");
    }
  }

  /* ---------- live print price (Aaron's 3D Print Calculator, lib/print-price.mjs) ---------- */
  const PRICE_CAP = 500; // the top "EPIX3D Custom Print" step; above it the order is a $0 quote
  const pricing = () => !!cfg.printPricing && !M.noPrice;
  // A maker whose print build changes what's on screen (the Hype chain shows its export plates) sets
  // livePrice: false: its price is worked out when they press the price or Place order, not on every edit.
  const live = () => pricing() && M.livePrice !== false;
  const money = (n) => `$${Number(n).toFixed(0)}`;
  const hm = (h) => { const m = Math.max(1, Math.round(h * 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
  let priceMod = null, priceRun = null, priceDirty = false, priceT = 0;
  function paintPrice(state) {
    for (const el of document.querySelectorAll("[data-epix-price]")) {
      el.hidden = !pricing() || state === "off";
      el.classList.toggle("epx-busy", state === "busy");
      if (state === "busy") el.innerHTML = `<span>Print price</span><b>${quote ? money(quote.total) : "…"}</b>`;
      else if (quote && quote.total > PRICE_CAP) el.innerHTML = "<span>Print price</span><b>Quote</b>";
      else if (quote) el.innerHTML = `<span>Print price</span><b>${money(quote.total)}</b>`;
      else if (!live()) el.innerHTML = "<span>Print price</span><b>See price</b>";
      else el.innerHTML = "<span>Print price</span><b>from $18</b>";
      const tap = !live() && state !== "busy";
      el.classList.toggle("epx-tap", tap);
      if (tap) { el.setAttribute("role", "button"); el.tabIndex = 0; } else { el.removeAttribute("role"); el.removeAttribute("tabindex"); }
      el.title = quote ? `About ${Math.round(quote.grams)} g of filament and ${hm(quote.hours)} of print time. Shipping is added at checkout.` : "Prints start at $18. Shipping is added at checkout.";
    }
  }
  async function refreshPrice(now) {
    if (!pricing()) return paintPrice("off");
    if (M.hasContent && !M.hasContent()) { quote = null; return paintPrice("idle"); }
    if (priceRun) { priceDirty = true; return priceRun; }
    paintPrice("busy");
    priceRun = (async () => {
      try {
        priceMod = priceMod || await import("/assets/print-price.mjs");
        const f = await M.buildPrintFile();
        if (/\.zip$/i.test(f.name || "")) { quote = null; return; }
        const q = await priceMod.quoteFile(await f.blob.arrayBuffer(), f.name || "print.3mf");
        quote = { total: q.total, grams: q.grams, hours: q.hours, colours: q.colours, size: q.size };
      } catch (e) { console.warn("price", e?.message); quote = null; }
    })();
    await priceRun; priceRun = null; paintPrice("idle");
    if (priceDirty && !now) { priceDirty = false; schedulePrice(); }
  }
  function schedulePrice() {
    if (!live()) { if (quote) { quote = null; paintPrice("idle"); } return; }
    clearTimeout(priceT); priceT = setTimeout(() => { if (!busy) refreshPrice(); }, 1400);
  }
  for (const ev of ["input", "change", "pointerup", "keyup", "drop"]) {
    document.addEventListener(ev, (e) => { const t = e.target instanceof Element ? e.target : null; if (t && t.closest(".epx-bar, .epx-modal")) return; schedulePrice(); }, true);
  }

  /* ---------- Export (Platinum) and the gate on the maker's own downloads ---------- */
  function hideDownloads() {
    const sel = (M.downloadSelector || "[data-download]").split(",").map((x) => x.trim()).filter(Boolean);
    const st = document.createElement("style");
    st.textContent = `${sel.map((x) => `html:not([data-epix-downloads="on"]) ${x}`).join(",")}{display:none!important}`;
    document.head.append(st);
  }
  function paintExport() {
    const on = canDownload;
    for (const b of document.querySelectorAll("[data-epix-export]")) b.hidden = !on;
    for (const a of document.querySelectorAll("[data-epix-plat]")) a.hidden = on;
  }
  function exportNow() {
    if (!canDownload) return askPlatinum();
    const t = [...document.querySelectorAll(M.downloadSelector || "[data-download]")].find((el) => el.offsetParent !== null && !el.disabled) || document.querySelector(M.downloadSelector || "[data-download]");
    if (t) t.click(); else toast("Use the maker's download button to export your file.");
  }

  /* ---------- the Platinum gate on downloads ---------- */
  let passThrough = false;
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest(M.downloadSelector || "[data-download]") : null;
    if (!t) return;
    if (canDownload) {
      // The maker's own export waits for a price build that's still running, so the two never overlap.
      clearTimeout(priceT);
      if (priceRun && !passThrough) { e.preventDefault(); e.stopImmediatePropagation(); priceRun.then(() => { passThrough = true; try { t.click(); } finally { passThrough = false; } }); }
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    askPlatinum();
  }, true);
  async function checkDownloads() {
    canDownload = false;
    if (!me || !me.platinum) { document.documentElement.dataset.epixDownloads = "off"; paintExport(); return; }
    try { await api("/api/exports/check", { method: "POST" }); canDownload = true; } catch { canDownload = false; }
    document.documentElement.dataset.epixDownloads = canDownload ? "on" : "off";
    paintExport();
  }

  async function loadMe() {
    try { me = (await api("/api/me")).user; } catch { me = null; }
    renderAccount(); await checkDownloads();
    document.documentElement.dataset.epixUser = me ? (me.platinum ? "platinum" : "free") : "none";
  }


  /* ---------- maker switcher: every maker is one click away, on every maker ---------- */
  const GRID = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.5 3.5h5v5h-5zm8 0h5v5h-5zm-8 8h5v5h-5zm8 0h5v5h-5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  const CHEV = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let makers = null;
  const loadMakers = () => makers || (makers = fetch("/assets/makers.json", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  // The light box page holds four makers (?mode=), so its address alone doesn't say which one is open.
  const makerKey = (pathname, mode) => pathname + (pathname === "/makers/lightbox/" ? `?mode=${mode || "lightbox"}` : "");
  const isCurrent = (m) => { const u = new URL(m.href, location.origin); return makerKey(u.pathname, u.searchParams.get("mode")) === makerKey(location.pathname, (M.mode && M.mode()) || params.get("mode")); };
  function closeSwitch() {
    for (const w of document.querySelectorAll(".epx-switch-menu")) w.hidden = true;
    for (const b of document.querySelectorAll(".epx-switch")) b.setAttribute("aria-expanded", "false");
  }
  async function openSwitch(btn, menu) {
    const list = await loadMakers();
    menu.innerHTML = `<p class="epx-sw-h">Pick a maker</p><ul>${list.map((m) => `<li><a href="${esc(m.href)}" class="tone-${esc(m.tone)}"${isCurrent(m) ? ' aria-current="page"' : ""}><i aria-hidden="true"></i><b>${esc(m.name)}</b><small>${esc(m.blurb)}</small></a></li>`).join("")}</ul><a class="epx-sw-all" href="/makers/">See every maker with pictures</a>`;
    menu.hidden = false; btn.setAttribute("aria-expanded", "true");
    const cur = menu.querySelector('[aria-current="page"]') || menu.querySelector("a"); if (cur) cur.focus();
  }
  function renderSwitch() {
    for (const slot of document.querySelectorAll("[data-epix-switch]")) {
      if (slot.dataset.done) continue; slot.dataset.done = "1";
      slot.className = "epx-switch-wrap";
      slot.innerHTML = `<button type="button" class="epx-switch" aria-haspopup="true" aria-expanded="false" aria-label="All makers">${GRID}<span>All makers</span>${CHEV}</button><div class="epx-switch-menu" hidden></div>`;
      const btn = slot.querySelector("button"), menu = slot.querySelector(".epx-switch-menu");
      btn.addEventListener("click", (e) => { e.stopPropagation(); if (menu.hidden) { closeSwitch(); openSwitch(btn, menu); } else closeSwitch(); });
      menu.addEventListener("keydown", (e) => {
        const items = [...menu.querySelectorAll("a")]; const i = items.indexOf(document.activeElement);
        if (e.key === "ArrowDown") { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
        else if (e.key === "Escape") { e.preventDefault(); closeSwitch(); btn.focus(); }
      });
    }
    document.addEventListener("click", (e) => { if (!e.target.closest(".epx-switch-wrap")) closeSwitch(); });
  }

  /* ---------- start ---------- */
  async function start() {
    renderBar();
    renderSwitch();
    hideDownloads();
    paintExport();
    if (!document.querySelector('script[src="/assets/ads.js"]')) { const ad = document.createElement("script"); ad.src = "/assets/ads.js"; ad.defer = true; document.head.append(ad); }
    setTimeout(() => window.EPIX_ADS?.track("ViewContent", { content_name: title(), content_type: "product" }), 1500);
    try { cfg = await (await fetch("/api/config", { credentials: "same-origin" })).json() || {}; } catch { cfg = {}; }
    paintPrice("idle");
    for (const b of document.querySelectorAll("[data-epix-export]")) b.addEventListener("click", exportNow);
    for (const el of document.querySelectorAll("[data-epix-price]")) {
      const go = () => { if (!live() && pricing() && !priceRun) refreshPrice(true); };
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    }
    for (const b of document.querySelectorAll("[data-epix-save]")) b.addEventListener("click", save);
    for (const b of document.querySelectorAll("[data-epix-order]")) b.addEventListener("click", order);
    renderAccount();
    await loadMe();
    try { await M.ready; } catch { /* the maker shows its own error */ }
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING) || "null"); sessionStorage.removeItem(PENDING); } catch { pending = null; }
    if (projectId) await openProject(projectId);
    else if (pending?.data) {
      try {
        await M.setState(pending.data, { name: pending.name, mode: pending.mode });
        projectId = pending.projectId || null;
        if (pending.action === "save" && me) await save();
        else if (pending.action === "order" && me) toast("Welcome back. Your design is here: press Place order to continue.");
      } catch (e) { console.error("restore", e); }
    }
    document.documentElement.dataset.epixReady = "1";
    if (live()) refreshPrice();
    const t = $("[data-epix-title]"); if (t) t.textContent = title();
  }
  window.EPIX = { save, order, exportNow, price: () => quote, refreshPrice, me: () => me, project: () => projectId, toast, refreshTitle: () => { const t = $("[data-epix-title]"); if (t) t.textContent = title(); } };
  start();
})();
