// Every Shopify id EPIX3D uses, in one place. EPIX3D is sold through the Charleston3D Shopify store
// (Aaron's decision, 7 Nov 2026): ordered prints and the Platinum membership both check out there.
// Nothing here is a secret. Prices are never written here: the store holds them.

// The Charleston3D store. Cart posts go to its primary domain (lib/plate-order.mjs follows the feed's
// final address at run time and falls back to this).
export const STORE = "https://charleston3d.com";
// The store's own myshopify.com address, sent by Shopify as x-shopify-shop-domain on every webhook.
export const SHOP_DOMAIN = "nu2xws-gy.myshopify.com";

// Ordered prints come in as a $0 quote line that Aaron prices himself, on the store's free
// "Custom request" product (handle custom-request, tag request-product). Read from the live store feed
// (charleston3d.com/products.json) on 7 Nov 2026. The worker still looks the product up in the feed at
// order time and uses these only if the feed can't be reached.
export const QUOTE_PRODUCT_ID = 15442527223995;
export const QUOTE_VARIANT_ID = 67895111745723;

// Platinum membership, $15 a month (Aaron's price, set on the product in Shopify, not here).
// PLACEHOLDERS: the subscription product doesn't exist yet. Create it on the Charleston3D store with a
// monthly selling plan, then put its ids here and deploy. Until then "Go Platinum" says sign-up opens soon.
export const PLATINUM_PRODUCT_ID = null;          // e.g. 15400000000000
export const PLATINUM_VARIANT_ID = null;          // e.g. 67800000000000
export const PLATINUM_SELLING_PLAN_ID = null;     // e.g. 690000000000 (the monthly plan)
// Shown on the site. Must match the price on the Shopify product.
export const PLATINUM_PRICE_LABEL = "$15 a month";
// A paid month unlocks downloads for 35 days from the payment date (a few days' grace for renewals).
export const PLATINUM_DAYS = 35;

// The line-item property that carries the EPIX3D account email to the order, so the webhook can find
// the account even when the buyer checks out with another email. Starts with "_" so the cart hides it.
export const ACCOUNT_PROPERTY = "_EPIX3D account";

export const platinumReady = () => PLATINUM_VARIANT_ID != null && PLATINUM_SELLING_PLAN_ID != null;
