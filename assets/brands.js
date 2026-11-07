// The brands the studio holds art for. epix3d.com is for 3D designs only, so Elevated Designs (shirts) is not
// here and its art never shows in the studio. The switcher at the top of every page narrows the studio to one
// brand or shows both.
import { store } from "./util.js";

export const BRANDS = {
  c3d: { name: "Charleston 3D", short: "C3D", site: "https://charleston3d.com" },
  epix3d: { name: "EPIX3D", short: "EPIX", site: null }, // epix3d.com is this studio, so EPIX3D has no shop of its own
};
export const BRAND_KEYS = Object.keys(BRANDS);

const KEY = "ds-brand";
const listeners = new Set();
let current = BRAND_KEYS.includes(store.get(KEY, "all")) ? store.get(KEY, "all") : "all";

// "all" or one brand key.
export const currentBrand = () => current;
// The brand new uploads go to: the chosen one, or EPIX3D when showing all.
export const uploadBrand = () => current === "all" ? "epix3d" : current;
export const brandName = (k) => k === "all" ? "All brands" : BRANDS[k]?.name ?? "EPIX3D";
// Only this studio's brands; anything else in the shared library (Elevated Designs shirt art) is left out.
export const inBrand = (item) => Object.hasOwn(BRANDS, item.brand ?? "ed") && (current === "all" || item.brand === current);

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
