# Design Studio

The design side of the business: every brand's art library and the shirt designer, in one place.
The Business Console keeps the business side (products, insights, marketing, promotions). Both read and
write the same image library, so a design saved here is ready to list from the console and shows in the
shirt apps when it's marked public.

It lives at **https://epix3d.com** (and www.epix3d.com). The backup address is
https://design-studio.business-console.workers.dev.

The **Go to** button in the top bar of every page opens the Business Console, both shops, both apps,
the accounts and connections map and the Master Links sheet. The same links are in the search palette.

## What's in it

- **Home:** the numbers for the chosen brand, quick-start tiles that open the designer on a real blank,
  the newest art, and one card per brand when all brands are showing.
- **Shirt designer:** the product editor from the console (tool rail, canvas on a real shirt photo,
  properties). It exports a 300 dpi print file and a mockup photo, and saves designs to the library.
- **Library:** search, filter (all, in the shirt apps, private), sort and categories, with a details
  panel to rename, move to another brand, tag, show in the shirt apps, download or delete.
- **Top bar:** the brand switcher (All, Charleston 3D, Elevated Designs, EPIX3D), search that jumps to
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
| Canva, Printful | Full-height editor with a tool rail, canvas and properties; a bottom bar on phones |

## Brands

Every image belongs to one brand: `c3d`, `ed` or `epix3d` (images from before brands existed count as
`ed`). The switcher narrows the whole studio to one brand. New uploads go to the chosen brand, or to
Elevated Designs when all brands are showing.

Charleston 3D art is never public, so it can't reach an Elevated Designs shirt app. The server enforces
this on upload and on every change, and the page turns the option off.

## API

| Call | Key? | What it does |
|---|---|---|
| `GET /api/images?public=1[&brand=ed]` | no | The public art the shirt apps use |
| `GET /api/images` | yes | Every image, with signed links for private ones |
| `GET /api/images/:key` | public, signed link, or key | One image file |
| `POST /api/images` | yes | Upload one image (`x-filename`, `x-brand`, `x-tags`, `x-public`, `x-category`) |
| `PATCH /api/images/:key` | yes | Change name, tags, category, brand or public |
| `DELETE /api/images/:key` | yes | Delete one image |
| `GET /api/library-sync` | no | When the console's Kittl sync last ran |

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
