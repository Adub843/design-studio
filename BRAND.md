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

The wordmark is Fredoka SemiBold turned into outlines, so the files look the same without the font.

## Colours

| Token | Hex | Use |
|---|---|---|
| Ink | `#23203a` | Text, dark buttons, the Platinum card |
| Cream | `#fff8ef` | Page and studio background |
| Paper | `#fffdf9` | Cards and fields |
| Sand | `#f8efe1` / `#f3e8d6` | Raised panels, hover |
| Line | `#eadfcd` | Borders |
| Muted | `#5e5a73` | Secondary text |
| Tangerine | `#ff6b3d` | The main action (Order a print, Export, Go Platinum) and the mark |
| Sun | `#ffc23d` | Highlights, Platinum badge text |
| Mint | `#23b5a0` | Success, second accent |
| Berry | `#e84a7f` | Maker tone |
| Sky | `#4c7cf3` | Maker tone, links in focus |

Each maker has a tone (its dot in "All makers" and on its card): see `site/makers.json`.

## Type

- Headings: **Fredoka** 600.
- Everything else: **Inter** 400 to 700.

## How the makers share the look

- `assets/epix-theme.css` maps every maker's own colour variables onto these tokens. Each maker page has
  `<html data-maker="...">` and loads it in its `<head>`.
- `assets/epix-bridge.js` / `.css` add the same EPIX3D bar to every maker: logo, **All makers** switcher,
  Save, Order a print, account and the Platinum gate on downloads.
- A new maker goes in `makers/<id>/`, gets `data-maker`, the theme link, the `#epix-bar` slot (or a
  `[data-epix-switch]` slot in its own bar), `window.EPIX_MAKER` and the bridge script, plus a card in
  `site/makers.json`. Nothing else is needed for it to show up everywhere.
