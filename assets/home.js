// Home: where each brand's art stands, a quick start into the designer, and the newest images.
// Everything follows the brand switcher in the top bar.
import { el, store, go, icon, pageHeader } from "./app.js";
import { BRANDS, BRAND_KEYS, currentBrand, brandName, inBrand, setBrand } from "./brands.js";
import { askForKey, consoleKey } from "./api.js";
import { listImages, imageUrl, libraryScope, startDesign } from "./studio.js";

const STARTS = [["tee", "T-shirt"], ["hoodie", "Hoodie"], ["longsleeve", "Long sleeve"], ["tank", "Tank top"], ["crew", "Crewneck"], ["fitted", "Fitted tee"]];
const WEEK = 7 * 24 * 60 * 60 * 1000;
const fmt = (n) => n.toLocaleString();

function stat(label, value, sub, onclick) {
  return el("button", { class: "kpi", type: "button", onclick }, el("span", {}, label), el("b", { class: "num" }, value), sub ? el("small", { class: "muted" }, sub) : null);
}

export async function renderHome() {
  const brand = currentBrand();
  const items = (await listImages()).filter(inBrand);
  const keyed = libraryScope === "all";
  const pub = items.filter((i) => i.public).length;
  const fresh = items.filter((i) => (i.added ?? 0) > Date.now() - WEEK).length;
  const openLib = (filter) => { store.set("ds-lib-filter", filter); go("library"); };

  const head = pageHeader(brand === "all" ? "All brands" : BRANDS[brand].name, "Design Studio",
    "Make shirt designs from each brand's own art, then save them for listing from the Business Console.", [
      el("button", { class: "btn", type: "button", onclick: () => { store.set("ds-open-upload", true); go("library"); } }, icon("upload"), "Upload art"),
      el("a", { class: "btn primary", href: "#designer" }, icon("plus"), "New design"),
    ]);

  const stats = el("section", { class: "kpis", "aria-label": "Library numbers" },
    stat("Images", fmt(items.length), brand === "all" ? "Across all three brands" : `In the ${BRANDS[brand].short} library`, () => openLib("all")),
    stat("In the shirt apps", fmt(pub), "Customers can pick these", () => openLib("public")),
    keyed ? stat("Private", fmt(items.length - pub), "Only you see these", () => openLib("private"))
      : stat("Private", "Locked", "Unlock to count them", async () => { if (await askForKey("Private images need the studio key.")) go("home"); }),
    stat("Added this week", fmt(fresh), "Uploads and saved designs", () => openLib("all")));

  // The shirt photos the designer uses, so the tiles show the real blanks.
  const starts = el("section", { class: "panel" },
    el("div", { class: "panel-head" }, el("h2", {}, "Start a design"), el("a", { class: "linkbtn small", href: "#designer" }, "Open the designer")),
    el("div", { class: "starts" }, STARTS.map(([k, name]) => el("button", { class: "start", type: "button", onclick: () => { startDesign(k); go("designer"); } },
      el("span", { class: "ed-thumb", "aria-hidden": "true" },
        el("img", { class: "ed-shade", src: `assets/blanks/${k}-front-shade.jpg`, alt: "", loading: "lazy" }),
        el("img", { class: "ed-base", src: `assets/blanks/${k}-front.jpg`, alt: "", loading: "lazy" })),
      el("span", { class: "start-name" }, name)))));

  const recent = items.slice(0, 12);
  const recentPanel = el("section", { class: "panel" },
    el("div", { class: "panel-head" }, el("h2", {}, "Newest art"), el("a", { class: "linkbtn small", href: "#library" }, "See the whole library")),
    recent.length
      ? el("div", { class: "recent" }, recent.map((i) => el("button", { class: "rcard", type: "button", title: `Use ${i.name} in the designer`,
        onclick: () => { store.set("ds-add", i.key); go("designer"); } },
        el("span", { class: "checker" }, el("img", { src: imageUrl(i), alt: "", loading: "lazy" })),
        el("span", { class: "rname" }, i.name),
        el("span", { class: "row rpills" }, brand === "all" ? el("span", { class: `pill b-${i.brand ?? "ed"}` }, BRANDS[i.brand ?? "ed"]?.short ?? "ED") : null,
          el("span", { class: `pill ${i.public ? "s-live" : "s-empty"}` }, i.public ? "Shirt apps" : i.local ? "This browser" : "Private")))))
      : el("div", { class: "empty" }, el("p", {}, `No ${brandName(brand)} art yet.`),
        el("button", { class: "btn primary", type: "button", onclick: () => { store.set("ds-open-upload", true); go("library"); } }, "Upload the first image")));

  // With all brands showing, one card per brand; each opens that brand's library.
  const brandCards = brand !== "all" ? null : el("section", { class: "brand-cards", "aria-label": "Brands" }, BRAND_KEYS.map((k) => {
    const mine = items.filter((i) => (i.brand ?? "ed") === k);
    return el("article", { class: `panel bcard bc-${k}` },
      el("div", { class: "panel-head" }, el("h3", {}, BRANDS[k].name), el("span", { class: `pill b-${k}` }, BRANDS[k].short)),
      el("p", { class: "muted small" }, `${fmt(mine.length)} ${mine.length === 1 ? "image" : "images"}, ` +
        (k === "c3d" ? "kept out of the shirt apps" : `${fmt(mine.filter((i) => i.public).length)} in the shirt apps`)),
      el("div", { class: "thumbs" }, mine.slice(0, 4).map((i) => el("span", { class: "checker" }, el("img", { src: imageUrl(i), alt: "", loading: "lazy" })))),
      el("div", { class: "row" },
        el("button", { class: "btn", type: "button", onclick: () => { setBrand(k); go("library"); } }, "Open library"),
        BRANDS[k].site ? el("a", { class: "linkbtn small", href: BRANDS[k].site, target: "_blank", rel: "noopener" }, "Visit site") : null));
  }));

  const sync = el("p", { class: "muted small" });
  fetch("/api/library-sync", { headers: { accept: "application/json" } }).then((r) => r.json()).then((s) => {
    const at = s?.finishedAt ?? s?.ranAt ?? s?.at;
    if (at) sync.textContent = `Kittl art last synced ${new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. It runs every hour from the Business Console.`;
  }).catch(() => {});

  const lockNote = keyed || consoleKey.get() ? null : el("p", { class: "muted small" }, "Showing the public art only. ",
    el("button", { class: "linkbtn", type: "button", onclick: async () => { if (await askForKey("Private images need the studio key.")) go("home"); } }, "Unlock"), " to see private images and saved designs.");

  return [head, lockNote, stats, starts, brandCards, recentPanel, sync];
}
