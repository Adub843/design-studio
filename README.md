# EPIX3D (epix3d.com)

A standalone site where anyone can use our 3D makers: design in the browser, save projects to a free
account, order a print made in Charleston, SC, or pay for Platinum ($15 a month) to download the
3MF/STL files and print at home. Orders and Platinum check out on the Charleston3D Shopify store.
The makers live only here and in the Creative Lab engine.

One Cloudflare Worker (`design-studio`, `worker/index.mjs`) serves the site, its API and, unchanged,
the image library and E: drive APIs that the Elevated Designs shirt app and the console use.
Backup address: https://design-studio.business-console.workers.dev.

## What was removed (the Design Studio, 7 Nov 2026)

The studio's own pages are gone from epix3d.com: home, library, shirt designer, brand switcher, Go to
menu and Maker Studio tabs (`index.html`, `assets/app.js`, `api.js`, `brands.js`, `home.js`,
`library.js`, `studio.js`, `confirm.js`, `drive.js`, `makers.js`, `util.js`, `styles.css`,
`assets/blanks/`, `assets/brand/`, `makers/index.html`). Art is managed in the Creative Lab engine.

## What stays exactly as it was (other apps depend on it)

| Call | Used by |
|---|---|
| `/api/images` and `/api/images/:key` (GET/POST/PATCH/DELETE, CONSOLE_KEY) | shirt apps, console |
| `/api/drive/*` (E: drive library through DRIVE_ORIGIN) | ED shirt app, console |
| `/api/library-sync` | console |
| `/api/plate-order` | License Plate Maker |
| `/hq` (short link to the main console) | Aaron |

## The site

| Page | Source |
|---|---|
| Home `/`, Makers `/makers/`, Pricing, FAQ, Privacy, Terms, 404 | `site/pages/*.html` wrapped in `site/layout.html` |
| Account `/account/`, My projects `/projects/` | same, filled in by `assets/site.js` |
| The makers `/makers/lightbox/` (also `?mode=keychain`, `nametag`, `sign`, `litho`), `/makers/ai3d/`, `/makers/license-plate/`, `/makers/nameplate/`, `/makers/hype-chain/` | `makers/` |

**One site, one link.** Every maker lives here and nowhere else: no maker gets its own address, app or QR
code (Aaron, 8 Nov 2026). Each maker page carries the same EPIX3D bar with an **All makers** switcher
(the list comes from `site/makers.json`, published as `/assets/makers.json`), and the same look through
`assets/epix-theme.css`. The brand (logo files, colours, type, the one QR code) is in `BRAND.md` and
`assets/brand/`. three.js, its controls and JSZip are served from `makers/vendor/`, not from outside CDNs.

`scripts/build.mjs` builds `dist/` (pages, `assets/`, `makers/`, `sitemap.xml`, `robots.txt`, `llms.txt`).
The maker cards come from `site/makers.json`; their pictures (`assets/img/makers/`) are real renders
from the makers themselves. Look: professional and calm: white and warm-grey neutrals, ink buttons, one accent (#6d28d9), Inter only, photoreal product photos (see BRAND.md).

Each maker loads `assets/epix-bridge.js`, which adds the EPIX3D bar (Save, Order a print, account),
saves and opens projects, sends orders, and puts the Platinum gate on every download button. Each maker
tells the bridge how to read and restore its design and build its print file (`window.EPIX_MAKER`).

## Site API

| Call | Who | What |
|---|---|---|
| `GET /api/config` | anyone | Platinum price label and whether it's open (Shopify ids set) |
| `POST /api/auth/signup`, `/signin`, `/signout`, `/password`; `GET /api/me` | anyone / signed in | accounts |
| `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id`, `POST /:id/duplicate`, `GET /:id/thumb` | signed in | My projects (2 MB per project, 50 per account) |
| `POST /api/orders` (multipart), `GET /api/orders` | signed in | stores the print file, answers with the cart post |
| `GET /files/<order id>/<name>` | anyone with the link | the stored print file (24 random bytes in the id) |
| `POST /api/exports/check` | signed in | 200 for Platinum, 403 otherwise |
| `POST /api/shopify/webhook` | Shopify (HMAC) | `orders/paid` with the Platinum variant: Platinum until paid date + 35 days |
| `GET/POST /api/admin/platinum` | CONSOLE_KEY | set or clear Platinum by email |

Accounts: email + password (PBKDF2-SHA256, 100,000 rounds, salt per user), HttpOnly Secure SameSite=Lax
session cookie (30 days, token stored only as a hash), sign-in limited to 5 failures per email and 20
per IP in 15 minutes, passwords of 10+ characters, generic error messages, writes refused from other
sites. Password reset by email isn't built (no email sending is set up).

Ordering: the order goes to the store's free "Custom request" product (read from the live feed, falling
back to `lib/shop-config.mjs`), so it comes in at $0 for Aaron to quote. Line-item properties: Item,
Project, Details, Order ref, and hidden ones (`_Print file` link, `_Preview`, `_EPIX3D account`, `_Source`).

### Platinum: what is and isn't enforced

The makers build their files in the browser, so the main gate is in the page: download buttons ask
`/api/exports/check` and only Platinum members get through. A determined person could still pull a
file out of the page with developer tools. Stored order files are never shown in the cart (the link is
a hidden property) but anyone holding the link can open it, so Aaron can from the Shopify order.

## Shopify ids

All in `lib/shop-config.mjs`: the store, the Custom request product/variant (real, read from the live
feed), and the Platinum product/variant/selling plan (placeholders until the subscription product exists).

## Run and test

```
npm install
npm run check        # syntax check
npm test             # API tests
npm run build
npm run check:links  # every same-site link, script and picture in dist/ points at a real file
PLAYWRIGHT_PATH=<folder with node_modules/playwright> npm run test:ui   # browser test at 1280 and 390
npm run dev          # local Worker
```

## Search (SEO, local, AI assistants)

Built into `scripts/build.mjs` and `worker/index.mjs`, checked by `npm test`:
- Every page: title, description, canonical, meta robots, Open Graph and Twitter tags, `geo.region US-SC` / `geo.placename Charleston`, and JSON-LD (OnlineStore + LocalBusiness at city level only, WebSite, BreadcrumbList; ItemList of makers on home and /makers/; FAQPage on /faq/; Product on /pricing/).
- Maker pages get the same tags at build time, plus WebApplication JSON-LD and a hidden h1 where the app has none. Keychain, Name tag, Sign and Lithophane each have their own title and canonical (`/makers/lightbox/?mode=...`): the Worker serves the copy in `makers/lightbox/m/<mode>/`.
- `robots.txt` names Google, Bing, Apple, DuckDuckGo and the AI crawlers (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended and more); `sitemap.xml` lists all 15 public URLs; `llms.txt` is the summary for AI assistants.
- IndexNow: Aaron sets `npx.cmd wrangler secret put INDEXNOW_KEY` (32 letters/digits); the Worker then serves `/<key>.txt`.

## Deploy (from Aaron's PC, needs his typed OK)

1. `npx.cmd wrangler kv namespace create ACCOUNTS` and put the id in `wrangler.toml` (replaces `REPLACE_AT_DEPLOY`).
2. Aaron sets `npx.cmd wrangler secret put SHOPIFY_WEBHOOK_SECRET` (CONSOLE_KEY is already set).
3. `npm run check`, `npm test`, `npm run test:ui`, then `npx.cmd wrangler deploy`.
4. When the Platinum subscription product exists on the Charleston3D store: put its ids in
   `lib/shop-config.mjs`, add an `orders/paid` webhook to `https://epix3d.com/api/shopify/webhook`, and deploy again.
