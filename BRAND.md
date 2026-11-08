# EPIX3D brand

EPIX3D (epix3d.com) is one online 3D print studio: every maker lives on this one site, behind one free
account, with one Platinum membership. No maker gets its own link, app or QR code.

## Name and voice

- Always **EPIX3D** (capitals, no space). The site is **epix3d.com**.
- Friendly, plain and short. Say what a thing does ("Your name on a small two-colour badge"), not how
  clever it is. Made in Charleston, SC.
- Free: design, save and order prints. Platinum ($15 a month): download 3MF and STL from every maker.

## Logo files (`assets/brand/`)

| File | Use |
|---|---|
| `epix3d-logo.svg` / `.png` | The main logo, mark plus wordmark, on light backgrounds |
| `epix3d-logo-light.svg` | The same on dark backgrounds (cream wordmark) |
| `epix3d-mark.svg` / `.png` | The mark alone: app icons, favicons, stickers, profile pictures |
| `epix3d-qr.svg` / `.png` | The one QR code, to https://epix3d.com (checked: it decodes at 200 to 1024 px) |

The mark is an ink tile with a cube (white top, grey and accent sides). The wordmark is Segoe UI Bold turned into outlines, so the files look the same without the font. Redrawn 2026-11-08 when the site moved to a professional look (CLAUDE.md rule 19).

## Look (2026-11-08)

Professional and calm, like a real product site: a neutral palette, one accent, one UI font, real or
photoreal product photos. No blobs, cartoon shapes, emoji, pills or playful display fonts (CLAUDE.md rule 19).

| Token | Hex | Use |
|---|---|---|
| Ink | `#15171c` | Text, the main buttons (Start designing, Order a print, Export), the logo tile |
| White | `#ffffff` | Page, cards, fields, the maker bar |
| Sunk | `#f5f4f1` / `#eeece8` | Bands, the footer, raised panels, hover |
| Line | `#e6e4df` / `#d4d1ca` | Borders and dividers |
| Muted | `#5d636f` | Secondary text |
| Accent | `#e0512a` | Small labels (kickers, step numbers) and the cube's side in the mark. Never a large fill. |
| Focus | `#2f5bd3` | Focus rings |

## Type

- **Inter** (400 to 700) for everything, headings included (weight 650, tight letter spacing).

## Photos

- `assets/img/hero.jpg`, `assets/img/print-at-home.jpg` and `assets/img/makers/*.jpg` are photoreal product
  photos made in Kittl (GPT Image 2.5, 2026-11-08): real-looking prints with visible layer lines in natural light.
  Replace any of them with a real photo of the same piece when one exists. 1200 x 800 JPEG for maker cards.

## How the makers share the look

- `assets/epix-theme.css` maps every maker's own colour variables onto these tokens. Each maker page has
  `<html data-maker="...">` and loads it in its `<head>`.
- `assets/epix-bridge.js` / `.css` add the same EPIX3D bar to every maker: logo, **All makers** switcher,
  Save, Order a print, account and the Platinum gate on downloads.
- A new maker goes in `makers/<id>/`, gets `data-maker`, the theme link, the `#epix-bar` slot (or a
  `[data-epix-switch]` slot in its own bar), `window.EPIX_MAKER` and the bridge script, plus a card in
  `site/makers.json`. Nothing else is needed for it to show up everywhere.
