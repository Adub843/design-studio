// EPIX3D bridge: links each maker page (makers/<maker>/) to the site.
//
// A maker sets window.EPIX_MAKER before this file loads:
//   { id, title(), mode(), name(), hasContent(), getState(), setState(data), thumb(),
//     buildPrintFile() -> { blob, name, details, product?, preview? }, downloadSelector, orderNote?() }
// The bridge then adds the EPIX3D bar (or wires [data-epix-*] buttons already on the page) and handles:
//   Save to my projects   POST/PUT /api/projects (signed in; otherwise it keeps the design and asks them to sign in)
//   Opening a project     ?project=<id> loads it from /api/projects/<id>
//   Order a print         builds the maker's print file, POST /api/orders keeps it on epix3d.com, then the
//                         page posts to the Charleston3D cart with the $0 quote line the server returns
//   Downloads             every download/export button works only for signed-in Platinum members (checked
//                         with /api/exports/check); everyone else sees the Platinum prompt
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

  const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true" width="26" height="26"><path d="M16 2.5c5.6 0 11.9 2.6 12.9 8.4 1 5.9-1.6 9.5-3.4 12.6-2.1 3.6-5.2 6.2-9.7 6.2-5.2 0-9.6-2.5-11.6-7.2C2.4 17.9 2.6 12 5.7 7.8 8.2 4.4 11.6 2.5 16 2.5z" fill="#ff6b3d"/><path d="M16 8.6 23 12.4v7.2L16 23.4l-7-3.8v-7.2z" fill="#fff8ef"/><path d="M16 16.2v7.2l7-3.8v-7.2z" fill="#ffc23d"/><path d="M16 16.2 9 12.4v7.2l7 3.8z" fill="#23b5a0"/></svg>';

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
      <button type="button" class="epx-btn" data-epix-save>Save</button>
      <button type="button" class="epx-btn epx-primary" data-epix-order><span class="epx-long">Order a print</span><span class="epx-short">Order</span></button>
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
      title: "Downloads come with Platinum",
      body: `<p>Free accounts can design, save and order prints made in Charleston, SC.</p><p><b>Platinum</b> is $15 a month and adds 3MF and STL downloads, so you can print your designs at home.</p>${me ? "" : '<p class="epx-muted">Already a member? Sign in first.</p>'}`,
      actions: [
        { label: "Not now" },
        ...(me ? [] : [{ label: "Sign in", href: `/account/?next=${encodeURIComponent(nextUrl())}`, onClick: () => go("signin", "download") }]),
        { label: "Order a print instead", onClick: () => setTimeout(order, 0) },
        { label: "See Platinum", primary: true, href: "/pricing/" },
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
    const note = (M.orderNote && M.orderNote()) || "We print it in Charleston, SC. Your design goes to checkout as a free print request: we look it over and reply with a price within 1-2 business days. You pay nothing now.";
    dialog({
      title: "Order a print",
      body: `<p>${esc(note)}</p><p class="epx-muted">Checkout is on the Charleston3D store, where EPIX3D prints are sold.</p>`,
      actions: [{ label: "Cancel" }, { label: "Continue to checkout", primary: true, onClick: () => setTimeout(placeOrder, 0) }],
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
      fd.append("file", new File([f.blob], f.name, { type: f.blob.type || "application/octet-stream" }));
      if (f.preview) fd.append("preview", new File([f.preview], "preview" + (f.preview.type === "image/jpeg" ? ".jpg" : ".png"), { type: f.preview.type || "image/png" }));
      const r = await api("/api/orders", { method: "POST", body: fd });
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

  /* ---------- the Platinum gate on downloads ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest(M.downloadSelector || "[data-download]") : null;
    if (!t || canDownload) return;
    e.preventDefault(); e.stopImmediatePropagation();
    askPlatinum();
  }, true);
  async function checkDownloads() {
    canDownload = false;
    if (!me || !me.platinum) return;
    try { await api("/api/exports/check", { method: "POST" }); canDownload = true; } catch { canDownload = false; }
    document.documentElement.dataset.epixDownloads = canDownload ? "on" : "off";
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
        else if (pending.action === "order" && me) toast("Welcome back. Your design is here: press Order a print to continue.");
      } catch (e) { console.error("restore", e); }
    }
    document.documentElement.dataset.epixReady = "1";
    const t = $("[data-epix-title]"); if (t) t.textContent = title();
  }
  window.EPIX = { save, order, me: () => me, project: () => projectId, toast, refreshTitle: () => { const t = $("[data-epix-title]"); if (t) t.textContent = title(); } };
  start();
})();
