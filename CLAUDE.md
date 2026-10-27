# CLAUDE.md: Aaron's rules for every Claude session and agent

**Read this whole file before doing anything.** Every rule here comes from Aaron's own messages in this project (2026-10-25 and 2026-10-26). If a rule here and your habit disagree, this file wins. If you break one of these rules, Aaron has to correct you again, and that costs him time and money.

- Owner: Aaron Lewis (GitHub `Adub843`).
- Businesses: Elevated Designs LLC (shirts) and Charleston3D (3D printing, a DBA of the LLC). Both are in Charleston, SC.
- Last updated: 2026-10-26, compiled from every project thread, project memory, the audit, the recheck report and the skills catalog.

---

## 1. Hard rules: never break these

1. **Nothing may look fake.** Aaron, 2026-10-26: *"that look way too fake ... make this look professional a real app not some bs"*, and *"even the shirt looks stupid the shirt should look real"*. He has had to repeat this. It applies to every site, app, mockup and graphic.
   - Shirts are **real product photos** of the actual blank (flat lay or ghost mannequin) in the chosen color. The design is blended into the fabric (multiply or displacement) the way Printful and Custom Ink do it. **Never draw a shirt in SVG, CSS or canvas.**
   - Editors look like real product editors: Custom Ink Design Lab, Printful's designer, Canva. That means a left tool rail, a center canvas and a right properties panel, with a clean bottom bar on phones, a restrained palette and one quality UI font.
   - Nothing toy-like: no neon gimmicks, emoji, cartoon shapes, cheap clip art, stock-looking "ideas", fake badges or placeholder text.
   - **Before showing Aaron anything visual,** screenshot it at desktop (1280) and phone (390) widths and compare it side by side with those reference products. If it doesn't hold up, it isn't done.
2. **Never Netlify, for anything.** Aaron: *"i dont want anything we are doing ever more or this project on netlify"*. Stores run on Shopify. Apps run on GitHub Pages. The console and any backend or storage run on his Cloudflare account.
3. **Charleston3D and Elevated Designs are always separate.** Aaron: *"charleston3d and elevated designs should be separate always"*. They have separate stores, themes, repos, keys, keywords, copy, logos and links, and no file for one brand names the other. (EPIX3D is a label of Elevated Designs, so it's allowed to use ED checkout.)
4. **All payments go through Shopify checkout.** No Stripe and no other payment service.
5. **Check everything three times:** code, links and the live site. Aaron: *"delegate the tasks and check the work 3 times minimum so we can get this done fast and correct the first time"*.
6. **Don't send previews or check-ins.** Aaron: *"dont show me fix all them then tell me quit wasting time and tokens"*. Finish, triple-check, then send **one short report**.
7. **Do the setup yourself.** Aaron: *"you do this"* / *"you do it"*. Only ask him for what truly needs him: signing in, paying, typing a secret, or approving a production change.
8. **Never handle secrets.** Aaron types keys and passwords himself, in the Cloudflare dashboard, `wrangler secret put` or a hidden prompt. Never ask for them in chat, and never write them to a file, memory, log or repo.
9. **Get Aaron's typed OK before anything that can't be undone.** That includes publishing a theme, a production deploy, making a repo public, bulk price changes on live products, deleting, DNS changes, and messaging a customer. A card tap doesn't count for live actions run on his PC.
10. **Never invent prices.** Prices come only from the price sheet (section 6).
11. **Show only the city on the sites:** Charleston, SC. Never a street address or phone number.
12. **Don't put work labels in names people see** ("polish", "test", "v2", "draft" in a theme name and so on).
13. **Marketing fixes have standing approval.** Aaron: *"if there is any updates or adjustments to the settings or keywords or anything that the research shows needs to be done then the responsible agent should do that immediately"*. This applies to both sites and the console. Log every change (before and after) so it can be undone.
14. **Read memory and this file before choosing infrastructure, hosting or a design approach.** Repeating a mistake (Netlify, a fake look, mixing brands) is what upsets Aaron most.
15. **Don't waste his usage.** Don't redo work, re-ask settled questions, poll, or write long replies. If you're unsure, start on the most likely reading and say which one you chose.
16. **Never say "done" unless you checked it live yourself:** the live site, store, app or console, not another thread's report.
17. **No personal Gmail as a public contact** on any site. Use hello@charleston3d.com (ImprovMX), hello@elevatedshirts.com (forwarding) or the store contact form.

## 2. How Aaron wants to work

- Fast, delegated and correct the first time. Clean, tested code.
- Replies are short and plain, and lead with the result. Write anything long as a file.
- Both sites stay published and live, even with empty pages. He fills them from the console.
- *"Keep it simple"*: one big system, organized and self-contained, with nothing spread out or lost.
- Everything has to be portable, because work is moving to OpenClaw on a Beelink SER9 Pro (section 11).
- Files for Aaron go on his Desktop (`C:\Users\lewis\OneDrive\Desktop`) and in project files.

## 3. The system: one big system

| Piece | Address | Repo | Hosting |
|---|---|---|---|
| Charleston3D store | charleston3d.com | Adub843/charleston3d-site (live branch `claude/shopify-theme`, connected to Shopify GitHub) | Shopify, custom hand-coded OS 2.0 theme |
| Elevated Designs store | elevatedshirts.com | Adub843/elevated-designs-site (theme uploaded by hand until GitHub is connected) | Shopify, custom theme |
| ED shirt app | design.elevatedshirts.com | Adub843/elevated-shirt-app (public export) + elevated-shirt-app-private (source with costs) | GitHub Pages |
| EPIX3D shirt app | epix3d.com | Adub843/epix3d-shirt-app | GitHub Pages (repo must be public for free Pages) |
| Charleston3D order app | app.charleston3d.com | Adub843/charleston3d-app | GitHub Pages |
| Business Console | business-console.business-console.workers.dev | Adub843/Business-console | Cloudflare Worker + KV |
| Backups | n/a | elevated-designs-legacy, cloudflare-sites (14 old Cloudflare sites), elevated-shirt-app-private | GitHub (private) |

What each piece does (Aaron's design):
- **Charleston3D site:** all 3D work. A shop, plus a Custom tab where people request items by text, file or photo. Aaron chooses which shop items can be customized, because some files can't be.
- **Elevated Designs site:** one website. One click in the console lists a design for sale, with description, SEO and mockups made automatically. Shirts are shown in categories that update when new shirts are added.
- **Shirt apps:** standalone, shared by QR code. People build their own shirt from the library (SVG, PNG, DTF-ready art) or their own upload. Uploads can be edited to the best quality and made DTF-ready, including halftone removal. The apps have full tools ("don't skimp on the tools", for both apps). Orders and payment go through the ED Shopify store, and each order carries the images, shirt color, size and print dimensions. Shirt choices come from the brands ShirtSpace and BulkApparel carry, so customers can pick a cheaper shirt.
- **C3D order app:** a Shop tab, plus one Request page for unlisted items and custom prints (2 photos/PDF + 1 STL/3MF/OBJ/STEP, 20 MB each). Requests come in as a $0 "Custom request" order.
- **Console:** the back office. It publishes to both sites, controls Products and the Customizable switch, and runs the image library: uploads go to the shirt app library automatically when "Show in shirt builder" is ticked. It also has Insights and forecasts, a Marketing page (SEO/GEO/Bing/AI checks, change log with Undo, growth charts, keywords, daily safe fixes with auto-undo), a Promotions page (Shopify discounts, gift cards, segments, campaigns), Google Search Console, a Service Map/topology, and the shirt price sync.
- **Each site** has a "Get the app" button in the header and footer that goes to its own brand's app.

How it connects:
- Shirt app checkout is a cross-site multipart form POST to `https://elevatedshirts.com/cart/add`. It sends a 300 DPI PNG print file (with a pHYs chunk) per side, plus the mockup and design ID as line-item properties, capped at 20 MB each.
- The blank shirts are the ED `builder-blanks` collection: 23 products and 2,399 variants, published 2026-10-26. Feed: `elevatedshirts.com/collections/builder-blanks/products.json`.
- The shirt apps read art from the console: `GET /api/images?public=1`, with CORS limited to the app domains.
- The C3D app's catalog is rebuilt from `charleston3d.com/products.json` by GitHub Actions.

## 4. Brands and look

- **Charleston3D:** Charleston Rainbow Row look, with navy, sand and brass plus teal and the Rainbow Row pastels. Logos: #4 is the main wordmark ("3D" in teal), #1 Rainbow Row is the hero, #3 is the badge (stickers and packaging), #2 the print cube is the icon and app icon.
- **Elevated Designs:** logo #7 colors only, never charcoal. Navy #15223f, ink #1f2638, muted #4d5568, cream #f7f2e8, gold #b8892a, buttons #8c6f2b. Logo #7 is the main logo and #5 the seal (tags, labels).
- **ED shirt app icon:** #8. **EPIX3D:** an ED label with a neutral, fun title. Never call it "urban and geometric".
- **Console:** in ED colors (navy, cream, brass). C3D items keep their teal.
- **SEO/GEO/Bing/AI crawlers** are built into everything. The reference site is elitebenzsolutions.com.
- Logo and art files live in Kittl (IDs in project memory `brand-kit`). Print art with text is generated with a transparent background, because Kittl's background removal erases thin text.

## 5. Domains and DNS

- **charleston3d.com:** DNS at **Wix**, and it stays there (DNSSEC is tied to WHOIS privacy). Mail is ImprovMX, hello@ forwarding to Gmail. Auto-renew is OFF.
- **elevatedshirts.com:** ED primary domain. Nameservers are Google Domains/Squarespace. `design` CNAME → adub843.github.io.
- **epix3d.com:** at Wix. A @ 185.199.108–111.153, CNAME www adub843.github.io. **Auto-renew is OFF; remind Aaron to turn it on.**
- **app.charleston3d.com:** CNAME → adub843.github.io (in Wix).
- Spare Wix domains: eastbay3d.com, holycity3d.com, harborcity3d.com, holycitylaser(co).com.

## 6. Prices

- Price sheet (the only source): https://docs.google.com/spreadsheets/d/11G7MyaGqSaz3WCd21etMYc-YebpAbyKzmvE1aqNWpy8/edit
- Blank shirt = 100% markup on cost + $8 print fee, rounded up to .99.
- Design tees = sheet price + $10.
- The console syncs ED prices every 15 minutes and never touches Charleston3D.
- Old sheet `1F14P11...` is retired. Don't use it.

## 7. Tools and connectors used, by task

| Task | Tools that were used |
|---|---|
| Store data, products, prices, collections, pages, redirects, SEO fields | **Shopify MCP connector** (`graphql_query` / `graphql_mutation`, productSet, stagedUploadsCreate, collectionCreate, pageCreate, urlRedirectCreate, themeFilesUpsert). It's signed into ONE store at a time. `switch-shop` signs it out, so tell Aaron first. It blocks themePublish, themeDelete and bulk operations, so Aaron presses Publish. |
| Theme code | Hand-coded Liquid in GitHub. Test with the liquidjs render harness, tests/liquid-strict.js, `shopify theme check`, Playwright e2e and screenshots, the WCAG contrast audit, and tests/schema-check.py before upload. |
| DNS for charleston3d.com and epix3d.com | **Wix MCP connector** (account DNS API) |
| Console deploy, KV, crons, secrets | Cloudflare Workers + KV with **wrangler**, run on Aaron's PC (`npx.cmd wrangler deploy` in `Desktop\business-console`). The Cloudflare MCP connector is used for reads. |
| Code, PRs, Pages, Actions | **GitHub MCP connector** (branches, PRs, Actions logs). Sessions can't create repos, so Aaron creates them. Free Pages needs a public repo. |
| Art library, logos, mockups | **Kittl MCP connector** (list, upload, render-mockup, vectorize, upscale). Imports go through console `scripts/import-kittl.mjs` (Desktop "Run Kittl import.cmd"; Aaron types the console key). |
| Price sheet, docs | **Google Drive connector.** Share files with Aaron's Gmail as an editor. |
| Live site checks, logged-in admin pages, supplier sites | **Claude in Chrome** on Aaron's browser. The cloud sandbox can't reach elevatedshirts.com, workers.dev, github.io, kittl or supplier sites. |
| Work on Aaron's PC (deploys, Desktop files, imports) | **Remote Control session** on NUC_SKULL, folder `C:\Users\lewis\OneDrive\Desktop`. |
| Pages Aaron reads (plans, guides) | Artifacts and Claude Docs. Homelab guide: https://claude.ai/artifact/4rLU2zPruvm9FpsM7N7iMY |
| Browser testing in the cloud | Playwright with the pre-installed Chromium, at 1280 and 390 widths. |
| QR codes and cards | Python QR generation, then decode every file to verify it. Files are in project files `qr-codes/` and `business-cards/`. |
| SEO and marketing | `seo-toolkit/` scripts (seo-audit.mjs, sitemap-check.mjs, indexnow-submit.mjs), JSON-LD templates, keyword lists, the console Marketing and Promotions pages, Google Search Console, Bing Webmaster, GA4 and IndexNow (one key per store). Holo (likely tryholo.ai) is still unconfirmed by Aaron. |

## 8. Skills (load the matching one before the task)

The skills live in project files `agent-skills-catalog/skills/` and on the Desktop in `Business Handoff\04 Skills\skills\` (22 SKILL.md files). The full table is in `skills-catalog.md`.

- **Build and review:** shopify-theme-build, shopify-theme-review, shopify-theme-upload, github-branch-pr, triple-check-review, chrome-browser-check, cloudflare-worker-deploy
- **Catalog:** shopify-product-bulk-upload, price-sheet-to-shopify, listing-copy, kittl-library
- **SEO and marketing:** seo-audit, local-geo-seo, indexnow, marketing-report, site-health
- **Operations:** order-triage, daily-brief, deadlines, market-calendar, repo-backup, qr-code-cards

**OpenClaw agents** (`Business Handoff\03 Agents\AGENT-ROSTER.md`): `ops` (coordinator), `c3d`, `ed`, `marketing`, `builder` (heavy work, runs on Claude Code) and `admin`. Each agent gets only its own skills plus triple-check-review.

**Runbooks** (`Business Handoff\05 Runbooks\RUNBOOKS.md`): list a design, change prices, answer a custom request, change a theme, deploy the console, add a DNS record, site down, restore from backup, rotate a leaked key, monthly SEO check, QR codes.

## 9. Scheduled jobs

| Job | Where | When |
|---|---|---|
| Marketing site check | Console cron | 11:00 UTC daily |
| Marketing safe fixes (auto-undo if visits drop 30%+ within 14 days) | Console cron | 11:30 UTC daily |
| Shirt price sync | Console cron | every 15 min |
| C3D app catalog refresh | GitHub Actions (charleston3d-app) | every 15 min |
| ED shirt app catalog refresh | GitHub Actions (elevated-shirt-app) | hourly |
| Market calendar refresh | OpenClaw (rebuilt; it was lost with old chats) | Jan 5 and Aug 1 |

## 10. Known gotchas

- In Shopify `productUpdate`, sending seo `{title}` alone **clears** the description. Always send both.
- Shopify rejects select option labels over 50 characters. Run tests/schema-check.py before any theme upload.
- Never upload `config/settings_data.json` to a live theme, because the live store holds settings such as shirt_app_url.
- Shopify's Liquid is stricter than liquidjs: no curly brace inside a quoted string in an output tag.
- The ED admin URL handle is "charleston3d" even though it's the ED store. C3D = nu2xws-gy.myshopify.com, ED = xzqxnd-er.myshopify.com.
- The console Admin API is pinned to 2025-10.
- The ED store still holds a "Charleston 3D Prints" collection (brand mix, raised with Aaron). Don't add to it.
- Secret files exist on the PC (etsy-secrets.log, a Google client_secret JSON). Never open, copy or back them up.
- Free GitHub Pages needs a public repo. The ED shirt app is a public export of a private source.

## 11. PC and future plan

- PC: NUC_SKULL (Windows 11). Aaron's files are in `C:\Users\lewis\Aaron-Data` (01 Charleston3D … 07 Archive). Handoff package: `Desktop\Business Handoff`. Business license packet: `Desktop\Business License`. Master Document (the sign document): `Desktop\Business License\Master Document - Elevated Designs & Charleston3D.xlsx`. An older copy is in `Aaron-Data\07 Archive\Creative Lab Studios HQ (19 Oct snapshot)\06 Company`.
- **Never reformat the E: drive** (Samsung T9, Aaron's data).
- This week: move routine work to OpenClaw with a local model on a Beelink SER9 Pro, and train local agents on these tasks and skills. Claude stays for research and heavy builds.
- NUC_SKULL becomes a Proxmox homelab server, but only after the Beelink takes over console deploys. Anything exposed publicly goes through Cloudflare (Tunnel, R2), never Netlify.

## 12. Open items (as of 2026-10-26 14:30Z)

- **Shirt apps:** rebuild both to the real-photo standard in rule 1 (paused until Aaron says "go").
- **epix3d.com:** goes live once the repo is public and Pages is on.
- **Domains:** Aaron turns on auto-renew for epix3d.com and charleston3d.com.
- **Console:** Aaron adds the store app scopes and the marketing secrets (IndexNow keys, Bing, GSC service account).
- **Holo:** waiting on Aaron to confirm which Holo he means.

## 13. Details for Aaron's PC and console access

- **Console store access** uses Shopify Dev Dashboard apps with client credentials (`C3D_CLIENT_ID`/`C3D_CLIENT_SECRET`, `ED_CLIENT_ID`/`ED_CLIENT_SECRET`). New apps no longer get `shpat_` tokens. Other secret names: `CONSOLE_KEY` (16+ characters), `C3D_INDEXNOW_KEY`, `ED_INDEXNOW_KEY`, `BING_WEBMASTER_API_KEY`, `GSC_SERVICE_ACCOUNT`, `BUILDER_ORIGINS`, `DESIGN_MARKUP` (default 10). Values live only in Cloudflare (Workers > business-console > Settings > Variables and Secrets), and Aaron types them himself.
- **Before a console deploy,** check that the branch in `Desktop\business-console` contains every merged PR (#5 Marketing, #6, #7 polish and price fix, #8 epix3d origins), or features drop out. Until the PRs are merged, every repo's `main` is only "Initial commit", so check which branch is live before deploying.
- **Still in `C:\Users\lewis\Documents`** because Windows scheduled tasks run them: bodycam-finder (Released Footage App, Autopilot and Retry), video-studio, funny-video-clips, hype-chain-orders-sync. Move them only together with their tasks.
- **Don't touch** `Desktop\3D g's`.
- **Code backups:** `Desktop\Business Handoff\07 Code Backups` has git bundles of every repo plus the legacy project. Restore steps are in runbook 8.
- **OpenClaw drop-in:** `Desktop\Business Handoff\06 OpenClaw Setup`. It has SETUP-GUIDE.md, install-windows.ps1, register-agents.ps1 and automations.ps1 (11 automations). Aaron chats with the `ops` agent over Telegram. The local model runs in LM Studio, with Claude Code as the fallback.

## 14. Keeping this file current

- There is one version only. When Aaron gives a new rule, add it here in the same turn, then copy the file to all of these:
  - `C:\Users\lewis\OneDrive\Desktop\CLAUDE.md`
  - `C:\Users\lewis\.claude\CLAUDE.md`
  - `Desktop\Business Handoff\CLAUDE.md`
  - every OpenClaw workspace
  - each repo's `CLAUDE.md` (repo copies leave out account emails and add a short "This repo" section)
- Never put secret values in any copy.

## This repo: design-studio

- The Design Studio: one Cloudflare Worker (`design-studio`) with static assets, for every brand's art and the shirt designer. Aaron chose one studio for all brands (2026-10-27), with a separate library per brand: every image carries `brand` (c3d, ed or epix3d; old images count as ed).
- It shares the console's IMAGES KV namespace (`a4c25d0fee6e45448ada053a44b19bcc`), so designs saved here show up in the console and the shirt apps. Charleston 3D art can never be public, so it never reaches an Elevated Designs shirt app (enforced in `lib/images.mjs`).
- The studio key is the same `CONSOLE_KEY` secret as the console. Aaron sets it himself with `npx.cmd wrangler secret put CONSOLE_KEY`.
- The Kittl sync cron stays in the console; the studio only reads its result (`sync:kittl`).
- Deploy by hand from Aaron's PC: `npx.cmd wrangler deploy` in the repo folder, after `npm run check`, `npm test` and `npm run test:ui` pass. A production deploy needs Aaron's typed OK.
- epix3d.com is not connected yet: the custom domain in `wrangler.toml` stays commented out until the epix3d.com nameservers move from Wix to Cloudflare (needs Aaron's typed OK).
