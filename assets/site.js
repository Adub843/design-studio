// EPIX3D site pages: account state in the header, the Account page (sign in, sign up, sign out,
// change password), My projects, the Go Platinum and Join Design files buttons, and the Design files
// library (/designs/). Talks only to this site's /api.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);

  async function api(path, opts = {}) {
    const init = { credentials: "same-origin", method: opts.method || "GET", headers: { accept: "application/json" } };
    if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers["content-type"] = "application/json"; }
    const r = await fetch(path, init);
    let body = null; try { body = await r.json(); } catch { body = null; }
    if (!r.ok) { const e = new Error(body?.error || "Something went wrong. Try again."); e.status = r.status; e.code = body?.code; throw e; }
    return body;
  }
  const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const MAKERS = { lightbox: "Light box", "license-plate": "License plate", nameplate: "Nameplate", "hype-chain": "Hype chain" };
  const MODES = { lightbox: "Light box", keychain: "Keychain", nametag: "Name tag", sign: "Sign", litho: "Lithophane" };
  const makerName = (p) => (p.maker === "lightbox" && MODES[p.mode]) || MAKERS[p.maker] || p.maker;
  // Only same-site paths are followed after sign-in.
  const safeNext = (n) => (typeof n === "string" && /^\/(?!\/)[^\s\\]*$/.test(n) ? n : null);

  // Header shadow once the page scrolls.
  const top = $(".top");
  const onScroll = () => top && top.classList.toggle("scrolled", scrollY > 4);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  let me = null;
  function paintHeader() {
    for (const a of $$("[data-acct]")) {
      if (me) { a.href = "/account/"; a.innerHTML = ""; if (me.platinum) { const p = document.createElement("span"); p.className = "pill"; p.textContent = "Platinum"; a.append(p, " "); } a.append("Account"); }
      else { a.href = "/account/"; a.textContent = "Sign in"; }
    }
  }

  /* ---------- Account page ---------- */
  function setMsg(form, text, kind = "bad") { const m = $(".form-msg", form); if (m) { m.textContent = text || ""; m.className = `form-msg ${text ? kind : ""}`; } }
  function showTab(which) {
    for (const b of $$("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === which));
    for (const f of $$("[data-form=signin], [data-form=signup], [data-form=forgot], [data-form=reset]")) f.hidden = f.dataset.form !== which;
    const tabs = $(".auth .tabs"); if (tabs) tabs.hidden = which === "forgot" || which === "reset";
  }
  const resetToken = () => { const t = params.get("reset"); return t && /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : ""; };
  async function submitAuth(form, kind) {
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg(form, "Enter your email address.");
    if (kind === "signup" && password.length < 10) return setMsg(form, "Use a password of at least 10 characters.");
    if (!password) return setMsg(form, "Enter your password.");
    const btn = $("button[type=submit]", form); btn.disabled = true; setMsg(form, "");
    try {
      const r = await api(`/api/auth/${kind}`, { method: "POST", json: { email, password } });
      me = r.user;
      const next = safeNext(params.get("next"));
      if (next) { location.href = next; return; }
      paintHeader(); paintAccount();
    } catch (e) { setMsg(form, e.message); }
    finally { btn.disabled = false; }
  }
  async function paintAccount() {
    const root = $(".page-account"); if (!root) return;
    $("[data-acct-loading]").hidden = true;
    $("[data-auth]").hidden = !!me;
    $("[data-account]").hidden = !me;
    $("[data-acct-title]").textContent = me ? "Your account" : params.get("mode") === "signup" ? "Make a free account" : "Sign in";
    $("[data-acct-lead]").textContent = me ? "Membership, print requests and password." : "Save projects and order prints. Designing is always free.";
    if (!me && resetToken()) { $("[data-acct-title]").textContent = "Set a new password"; $("[data-acct-lead]").textContent = "Choose a new password for your account."; showTab("reset"); return; }
    if (!me) { showTab(params.get("mode") === "signup" ? "signup" : "signin"); return; }
    $("[data-me-email]").textContent = me.email;
    $("[data-me-since]").textContent = fmtDate(me.createdAt);
    const box = $("[data-member]");
    box.classList.toggle("on", me.platinum);
    $("[data-member-title]").textContent = me.platinum ? "Platinum member" : "Free account";
    $("[data-member-text]").textContent = me.platinum ? `Export is on until ${fmtDate(me.platinumUntil)}.` : "Design, save and order prints at a live price. Go Platinum to export your files.";
    $("[data-member-text]").classList.toggle("muted", !me.platinum);
    const goPlat = $("[data-member-cta] .btn-primary"); if (goPlat) goPlat.hidden = me.platinum;
    const dbox = $("[data-designs-member-box]");
    if (dbox) {
      dbox.classList.toggle("on", !!me.designs);
      $("[data-designs-title]").textContent = me.designs ? "Design files member" : "Design files";
      $("[data-designs-text]").textContent = me.designs ? `The design library is open until ${fmtDate(me.designsUntil)}.` : "SVG, PNG and DTF art library, $15 a month.";
      $("[data-designs-text]").classList.toggle("muted", !me.designs);
      const dcta = $("[data-designs-acct-cta]"); if (dcta) dcta.textContent = me.designs ? "Open the library" : "See Design files";
    }
    try {
      const { items } = await api("/api/orders");
      const ul = $("[data-orders]"); ul.innerHTML = "";
      $("[data-orders-empty]").hidden = items.length > 0;
      for (const o of items.slice(0, 10)) {
        const li = document.createElement("li");
        const a = document.createElement("span"); a.textContent = `${o.project} (${MAKERS[o.maker] || o.maker})${o.price ? `, $${o.price}` : ""}`;
        const b = document.createElement("span"); b.className = "muted"; b.textContent = `${fmtDate(o.createdAt)} · ref ${o.ref}`;
        li.append(a, b); ul.append(li);
      }
    } catch { /* the list is a nice-to-have */ }
  }
  function wireAccount() {
    if (!$(".page-account")) return;
    for (const b of $$("[data-tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));
    $("[data-form=signin]").addEventListener("submit", (e) => { e.preventDefault(); submitAuth(e.currentTarget, "signin"); });
    $("[data-form=signup]").addEventListener("submit", (e) => { e.preventDefault(); submitAuth(e.currentTarget, "signup"); });
    for (const b of $$("[data-show-forgot]")) b.addEventListener("click", () => { const f = $("[data-form=forgot]"); const si = $("[data-form=signin]"); if (si.email.value) f.email.value = si.email.value; setMsg(f, ""); showTab("forgot"); f.email.focus(); });
    $("[data-back-signin]").addEventListener("click", () => showTab("signin"));
    $("[data-form=forgot]").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = e.currentTarget; const email = f.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg(f, "Enter your email address.");
      const btn = $("button[type=submit]", f); btn.disabled = true; setMsg(f, "");
      try { await api("/api/auth/forgot", { method: "POST", json: { email } }); setMsg(f, "If that email has an account, a reset link is on its way. Check your inbox and spam folder.", "ok"); }
      catch (err) { setMsg(f, err.message); }
      finally { btn.disabled = false; }
    });
    $("[data-form=reset]").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = e.currentTarget;
      if (f.password.value.length < 10) return setMsg(f, "Use a password of at least 10 characters.");
      const btn = $("button[type=submit]", f); btn.disabled = true; setMsg(f, "");
      try {
        const r = await api("/api/auth/reset", { method: "POST", json: { token: resetToken(), password: f.password.value } });
        me = r.user; params.delete("reset"); history.replaceState(null, "", "/account/"); paintHeader(); paintAccount();
      } catch (err) { setMsg(f, err.message); }
      finally { btn.disabled = false; }
    });
    $("[data-form=password]").addEventListener("submit", async (e) => {
      e.preventDefault(); const f = e.currentTarget;
      if (f.next.value.length < 10) return setMsg(f, "Use a new password of at least 10 characters.");
      const btn = $("button[type=submit]", f); btn.disabled = true;
      try { await api("/api/auth/password", { method: "POST", json: { current: f.current.value, next: f.next.value } }); f.reset(); setMsg(f, "Password changed. Other devices are signed out.", "ok"); }
      catch (err) { setMsg(f, err.message); }
      finally { btn.disabled = false; }
    });
    $("[data-signout]").addEventListener("click", async () => {
      try { await api("/api/auth/signout", { method: "POST" }); } catch { /* signed out anyway */ }
      me = null; paintHeader(); paintAccount();
    });
  }

  /* ---------- My projects ---------- */
  function projectUrl(p) {
    const q = new URLSearchParams({ project: p.id }); if (p.maker === "lightbox" && p.mode) q.set("mode", p.mode);
    return `/makers/${p.maker}/?${q}`;
  }
  async function paintProjects() {
    const root = $("[data-projects]"); if (!root) return;
    const show = (k) => { for (const x of ["loading", "signedout", "empty", "list"]) $(`[data-projects-${x}]`).hidden = x !== k; };
    if (!me) return show("signedout");
    let items = [], max = 50;
    try { ({ items, max } = await api("/api/projects")); }
    catch (e) { if (e.status === 401) { me = null; paintHeader(); return show("signedout"); } $("[data-projects-loading]").textContent = e.message; return; }
    if (!items.length) return show("empty");
    show("list");
    $("[data-projects-count]").textContent = `${items.length} of ${max} projects`;
    const grid = $("[data-projects-grid]"); grid.innerHTML = "";
    for (const p of items) grid.append(projectCard(p));
  }
  function projectCard(p) {
    const li = document.createElement("li"); li.className = "proj"; li.dataset.id = p.id;
    const pic = document.createElement("a"); pic.className = "proj-pic"; pic.href = projectUrl(p);
    const img = document.createElement("img"); img.alt = ""; img.loading = "lazy"; img.src = p.thumbUrl; img.onerror = () => img.remove(); pic.append(img);
    const body = document.createElement("div"); body.className = "proj-body";
    const name = document.createElement("h2"); name.className = "proj-name"; name.textContent = p.name;
    const meta = document.createElement("span"); meta.className = "proj-meta"; meta.textContent = `${makerName(p)} · saved ${fmtDate(p.updatedAt)}`;
    const acts = document.createElement("div"); acts.className = "proj-actions";
    const btn = (label, cls, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = `btn ${cls}`; b.textContent = label; b.addEventListener("click", fn); return b; };
    const open = document.createElement("a"); open.className = "btn btn-primary"; open.href = projectUrl(p); open.textContent = "Open";
    acts.append(open,
      btn("Rename", "", () => rename(p, li, name)),
      btn("Duplicate", "", async () => { try { await api(`/api/projects/${p.id}/duplicate`, { method: "POST" }); paintProjects(); } catch (e) { say(e.message); } }),
      btn("Delete", "danger", async () => { if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return; try { await api(`/api/projects/${p.id}`, { method: "DELETE" }); paintProjects(); } catch (e) { say(e.message); } }));
    body.append(name, meta, acts); li.append(pic, body);
    return li;
  }
  const say = (t) => { const m = $("[data-projects-msg]"); if (m) { m.textContent = t; m.className = "form-msg bad"; } };
  function rename(p, li, nameEl) {
    const form = document.createElement("form"); form.className = "proj-rename";
    const inp = document.createElement("input"); inp.value = p.name; inp.maxLength = 80; inp.setAttribute("aria-label", "Project name");
    const ok = document.createElement("button"); ok.className = "btn btn-sm btn-ink"; ok.type = "submit"; ok.textContent = "Save";
    form.append(inp, ok); nameEl.replaceWith(form); inp.focus(); inp.select();
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const v = inp.value.trim(); if (!v) return;
      try { await api(`/api/projects/${p.id}`, { method: "PUT", json: { name: v } }); paintProjects(); } catch (err) { say(err.message); }
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Escape") { form.replaceWith(nameEl); } });
  }

  /* ---------- Plans: Go Platinum and Join Design files (both check out on the Charleston3D store) ---------- */
  let cfgP = null;
  const config = () => cfgP || (cfgP = api("/api/config").catch(() => null));
  function checkout(plan, next) {
    if (!me) { location.href = `/account/?mode=signup&next=${encodeURIComponent(next)}`; return; }
    const form = document.createElement("form"); form.method = "post"; form.action = `${plan.store}/cart/add`; form.hidden = true;
    const add = (k, v) => { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; form.append(i); };
    add("id", String(plan.variant)); add("quantity", "1"); add("selling_plan", String(plan.sellingPlan));
    add(`properties[${plan.accountProperty}]`, me.email); add("return_to", "/checkout");
    window.EPIX_ADS?.track("InitiateCheckout", { content_name: plan.name || "EPIX3D plan", value: 15, currency: "USD" });
    document.body.append(form); form.submit();
  }
  async function paintPlan({ key, btnSel, noteSel, active, until, onText, next, soon }) {
    const btns = $$(btnSel); if (!btns.length) return;
    const notes = $$(noteSel);
    const say = (t) => { for (const n of notes) n.textContent = t; };
    const cfg = await config();
    if (me && active) { for (const b of btns) { b.disabled = true; b.textContent = onText; } say(`Your plan is on until ${fmtDate(until)}.`); return; }
    if (!cfg?.[key]?.available) { for (const b of btns) b.disabled = true; say(soon); return; }
    say(me ? `Checkout on the Charleston3D store, linked to ${me.email}.` : "Make a free account or sign in first, so we can link the plan to it.");
    for (const b of btns) { b.disabled = false; b.addEventListener("click", () => checkout(cfg[key], next)); }
  }
  async function paintPricing() {
    const free = $("[data-free-cta]");
    if (free && me) { free.textContent = "Open the makers"; free.href = "/makers/"; }
    await Promise.all([
      paintPlan({ key: "platinum", btnSel: "[data-go-platinum]", noteSel: "[data-platinum-note]", active: me?.platinum, until: me?.platinumUntil, onText: "You're Platinum", next: "/pricing/#platinum", soon: "Platinum sign-up opens soon. Free accounts can design, save and order now." }),
      paintPlan({ key: "designs", btnSel: "[data-go-designs]", noteSel: "[data-designs-note]", active: me?.designs, until: me?.designsUntil, onText: "You're a member", next: location.pathname === "/designs/" ? "/designs/" : "/pricing/#design-files", soon: "Design files opens soon." }),
    ]);
  }

  /* ---------- Design files library (/designs/) ---------- */
  const KIND_LABEL = { svg: "SVG", image: "PNG", dtf: "DTF" };
  const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  async function paintDesigns() {
    const root = $("[data-designs-member]"); if (!root) return;
    const locked = $("[data-designs-locked]");
    const signin = $("[data-designs-signin]"); if (signin) signin.hidden = !!me;
    if (me && !me.designs) { const t = $("[data-designs-gate-text]"); if (t) t.textContent = `Signed in as ${me.email}. Join Design files to search, preview and download every design.`; }
    if (!me?.designs) return;
    locked.hidden = true; root.hidden = false;
    for (const c of $$("[data-designs-cta] [data-go-designs]")) c.hidden = true;
    const grid = $("[data-designs-grid]"), more = $("[data-designs-more]"), status = $("[data-designs-status]");
    const form = $("[data-designs-search]");
    let page = 0, kind = "", q = "", seq = 0;
    async function load(reset) {
      const my = ++seq;
      if (reset) { page = 0; grid.innerHTML = ""; }
      status.textContent = "Loading designs…"; more.hidden = true;
      try {
        const r = await api(`/api/designs/search?${new URLSearchParams({ q, kind, page: String(page) })}`);
        if (my !== seq) return;
        for (const d of r.items) {
          const li = document.createElement("li");
          const img = document.createElement("img"); img.alt = d.name; img.loading = "lazy"; img.width = 400; img.height = 400; if (d.thumbUrl) img.src = d.thumbUrl;
          const name = document.createElement("span"); name.className = "dz-name"; name.textContent = d.name;
          const meta = document.createElement("div"); meta.className = "dz-meta";
          const k = document.createElement("span"); k.textContent = `${KIND_LABEL[d.kind] || d.kind}${d.size ? ` · ${fmtSize(d.size)}` : ""}`;
          const dl = document.createElement("a"); dl.className = "dz-dl"; dl.href = d.downloadUrl; dl.textContent = "Download"; dl.setAttribute("download", "");
          meta.append(k, dl); li.append(img, name, meta); grid.append(li);
        }
        status.textContent = grid.children.length ? (r.total ? `${r.total.toLocaleString()} designs` : "") : "No designs match that search.";
        more.hidden = !r.more; page += 1;
      } catch (e) { if (my === seq) status.textContent = e.message; }
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); q = form.q.value.trim(); load(true); });
    let t = 0; form.q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { q = form.q.value.trim(); load(true); }, 450); });
    for (const b of $$("[data-kind]", form)) b.addEventListener("click", () => { kind = b.dataset.kind; for (const x of $$("[data-kind]", form)) x.setAttribute("aria-checked", String(x === b)); load(true); });
    more.addEventListener("click", () => load(false));
    load(true);
  }

  async function start() {
    try { me = (await api("/api/me")).user; } catch { me = null; }
    paintHeader();
    wireAccount();
    await Promise.all([paintAccount(), paintProjects(), paintPricing(), paintDesigns()]);
    document.documentElement.dataset.ready = "1";
  }
  start();
})();
