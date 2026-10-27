// The brands the studio holds art for. Each image belongs to exactly one, and the switcher at the
// top of every page narrows the whole studio (home, library, designer) to one brand or shows all.
// EPIX3D is a label of Elevated Designs (its own art, ED checkout).
import { store } from "./util.js";

export const BRANDS = {
  c3d: { name: "Charleston 3D", short: "C3D", site: "https://charleston3d.com" },
  ed: { name: "Elevated Designs", short: "ED", site: "https://elevatedshirts.com" },
  epix3d: { name: "EPIX3D", short: "EPIX", site: null }, // epix3d.com is this studio, so EPIX3D has no shop of its own
};
export const BRAND_KEYS = Object.keys(BRANDS);

const KEY = "ds-brand";
const listeners = new Set();
let current = BRAND_KEYS.includes(store.get(KEY, "all")) ? store.get(KEY, "all") : "all";

// "all" or one brand key.
export const currentBrand = () => current;
// The brand new uploads and saved designs go to: the chosen one, or Elevated Designs when showing all.
export const uploadBrand = () => current === "all" ? "ed" : current;
export const brandName = (k) => k === "all" ? "All brands" : BRANDS[k]?.name ?? "Elevated Designs";
// Charleston 3D has no shirt app, and its art never goes in the Elevated Designs one (the server enforces this too).
export const canBePublic = (k) => k !== "c3d";
export const inBrand = (item) => current === "all" || (item.brand ?? "ed") === current;

export function setBrand(k) {
  if (k !== "all" && !BRANDS[k]) return;
  if (k === current) return;
  current = k;
  store.set(KEY, k);
  document.documentElement.dataset.brand = k;
  for (const fn of listeners) fn(k);
}
export const onBrand = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
document.documentElement.dataset.brand = current;
