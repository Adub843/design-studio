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

// The 3D makers membership ("EPIX3D Platinum"), $15 a month (Aaron's price, set on the product in Shopify,
// not here). Since 15 Nov 2026 every maker is members-only: an EPIX3D account is a paid account.
export const PLATINUM_PRODUCT_ID = 15484799058107; // "EPIX3D Platinum" (handle epix3d-platinum), 8 Nov 2026
export const PLATINUM_VARIANT_ID = 68126506287291;
export const PLATINUM_SELLING_PLAN_ID = 160416825531; // "Platinum, billed monthly" (Shopify Subscriptions)
// Shown on the site. Must match the price on the Shopify product.
export const PLATINUM_PRICE_LABEL = "$15 a month";
// A paid month unlocks the plan for 35 days from the payment date (a few days' grace for renewals).
export const PLATINUM_DAYS = 35;

// Ordered prints are priced live by Aaron's 3D Print Calculator (lib/print-price.mjs) and go on the
// "EPIX3D Custom Print" product: one variant per whole-dollar price (lib/print-variants.json). Prices
// above the top variant ($500), and files the price can't be read from, still go on the $0 quote line.
// false sends every order to the quote line again (the old way).
export const PRINT_PRICING = true;

// The line-item property that carries the EPIX3D account email to the order, so the webhook can find
// the account even when the buyer checks out with another email. Starts with "_" so the cart hides it.
export const ACCOUNT_PROPERTY = "_EPIX3D account";

// The second plan (Aaron, 15 Nov 2026): Design files, $15 a month on its own, for the Elevated Designs art
// on the E: drive (SVG, PNG and DTF prints), kept up to date as files are added. Aaron (15 Nov 2026): it
// checks out the same way as Platinum, on the Charleston3D store, through the same webhook.
// PLACEHOLDERS (null) until the subscription product is live there; the site says "opens soon" until then.
export const DESIGNS_PRODUCT_ID = 15507955122363;
export const DESIGNS_VARIANT_ID = 68307953615035;
export const DESIGNS_SELLING_PLAN_ID = 160434290875;
export const DESIGNS_PRICE_LABEL = "$15 a month";

// The two plans. `field` is where the paid-until date sits on the account; `pending` holds a payment made
// before the account existed; `secret` is the Cloudflare secret that signs that store's webhooks.
export const PLANS = {
  makers: { name: "3D makers", field: "platinumUntil", source: "platinumSource", pending: "pending-platinum", store: STORE, shop: SHOP_DOMAIN, secret: "SHOPIFY_WEBHOOK_SECRET",
    product: PLATINUM_PRODUCT_ID, variant: PLATINUM_VARIANT_ID, sellingPlan: PLATINUM_SELLING_PLAN_ID, price: PLATINUM_PRICE_LABEL },
  designs: { name: "Design files", field: "designsUntil", source: "designsSource", pending: "pending-designs", store: STORE, shop: SHOP_DOMAIN, secret: "SHOPIFY_WEBHOOK_SECRET",
    product: DESIGNS_PRODUCT_ID, variant: DESIGNS_VARIANT_ID, sellingPlan: DESIGNS_SELLING_PLAN_ID, price: DESIGNS_PRICE_LABEL },
};
export const planReady = (plan) => !!plan && plan.variant != null && plan.sellingPlan != null;

export const platinumReady = () => PLATINUM_VARIANT_ID != null && PLATINUM_SELLING_PLAN_ID != null;
