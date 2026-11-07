# Design Studio

The 3D design side of the business: Maker Studio and the Charleston 3D and EPIX3D art libraries.
**epix3d.com is for 3D designs only. Nothing here has anything to do with shirts** (Aaron, 2026-11-07).
Shirt design lives only in the Business Console and the Elevated Designs shirt app (design.elevatedshirts.com).
The studio shares the console's image namespace, but Elevated Designs (shirt) art never shows here and
can't be read, changed or deleted from here.

It lives at **https://epix3d.com** (and www.epix3d.com). The backup address is
https://design-studio.business-console.workers.dev.

The **Go to** button in the top bar of every page opens the main console, the Charleston 3D shop and app,
the accounts and connections map and the Master Links sheet. The same links are in the search palette.

## What's in it

- **Home:** the numbers for the chosen brand, the newest art, and one card per brand when both are showing.
- **Maker Studio** (`makers/index.html`, a copy of the console's `tools/maker-studio/`): one page with a tab for
  every 3D maker: Nameplate, Hype chain, Light box & keychain (a copy of the console's `tools/maker/index.html`
  with a back bar) and License plate. Each builds Bambu-ready files in the browser.
- **Library:** search, filter (all, public, private), sort and categories, with a details
  panel to rename, move to another brand, tag, download or delete.
- **E: drive:** the Charleston 3D 3D models and files on Aaron's E: drive, while his PC is on.
- **Top bar:** the brand switcher (All, Charleston 3D, EPIX3D), search that jumps to
  any page, brand, action or image (press `/`), and Unlock for the studio key.

### How the layout was put together

It takes the strongest part of each of the top-ranked dashboards from the research:

| From | What it gives the studio |
|---|---|
| shadcn blocks, Linear | Quiet sidebar that collapses to icons, with one primary action ("New design") |
| Shopify Polaris | Brand switcher in the top bar, page headers with actions on the right, a side panel for details |
| Command palettes (Linear, Polaris) | One search box for pages, brands, actions and images, opened with `/` |
| Tabler | Stat tiles and quiet cards |
| Shopify Files | Asset cards on a light checkerboard, so dark art stays visible in dark mode |

## Brands

The studio works with two brands: `c3d` and `epix3d`. Images in the shared namespace marked `ed` (and old
images with no brand, which count as `ed`) are Elevated Designs shirt art and are left out of everything here.
The switcher narrows the studio to one brand. New uploads go to the chosen brand, or to EPIX3D when both are
showing, and are always private. Charleston 3D art is never public.

## API

| Call | Key? | What it does |
|---|---|---|
| `GET /api/images?public=1[&brand=epix3d]` | no | The public Charleston 3D and EPIX3D art |
| `GET /api/images` | yes | Every image, with signed links for private ones |
| `GET /api/images/:key` | public, signed link, or key | One image file |
| `POST /api/images` | yes | Upload one image (`x-filename`, `x-brand`, `x-tags`, `x-category`), private |
| `PATCH /api/images/:key` | yes | Change name, tags, category or brand |
| `DELETE /api/images/:key` | yes | Delete one image |
| `GET /api/drive/search`, `/stats` | yes | The E: drive's Charleston 3D files |

The key is sent as `x-console-key` and is the same `CONSOLE_KEY` secret the Business Console uses.

## Run and test

```
npm install
npm run check        # syntax check every file
npm test             # API tests
npm run build && npm run test:ui   # browser test at 1280 and 390 wide, light and dark
npm run dev          # local Worker at http://localhost:8787
```

## Deploy (from Aaron's PC)

1. In the repo folder: `npm install`, then `npm run check` and `npm test`.
2. The first time only, Aaron sets the key himself: `npx.cmd wrangler secret put CONSOLE_KEY`
   (the same value as the console's).
3. `npx.cmd wrangler deploy`.

`wrangler.toml` declares epix3d.com and www.epix3d.com as custom domains, so a deploy keeps them.
