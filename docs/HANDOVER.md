# Patternly Handover

_Living document. Updated in the same commit as every build (see CLAUDE.md). Last updated 2026-10-29 by Claude for Cristian._

## What Patternly is

Patternly is Luca-S LTD's cross-stitch app: a pattern **Editor**, a **Stitch Tracker** for working a chart on screen, and a **Partner Studio** where brands publish their own kit patterns. Cristian (lucasukinfo@gmail.com) is the sole owner and developer; Claude ships builds straight to GitHub. The Patternly chat is Patternly-only — anything about the Luca-S Hub, Finance Hub, Product Hub or shops belongs in its own chat.

| Surface | Who uses it | Where | What it does in one line |
| --- | --- | --- | --- |
| Editor (`index.html`, landing + app) | Stitchers, anyone | luca-s.com/apps/patternly (web), iOS + Android app | Draw/convert charts, export PDF; Plus members sync their designs |
| Stitch Tracker (inside `index.html`, `#tracker`) | Kit customers | Same page, "Tracker" | Open a Luca-S / partner kit (by purchase, access code or QR), upload own chart, restore a backup, or **Scan Your Pattern (BETA)**; mark stitches; progress syncs to the account |
| Partner Studio (`brands.html`) | Luca-S team (owner + staff) and partner brands (pilot: HobbyJobby, prefix HJ) | luca-s.com/apps/patternly/brands | Publish kits, QR/access codes, customers, revenue, push notifications, team users |
| Middleware (`functions/_middleware.js`) | Everything above | Cloudflare Pages Functions behind the Shopify App Proxy | Auth, catalogue, entitlements, progress sync, Plus, partners, push, email |
| Patternly Plus | Paying customers | Shopify (web) + RevenueCat (iOS/Android) | £2.98/month, £23.98/year base; €1.99/€17.99 reduced tier for lower-income countries; entitlement `plus` |

## Where everything lives

Two GitHub repos under the **Patternly** organisation are the source of truth; Cloudflare Pages deploys the web repo on every push to `main`, and the app repo is built by GitHub Actions `android-release.yml` (Android; PC as fallback) and Codemagic (iOS).

| Thing | Where / account | Notes |
| --- | --- | --- |
| Public web app | https://luca-s.com/apps/patternly | Shopify App Proxy on the Luca-S store → Cloudflare Pages project (custom domain `patternly.design` in `CNAME`; raw `*.pages.dev` is signed-out only) |
| Partner Studio | https://luca-s.com/apps/patternly/brands | `brands.html` at repo root |
| Web repo | github.com/Patternly/Patternly (`main`) | `index.html`, `brands.html`, `functions/_middleware.js`, `CNAME`, `docs/HANDOVER.md`, `CLAUDE.md` |
| App repo | github.com/Patternly/patternly-app (`main` = 1.5 since 29 Oct, `release-1.5` merged; branch `store-results` written by Actions) | Capacitor project, `www/index.html` = copy of the editor |
| Cloudflare | Pages project for the web repo; KV namespaces (ENTITLEMENTS, PARTNERS, USER_PATTERNS, EDITOR_PATTERNS), R2 bucket bound as PATTERNS | Secrets/env set by Cristian in the Pages project settings (names in the Backend section) |
| Shopify | Luca-S store (shop id 64819790053), Customer Account API OAuth client, App Proxy `/apps/patternly` | Plus also sold as a Shopify subscription product on web |
| Apple | Team ID 466D5X6AYU, bundle `com.lucas.patternly`, App Store id 6795543177, App Store Connect API key (App Manager role) | iOS 1.4 live; builds via Codemagic workflow `ios-release` (integration "UK Luca-S LTD") |
| Google Play | package `com.lucas.patternly`, service account `claude-play` in GCP project Patternly-Android (testing tracks, production release, store presence, reviews, financial read; confirmed in Play Console 30 Oct). Claude promotes to Production only when Cristian says so | Play 1.4 (versionCode 9) in production; target/compile SDK 36 already |
| RevenueCat | Products `patternly_plus_monthly` / `patternly_plus_yearly`, entitlement `plus`, offering `default`; webhook → `/iap/webhook` | iOS/Android Plus purchases and the Studio revenue tab |
| Firebase | Project "Patternly" (FCM for Android push) | Service-account JSON in Cloudflare only |
| APNs | Key in Cloudflare (`APNS_KEY_ID/TEAM_ID/KEY_P8`) | iOS push |
| Resend | Account Cristian already had; sending-only key for Patternly; sender `Patternly <patternly@luca-s.com>` | Studio invitations, set-up links, password resets |
| GitHub Actions (app repo) | `push-auto.yml` hourly cron → middleware auto-notifications; `store-api.yml` runs `store/requests/*.json` against App Store Connect / Play and writes results to branch `store-results`; `android-release.yml` builds + signs the AAB and uploads it to a Play testing track (Run workflow button or `store/release-android.json`; steps in patternly-app `docs/ANDROID_RELEASE_CI.md`) | Secrets: `PUSH_CRON_KEY`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `PLAY_SA_JSON`, `CODEMAGIC_API_TOKEN`; Android signing: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_GOOGLE_SERVICES_JSON` |
| Scan harness | `tools/scan/` in this repo: `extract.sh` (engine out of `index.html`), `torgba.py`, `colour_run.js` (colour key + chart page from the command line, writes a side-by-side picture), README | Test photos are not in the repo; Riolis 2289 photos are in the project files `scan-tests/riolis-2289/`. Older prototypes lived only in session scratchpads and are gone |

## Code map

Current versions: **editor v652** (website and patternly-app `www/`), **middleware v101**, **Studio v51**, app **1.4** live in both stores (iOS build 3 / Android versionCode 9); app repo `main` = **1.5** (Android versionCode 10, iOS MARKETING_VERSION 1.5), not yet built. Every build bumps its version constant; never re-issue a version with different contents.

| File | Size | What it is | Version constant |
| --- | --- | --- | --- |
| `Patternly/index.html` | 34,566 lines, 2.8 MB | The whole web app: landing pages, Editor, Tracker, converter, calculators, account/Plus, i18n table (`T` with en/fr/de/nl/ru/uk/es/it), Capacitor glue, scan engine. Single file by design. | `PATTERNLY_BUILD='v652'` (shown in Account footer and console) |
| `Patternly/brands.html` | 4,897 lines, 750 KB | Partner Studio: landing/apply, sign-in, tabs (partner: Overview, My Patterns, Converter, My Customers, My Account; owner: Overview/revenue, Brands, Patterns, Converter, Customers, Branding, Users, Notifications). Contains the full converter as base64 blob iframe (`CONV_B64`). | `/* v51 */` comments; no constant |
| `Patternly/functions/_middleware.js` | 4,836 lines | Cloudflare Pages Function: every API route, auth, storage, email, push, revenue | `MW_VERSION = "v101"` (reported by `/whoami`) |
| `Patternly/CNAME` | — | `patternly.design` custom domain | — |
| `patternly-app/www/index.html` | copy | Exact copy of the editor committed after every editor build ("www: editor vNNN") | same |
| `patternly-app/capacitor.config.json` | — | appId `com.lucas.patternly`, webDir `www`, `adjustMarginsForEdgeToEdge: disable`, PushNotifications presentation options | — |
| `patternly-app/android/` | — | Gradle project; `variables.gradle` SDK 36; `AndroidManifest.xml` has CAMERA permission + camera feature (required=false) for Scan; R8 minify/shrink + `EdgeToEdge.enable` (1.5) | versionCode 10 / 1.5 on `main` |
| `patternly-app/ios/App/` | — | Xcode project, `App.entitlements`, `Info.plist` (NSCameraUsageDescription + NSPhotoLibraryUsageDescription added), `PatternlyWidget` extension + `PatternlyWidgetPlugin.swift`, `ios/profiles/*.mobileprovision` (app + widget App Store profiles) | MARKETING_VERSION 1.5 (build number set by Codemagic) |
| `patternly-app/codemagic.yaml` | — | iOS release workflow: npm install → cap sync → unique build number → copy the two repo profiles → signed IPA → App Store Connect | — |
| `patternly-app/store/` | — | `run.mjs` + `play-upload.mjs` executed by the Store API workflow; `requests/*.json` = one request per store action (create version, attach build, submit, promote) | — |
| `patternly-app/.github/workflows/` | — | `push-auto.yml` (hourly), `store-api.yml`, `android-release.yml` | — |
| `patternly-app/docs/NEXT_RELEASE_1.5.md` | — | R8/edge-to-edge notes and the on-device test checklist | — |

### Inside `index.html` — landmarks worth knowing

- Tracker DOM: `#tracker-page` → `#trk-upload` (home: guide banner, `#trk-newpat`, `#trk-source` cards incl. `#trk-src-scan`, `#trk-scan`, `#trk-projects`) and `#trk-workspace` (`#trk-verify-wrap` info strip, `#trk-zoombar` toolbar, `#trk-canvas-wrap`, `#trk-side` colour list, full-view `#trk-fsbar` / `#trk-fsutil` / `#trk-fszoom` / `#trk-fspanel` / `#trk-colorbar`).
- Tracker state: `trackerGrid {cols,rows,cells,backstitch,knotsList,scanned,unsure}`, `trackerLegend.bySymbol`, `trackerColourMap`, `trackerSprites`, `trackerStitched`, selections `trkSelectedSyms` / `trkBsSel` / `trkKnotSel`, zoom `trackerCellPx` + `trkPinch*`, grid prefs `trkGridCfg` (localStorage `patternly_trk_grid`).
- Rendering: `renderTracker()` (overview mode `_ov` when cells < 6 px, unsure overlay, backstitch + knots overlay, rulers), `updateTrackerProgressUI()` (side list + mobile colour sheet + selected-colour card + streak/progress).
- Sync: `trkSaveProject` / `trkOpenProject` (local index `trkIndex()`), cloud `trkProgressUrl`, `trkCloudProjects`, `trkUserPatternUrl`, `pl_session` token — these are the RULE #1 markers.
- Scan: `<script id="plscan-src">` = `PLScan` engine (run in a Web Worker from a Blob), followed by the scan UI script (`plScanOpen`, review popover, `plReviewBanner`). The embedded copy is the only source: edit it in `index.html`, test with `tools/scan/` (`./extract.sh` first). Colour charts (v634): `isColourChart` → `detectGridColour` (tile periodicity grid), `legendTiles` (key squares), `matchColour` (colour + symbol, light field); worker command `matchColour`.
- Landing carousels (phones ≤860 px): `.lp-steps` + `.lp-steps-dots`, `.lp-features-grid` + `.lp-feat-dots`; native scroll-snap, one small script (search "Dots for the landing carousels") syncs the dots.
- Guided scanner camera (v638): `#plcam` block just before `</body>` (own `<style id="plcam-style">` + script; API `plCamOpen({multi,title,first,deliver})`, `plCamClose()`, `plCamDebug()` = last frame's measurements). A capture-phase click handler on `label.pls-add` takes over the two "Take photo" buttons (`#pls-cam` chart pages, `.pls-legcam` key) on phones and in the apps (`plIsApp()` or `(pointer:coarse)`, getUserMedia + DataTransfer available); desktops keep the file picker. The straightened JPEG goes back through the original `<input>` (DataTransfer + `change` event), so `addFiles` / `legendFile` stay the only read path. Live loop every 110 ms on a 240 px frame: Otsu → largest bright blob (retried at lower thresholds when a shadow splits the paper) → convex hull → largest-area quad; checks in order: page found, all corners in view, paper brightness < 100 (dark), saturated spots (glare), brightest-paper ratio across the 9 ninths < 0.6 (shadow), opposite-side ratio < 0.86 (tilt), page < 28 % of frame (move closer), frame difference (hold still), focus (gradient energy / variance on a crop one fifth of the page wide, < 0.1 or < 60 % of the recent peak). All green for 1.1 s → auto-capture (toggle `patternly_scan_auto`). Review screen with draggable corners; homography warp (bilinear, ≤ 4000 px) to a flat page. In multi-page mode the next auto-capture waits until the picture changes (new page). Torch button where supported; "Use the camera app" link and a camera-denied screen fall back to the native picker. Scan tip (v640): an image picked through `#pls-pick` / `.pls-legpick` on a scanner-capable device shows a dismissable card suggesting "Take photo", at most 3 times per device, 14 days apart, never after "Don't show again" (localStorage `patternly_scan_tip`; PDFs and the scanner's own files never trigger it).
- Native detection: `plIsApp()` (Capacitor); `body.pl-native` class marks the native shell (no Luca-S Shop links exist anywhere since v631); `setAppViewport()` locks zoom in the app; `--sa-top/--sa-bottom` safe-area vars.
- Thread shopping list (v650): `#plshop` block just before `</body>` (own `<style id="plshop-style">` + script; API `plShopOpen({title, brand, note, items:[{label,code,sku,r,g,b,stitches,metres,parts?}]})`). Rows with `parts` (blends) are split into their threads (half the length each) and merged with the same thread used alone; key = SKU upper-cased without separators/leading zeros, so "Luca-S-084" and "Luca-S 84" match. Skeins = ceil(metres / 8). "Have" ticks are one stash per device across all patterns (localStorage `patternly_shop` = `{h:{KEY:1}}`). Share (navigator.share, else copy), Copy (text of threads still to buy), CSV, PDF (jsPDF) through `rawDownload` (no export quota). Callers: `plShopEditor()` (palette panel button `#pal-shop-btn`; cart table metres per 100 crosses + backstitch length), quick convert `shopList()` (`#qc-shop`, `#qc-shop2`, hidden for diamond painting), tracker `trkShopList()` (`#trk-shop-btn` on desktop, Settings sheet on phones; `.ptly` metres when present, else Luca-S m per 1000 crosses). Free for everyone (replaced the Plus-only palette CSV/PDF export `palExport`).
- Blended threads (v651): a blend = one strand each of two threads. Blend entries `{r,g,b,label:'DMC 310 + 413',sku:'DMC-310+413',variantSource:'blend',blend:[a,b]}` are appended after a brand's threads (`PALETTES[b].baseLen` = number of real threads), so indices of real threads never move. `plBlendEnsure(brand,a,b)` adds/reuses one, `plBlendsOf(brand)` / `plBlendsRestore(brand,list)` save and rebuild the tail (saved designs carry `blends:[[a,b],…]` next to `grid`; `pjLoadIntoEditor` restores it first; `pjMakeThumb` colours blends from the record). Every nearest-thread matcher skips `.blend` entries (`closestPaletteIdx*`, editor preview, replace-colour grid, colour finder, lpc, tracker skip-build), `sortedPaletteIndices` hides them from the Thread Library, `thPal` gives the Thread Hub real threads only; brand convert maps a blend's two threads. Add-to-cart buys half the length of each thread. Quick convert: toggle `#qc-blend-tog` (`QC.blends`, off by default, hidden for diamond painting); `blendSet(brand)` pairs each thread with its 6 nearest (redmean 400–9000); a pixel takes a blend only when it is ≥30 % closer than the best single thread; `res.pal`/`res.nBase` hold the preview palette and `handoff()` maps preview indices to editor slots. Finished look draws a blend's two threads on the two legs
- Backstitch outlines (v652): `plOutlineSegs(idx,W,H,colOf,nearest,{level,colour,subject})` (next to `drawBackstitches`) puts lines on cell edges whose two sides differ by ΔE ≥ 30/21/14 (Fewer/Balanced/More), and around the subject against empty cells; components shorter than 7/4/3 edges are dropped, single-step staircases become diagonals, straight runs of one ink are merged. Ink = nearest real thread to the darker side × 0.42, or one of `PL_OUTLINE_INK` black/brown/grey. Quick convert: switch `#qc-ol-tog` + amount/colour (`QC.ol/olLevel/olCol`, hidden for diamond painting), `res.lines`, drawn on Pattern and Finished look, listed in the palette and shopping list; `handoff()` writes them as editor lines `{type:'backstitch',strands:1,auto:1}`. Editor: "〰 Backstitch outlines" button under Adjust Colors opens `#plol` (`plOutlineOpen()`), works on the flattened layers, adds to the active layer, replaces only `auto` lines, undoable. PDF chart pages now draw backstitch (`expTileLines` clips lines per tile, raster + vector) and the thread key lists backstitch threads after the crosses (length, 1 strand); before v652 editor PDFs had no backstitch at all
- i18n: `plT(key)` / `trkT(key, vars)` over table `T`; `data-i18n` attributes applied by `plApplyLang()`.

## Backend (middleware v101)

One Pages Function handles every request under `/apps/patternly/`. Errors are returned as HTTP 200 with a JSON body because the Shopify App Proxy masks 5xx. `/whoami?debug=1` (through luca-s.com, not pages.dev) shows the running version and auth state.

### Routes

| Route | Purpose |
| --- | --- |
| `/auth/start`, `/auth/callback`, `/auth/logout`, `/auth/switch`, `/auth/relogin`, `/auth/tokentest` | Shopify Customer Account API OAuth (PKCE); callback sets our own signed `pl_session` cookie/token |
| `/auth/apple` | Native Sign in with Apple (RS256 against Apple JWKS, find-or-create customer by email) |
| `/whoami` | Who is signed in, Plus status, build versions |
| `/patterns/<SKU>/...`, `kits.json` | Kit catalogue (Shopify collection + `partner-kits.json` manifest merged) and pattern files from R2, gated by entitlement / access code |
| `/code?sku=` | Access-code lookup (HMAC of `PATTERN_CODE_SECRET`, overrides in `PATTERN_CODES`) |
| `/kit/<SKU>` | 302 to the tracker link with the code resolved (HobbyJobby printed QR redirects, 56 Shopify URL redirects imported) |
| `/progress` (GET/PUT/DELETE) | Stitch progress per account + SKU; latches code-opened kits to the signed-in customer; union-merge, clobber guard |
| `/user-patterns`, `/editor-patterns` | Synced uploaded patterns (cap `USER_PATTERN_CAP`) and Plus members' Editor designs (`EDITOR_PATTERN_CAP`, TTL) stored in R2 with `.progress` objects |
| `/exports` | Free-tier monthly PDF export quota (`FREE_EXPORTS_PER_MONTH`) |
| `/plus/trial`, `/plus/billing`, `/iap/webhook` | Plus trial, billing summary for the Account page, RevenueCat webhook (`RC_WEBHOOK_AUTH`) |
| `/push/register`, `/push/unregister`, `/streak` | Device tokens (platform, language, timezone); streak data for the home card and widgets |
| `/partner/*` (public) | `apply`, `kit-info`, `staff/setup-info`, `staff/setup`, `staff/login`, `staff/forgot`, `staff/logout`, `signin` |
| `/partner/*` (partner session) | `mine`, `upload`, `update`, `toggle`, `delete`, `customers`, `customer-lookup`, `progress-download`, `qr-style`, `logo`, `pending`, `approve`, `remove` |
| `/partner/admin/*` (owner/team, scope-checked) | `whoami`, `brands`, `create`, `update-brand`, `brand-setup-link`, `revoke`, `applications`, `application-delete`, `upload`, `list`, `link`, `patterns`, `customers`, `customer-lookup`, `progress-download`, `qr-style`, `logo`, `users`, `user-create`, `user-reset`, `user-update`, `user-revoke`, `revenue`, `push/devices`, `push/send`, `push/run`, `push/log`, `push/auto` (GET/POST), `push/auto-run` (cron, `x-cron-key`) |

### Storage bindings

| Binding | Type | Holds |
| --- | --- | --- |
| `PATTERNS` | R2 | `<SKU>/` pattern files (chart.pdf, legend.pdf, .ptly, cover), `partner-kits.json` manifest, user/editor pattern blobs |
| `ENTITLEMENTS` | KV | Purchases/entitlements, Plus state, progress index, push devices, notification queues/log, revenue cache |
| `PARTNERS` | KV | Brand records (`key → {brand,prefix,email,buy,limit}`), team users (`user:`, `ukey:`, `sess:`), applications, QR style, logos |
| `USER_PATTERNS`, `EDITOR_PATTERNS` | KV | Index of synced user uploads / Editor designs |

### Secrets and environment variable names (values live only in Cloudflare — never in chat)

`CUSTOMER_CLIENT_ID`, `CUSTOMER_CLIENT_SECRET`, `CUSTOMER_SESSION_SECRET`, `CUSTOMER_SHOP_ID`, `CUSTOMER_SCOPE`, `CUSTOMER_REDIRECT_URI`, `CUSTOMER_APP_REDIRECT`, `SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_APP_SECRET`, `SHOPIFY_API_VERSION`, `KITS_COLLECTION_HANDLE`, `PATTERN_CODE_SECRET`, `PATTERN_CODES`, `PATTERN_ACCESS_CODE`, `CODE_ADMIN_KEY`, `PARTNER_ADMIN_KEY`, `PUSH_CRON_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`, `APNS_BUNDLE_ID`, `APPLE_BUNDLE_ID`, `FCM_SA_JSON`, `RESEND_API_KEY`, `MAIL_FROM`, `RC_WEBHOOK_AUTH`, `PLUS_SKU`, `PLUS_SKU_YEAR`, `PLUS_TAG`, `PLUS_CUSTOMERS` (lifetime/comped list), `COMP_TAG`, `PLUS_WINDOW_DAYS`, `PLUS_YEAR_WINDOW_DAYS`, `FREE_EXPORTS_PER_MONTH`, `USER_PATTERN_CAP`, `EDITOR_PATTERN_CAP`, `EDITOR_PATTERN_TTL_DAYS`, `FX_USD_GBP`, `STUDIO_PUBLIC_URL`, `APP_PUBLIC_URL`.

Key prefixes you will see: `PA-` owner admin key, `PU-` team-user key, `PK-` partner brand key, `ST-` staff/session tokens. Never print their values; access codes are masked in links.

### Scheduled work

The only cron is GitHub Actions `push-auto.yml` at minute 7 every hour, which POSTs `/partner/admin/push/auto-run` with `x-cron-key`; the server flushes quiet-hour queues and runs the automatic-notification rules (milestones, first stitches, finished, inactivity, win-back, weekly touch with multilingual tips, streak-at-risk 19–22h local, nearly-there, kit bought never opened, weekly summary, new kit from your brand, Plus trial/lapsed, monthly new-kits broadcast). Cap and quiet hours use the device timezone.

## Native apps

Both stores run **1.4** today; **iOS 1.5 is live on the App Store** (approved by 30 Oct 05:45 UTC, build 1793294562, version id `e731c76c-b46d-4ec9-ac68-b8d14cb910dd`). App repo `main` is **1.5** since 29 Oct (editor v640 with the guided scanner, camera permissions, Android R8 + edge-to-edge, iOS 1.5): build iOS on Codemagic, Android with GitHub Actions "Android release", test, then submit/promote.

| | iOS | Android |
| --- | --- | --- |
| Live version | 1.4 (build 3) on the App Store, id 6795543177 | 1.4 (versionCode 9) in production on Google Play |
| How it is built | Codemagic `ios-release` (mac_mini_m2): profiles copied from `ios/profiles/`, App Store Connect integration "UK Luca-S LTD"; no Mac needed. Start it in Codemagic (Start new build → branch `main` → workflow `ios-release`) or from GitHub: Actions → "Codemagic iOS build" → Run workflow, or Claude commits `store/ios-build.json` (`codemagic-ios.yml` + `store/codemagic.mjs`; result in `store-results/results/<id>.json`). Needs secret `CODEMAGIC_API_TOKEN` (optional variable `CODEMAGIC_APP_ID`) | GitHub Actions `android-release.yml` (since 29 Oct): Actions → "Android release" → Run workflow (empty boxes = next free versionCode from Play, versionName from build.gradle, `www/` as committed, track internal), or Claude commits `store/release-android.json` (`{id, track, notes, versionCode?, versionName?, editorRef?}`). Signs with the same upload key as the PC, adds `google-services.json` from a secret, uploads to Play, result in `store-results/results/<id>.json` (`ok`, versionCode, editor vNNN, `uploadKeySha1`, error). "Test build only" = unsigned, no upload. All secrets set (30 Oct); first run uploaded 1.5 (10) to internal. Fallback: Android Studio on Cristian's PC at `C:\patternly-app` |
| Store automation | `store/requests/*.json` committed to the app repo → `store-api.yml` executes against App Store Connect (create version, attach build, submit) and writes results to branch `store-results` | Same workflow via `play-upload.mjs`; the service account cannot promote to production — Cristian does that |
| Sign-in | Shopify OAuth via in-app browser + Sign in with Apple | Shopify OAuth via in-app browser |
| Purchases | RevenueCat (SDK key in the app, products above) | RevenueCat |
| Push | APNs (key in Cloudflare); permission asked on second launch; Notifications switch in More | FCM (Firebase project "Patternly") |
| Widgets (1.4) | `PatternlyWidget` extension + App Group; small + wide; streak and % of pinned/last project; tap deep-links to the project | Home-screen widget provider; same data via `/streak` |
| Deep links | `com.lucas.patternly://` scheme; QR / `?sku=&code=` open the kit | same |
| Viewport | `setAppViewport()` locks pinch/zoom of the UI in the app (web untouched) | same, plus `--sa-bottom` measured for 3-button nav |
| 1.5 | iOS built on Codemagic 29 Oct (started from GitHub via `codemagic-ios.yml`, 13 min) and submitted for review (`store/requests/asc-15-submit.json`). Guided scanner camera via WKWebView getUserMedia (first time in the app: check the camera prompt and the live view on a real iPhone) | R8 minify + shrink with Capacitor keep rules, `EdgeToEdge.enable`, version 10/1.5; checklist in `docs/NEXT_RELEASE_1.5.md` (sign-in, Plus purchase/restore, push, widget, QR, insets, dark mode) |

Play deadlines noted earlier: target API 36 before 1 Nov 2026 (done on `main`), DEX optimisation by Feb 2027 (R8 on `main` since 1.5).

## Features inventory

### Stitch Tracker (customer side)

| Feature | Micro-description |
| --- | --- |
| New Pattern sources | One "New Pattern" row opens four cards: **Kit Patterns** (Luca-S + partner catalogue, brand pills, unlock by purchase / access code / QR, "Get this kit" button), **Scan Your Pattern BETA** (second), **Upload** (PDF legend + chart, .ptly, .oxs, .pat), **Restore Backup** |
| Kit catalogue | Shopify collection (`KITS_COLLECTION_HANDLE`) merged with partner manifest; readiness gate (files present); watermark "LUCA-S" on Luca-S kits |
| PDF chart parser | Vector PDF → cells: ruler-pitch calibration, multi-page seams, half stitches, blends (`337+331`), backstitch extraction, French knots, bitmap-backstitch warning banner; legend counts in X/Y/Z form (cross/backstitch/knots) |
| Count verification | After upload compares legend counts vs chart; Cristian wants small differences (printed legends are often off by a few stitches) handled without scaring customers — see Open items |
| Marking | Pan / Mark / Erase / Pick modes; marking never un-marks by accident; press-and-hold highlights a colour; fractional stitches per corner; tinted completed stitches (colour + opacity, default magenta #ff3df0) |
| Colour list | Sort by kit order / stitches / code / colour; selected-colour card with metres (≈ from `metres` in .ptly or Luca-S table {14:5, 16:4.4, 18:3.9, 20:3.6, 25:2.9} m per 1000 st); "Needs a colour" rows; manual colour editor (brand pills lucas/dmc/anchor, glyph picker) for uploads/backups; backstitch/outline section (lines, strands, tap = focus); French knots section (tap = focus, v628) |
| Zoom | Anchored +/- (visible centre), wheel (mouse), pinch (fingers; iOS-safe preview + commit); overview rendering when cells < 6 px shows the picture; tap % to fit |
| Phone toolbar (v629) | One grid row **under the chart** (above the progress / colour list): modes pill → zoom pill → full-screen round button. Follows the theme through `--tb-*` variables on `#trk-zoombar` / `#trk-fspanel`: white pills + `#e6d9dd` border in Day mode, `#221b2d` / `#4a3d55` in Night mode. Round buttons 30–40 px (`--mb`). Desktop (>820 px) toolbar unchanged: still above the chart, light groups |
| Full view | Chart fills screen; dark pill with 4 round mode buttons; Close/Colours/Settings floating top-right; −/fit/+ pill top-left; colour sheet (grid/list, drag to expand); Settings sheet (tint, grid, backstitch, centre lines, opacity, block size/width, line width/colours, zoom, Full/Pages + mini-map, Pattern info toggle, Gestures & tips, Back up) |
| Pages mode | 30/40/50 cells per page, prev/next, clickable mini-map with current page highlighted |
| Pattern info strip | Green box above the chart (name, source, colours, size, warnings); ✕ hides it, Settings › Pattern info restores (localStorage `patternly_trk_infohide`) |
| Progress & sync | Progress saved locally and to the account (`/progress`), uploaded patterns synced (`/user-patterns`, cap), union-merge, snapshot before tab/app hide; "Progress restored" toast; `trkContinueFromAccount` |
| Streaks (v612) | Streak card on tracker home (local + account `/streak`), 7-day dots, shareable 1080×1080 image, "Stitch today to start a streak" |
| Guide banner | Full card for first-timers; after the guide was opened once or a pattern exists it becomes a slim row under the pattern lists (`patternly_guide_seen`) |
| Legend viewer, Backup | View uploaded legend PDF; download `.ptly`-style backup incl. progress |
| Localisation | Everyday tracker screens in en/fr/de/nl/ru/uk/es/it (stage 1 done) |

### Scan Your Pattern (BETA, v616–v623, colour charts v634)

| Step | What happens |
| --- | --- |
| Key photo | Customer photographs the colour key; taps a symbol column; `legendAnalyse` finds rows, symbol templates, colour swatches, reads thread numbers and stitch counts with canvas-drawn digit templates; brand code → palette colour via `trkFindBrandCode` |
| Page photos | One photo per chart page (page count asked first); engine flattens illumination, estimates skew, finds the grid pitch, grows a node lattice (repairs missed/duplicate lines), cuts cells, matches each cell to the key templates (Tanimoto, two-stage, pass-2 refinement) in a Web Worker |
| Result | Tracker project with exact sprites, palette colours, expected counts; cells with low confidence/margin (~10 %) are flagged amber — "N stitches to check" review popover shows the photo crop and a chooser; flags persist with the project |
| Measured accuracy | 92.6 % correct before review on compressed shadowed photos (BU5073), 95.2 % with a clean key, 98–99 % on 300 dpi scans; ~2 min per 160×160 chart in desktop Chrome |
| Colour charts (v634) | Charts printed in colour (Riolis and similar: every cell filled with the thread colour, some colours with no symbol at all) are detected automatically (`isColourChart`, ≥35 % of the page filled). Grid: `detectGridColour` finds the lattice by periodicity in small tiles (grid-line valleys + colour edges that run across more than one cell, so glyphs centred in cells cannot lock it half a cell off), unwraps line numbers tile to tile and bridges creases. Key: tapping a coloured square runs `legendTiles`, which follows column A up and down (local paper level, so hand shadows and the grey band behind blended rows do not count as colour), keeps one template per square (inside of the square, white-balanced) and leaves backstitch line rows out. Thread numbers: stacked blend numbers read as "9+10". Matching: `matchColour` scores symbol likeness minus Lab colour distance, fits key colours onto the chart photo, takes plain squares' colour from the densest chart colour of that hue, estimates a light field from symbol-placed cells (shadows), and has a paper class (no stitch). Brand select has "Kit's own numbers (Riolis…)" (auto-chosen for colour keys): labels "Colour 7", "Colour 9 + 10", colours from the key squares. ↻ buttons turn sideways page photos and key photos |
| Guided camera (v638) | On phones and in the apps "Take photo" opens a live scanner: page outline, warnings for dark / glare / shadow / tilt / too far / movement / focus, auto-capture, corner adjust, straightened flat page (like the iOS Preview scan). Camera app and Photos or PDF remain as fallbacks; gallery photos get an occasional tip to scan instead (v640) |
| Not yet | Page-number detection in the camera, backstitch from photos, speed, B&W-only kits (customer sees no colour, so low value) |

### Editor and tools

**Quick photo convert (v633, `#qc` block at the end of `index.html`, own `<style id="qc-style">` + script; API `qcOpen(file)` / `qcClose()`).** Only entry is `startWithPhoto()` (main page / menu). Its preview conversion mirrors `convertImage` (redmean palette match + distinctness-weighted colour cap) plus a majority filter for the Detail level and the editor's confetti rule (`cvAutoCleanGrid` hash). Colour styles reuse `cvApplyAdjust` by swapping `cvAdj`. "Editor"/PDF/Tracker call `handoff()`, which writes the exact previewed grid (same palette indices) into the editor globals, sets brand, fabric count/colour (`pjApplySettings`), `uploadedImg` (the prepared photo, so overlay and re-convert work) and leaves the pattern unsaved/dirty. Prefs (craft, units, brand, strands, fabric) in localStorage `patternly_qc`. Blended threads since v651, backstitch outlines since v652. Not built: fuse beads / C2C, FLOW score, translations.

Pattern editor (draw, palette, symbols, PDF export with brand block, Interface Size S/M/L, Working Palette sort), XSP→.Ptly converter with editable colour table and metres column (also embedded in the Studio as the Partner Converter), calculators (fabric, time, thread), thread-colour reference, QR-scan sheet / promo banner, landing pages with store badges (hidden inside the app).

### Account and Plus

Sign in with Luca-S (Shopify) or Apple; Account page: subscription, thread colours, converter, calculators, pricing, guide, privacy; Plus = unlimited exports/synced designs, trial via `/plus/trial`; lifetime Plus for influencers via `PLUS_CUSTOMERS`; "Luca-S Shop" links hidden in the native apps (v627); "My Luca-S Patterns" section removed from Account (v626).

### Partner Studio (brands.html)

| Area | Micro-description |
| --- | --- |
| Sign-in | One email + password login for team and partners (v44+); set-up links and resets emailed via Resend; partner brand key shown inside My Account, not used as login; apply form on the landing page |
| Partner tabs | Overview tiles; My Patterns (publish .Ptly + cover, hidden/live, edit, QR PNG, insert card, codes CSV, ZIP of all QR + codes, delete); Converter (embedded); My Customers (masked emails, per-kit progress, lookup by email, progress download); My Account (QR style/logo branding, brand key) |
| Owner tabs | Overview = Patternly Plus revenue (RevenueCat + Shopify, platform/time filters, chart) + program overview; Brands (create, limit, set-up link, revoke, applications); Patterns (all brands, publish for Luca-S SKUs incl. straight from the converter); Customers; Branding; Users (team accounts with scopes patterns/converter/customers/brands/branding); Notifications (manual push with translations, device list, log, Automatic rules card) |
| Phone layout (v51) | Scrolling tab row, tables scroll inside cards with the ⋯ column pinned, title actions under titles |
| Pattern caps | Default 200 patterns per brand, `limit` field per brand record; uploads publish live immediately (trusted brands) |

## Working rules for the next session

**RULE #1 — never break account-linked sync.** Before every push, grep these marker counts in `index.html` and compare with the previous commit: `trkProgressUrl` 4 lines, `trkCloudProjects` 4, `trkUserPatternUrl` 8, `pl_session` 27 occurrences (21 lines). Also: `ensurePageFooters` adds a footer only to `#account-page`, never `#tracker-page`; `/progress` latches code-opened kits to the signed-in customer.

1. One fix per build; bump `PATTERNLY_BUILD` (editor), `MW_VERSION` (middleware) or the Studio `vNN` comment on every delivered change; never re-issue a version with different contents. Next numbers: editor **v641** (v641–v649 handed out to the parallel threads of 30 Oct; v650–v652 = shopping list, blends, backstitch outlines on `claude/project-thread-mrklom`; next unclaimed **v653**), middleware **v102**, Studio **v52**.
2. Every editor build: `node --check` on all 19 inline script blocks, then copy `index.html` to `patternly-app/www/index.html` and commit both repos ("www: editor vNNN").
3. Commit as `-c user.name="Cristian" -c user.email="lucasukinfo@gmail.com"`, message ending with the Claude attribution lines; push to `main` directly (the Claude GitHub App has push access on both repos). The Patternly repo remote redirects ("repository moved") — harmless.
4. Test before delivering: Playwright headless Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `--no-sandbox`) against a local `python3 -m http.server` serving a copy of the file; iPhone viewport 390×844 with `isMobile`/`hasTouch`; `hj051.ptly` is the usual test pattern. No WebKit is available — anything iOS-specific needs Cristian's phone.
5. Fixes must be general (root cause), never special-cased to one kit or screen. Modern UI only — no browser-default controls. Dark mode must be checked for every UI change (`body.dark`).
6. Security: never print PA-/PK-/PU-/ST- keys, `PATTERN_CODE_SECRET`, `CODE_ADMIN_KEY` or any secret; keys and certificates never travel through chat (keystore, APNs .p8, FCM JSON, Resend key, PUSH_CRON_KEY are set by Cristian directly); access codes masked in links.
7. Communication: direct, with pushback when a fix is incomplete; break long tasks into messages and ask before starting long ones; no large file bodies pasted in chat; versioned filenames.
8. Don't trim grid padding until a tolerant progress loader exists (old progress is keyed to the current cell layout).
9. Each chat is one project. If something about another project arrives, say so — don't act on it.
10. **Keep this file current:** every commit that changes a build updates the version numbers above, adds a row to Recent changes and ticks/adds Open items — in the same commit.

## Recent changes (all pushed, newest first)

| Date | Build | Change |
| --- | --- | --- |
| 30 Oct 2026 | Editor v652 | Backstitch outlines, free: quick photo convert has a "Backstitch outlines" switch (amount Fewer/Balanced/More, line colour darker shade/black/dark brown/dark grey) that draws lines around shapes and the subject, with diagonals on stair steps; the Editor gets the same as "〰 Backstitch outlines" (add, replace, remove, undo). Root fix on the way: the editor's PDF chart pages never drew backstitch and the thread key never listed it; both do now. Outlines go to the Editor, PDF, Tracker (OXS) and shopping list. Dark mode and phone layout checked |
| 30 Oct 2026 | Editor v651 | Blended threads in quick photo convert (free): "Blended threads" switch under Colours mixes one strand each of two neighbouring threads, so skin tones, skies and gradients get in-between shades instead of bands and stray specks. Blends count as colours, show as "DMC 437 + 738 (blend)" in the palette, carry into the Editor (saved with the design, synced, thumbnails), PDF, Tracker (OXS) and the shopping list (split into both threads). 80×80 preview ~0.2 s, 400×400 ~1.2 s in desktop Chromium |
| 30 Oct 2026 | Editor v650 | Thread shopping list for any pattern, free for everyone: one sheet from the Editor palette panel, quick photo convert (palette + PDF step) and the Tracker (toolbar on desktop, Settings on phones). Skeins per colour, stitches and length, "Have" ticks remembered per thread on the device (shared by all patterns), filters All / To buy / Have, Share, Copy, CSV, PDF. Replaces the Plus-only palette CSV/PDF export. Dark mode checked. Branch `claude/project-thread-mrklom` |
| 30 Oct 2026 | Android 1.5 | First Android release built entirely on GitHub: 1.5 (10) to internal testing (run 41032464209), then promoted to Production (`play-promote-v10`) |
| 29 Oct 2026 | Android CI | patternly-app `android-release.yml` reworked so Android releases need no PC: Run workflow button with inputs, next free versionCode read from Play, `google-services.json` from secret `ANDROID_GOOGLE_SERVICES_JSON` (it is not in git; without it push would silently break), missing-secret check, upload-key SHA-1 in the result, release notes only in listing languages, dry-run test build; runner's own Android SDK (setup-android failed). New `docs/ANDROID_RELEASE_CI.md` with secret setup steps |
| 30 Oct 2026 | App 1.5 (iOS) live | Apple approved 1.5; App Store state READY_FOR_SALE (checked with `asc-15-state-1`) |
| 29 Oct 2026 | App 1.5 (iOS) | First Codemagic build started from GitHub (`store/ios-build.json` → `codemagic-ios.yml`, 13 min, build 1793294562). App Store version 1.5 created with What's New (Scan Your Pattern + guided camera, colour charts/PDFs, quick photo convert, zoom, phone toolbar) and submitted for review (`asc-15-submit`) |
| 29 Oct 2026 | App 1.5 prep | patternly-app `main`: `www/` = editor v640 (v634–v640 incl. guided scanner camera), `release-1.5` merged (R8 + edge-to-edge, versionCode 10 / 1.5), iOS MARKETING_VERSION 1.4 → 1.5, new `codemagic-ios.yml` + `store/codemagic.mjs` to start Codemagic `ios-release` from GitHub and report the result (needs `CODEMAGIC_API_TOKEN`) |
| 29 Oct 2026 | Editor v640 | Scan tip: when someone picks a photo from the gallery for a key or chart page (phones and apps only), a small card suggests the scanner ("Take photo") instead, with Got it / Don't show again. Shown at most 3 times per device and 14 days apart; never for PDFs or desktop. Dark mode checked. Shipped with v638 (PR #6, merged 29 Oct) |
| 29 Oct 2026 | Editor v638 | Scan Your Pattern guided scanner camera: on phones and in the apps, "Take photo" (chart pages and colour key) opens a live document-scanner view instead of the plain camera. Finds the page outline, warns live (too dark, glare, shadow, hold the phone straight, move closer, fit the whole page, hold still, focusing), captures automatically when everything is green for ~1 s (Auto can be switched off; round shutter always works), lets the person drag the corners, then straightens the page with a perspective warp and hands the flat JPEG to the existing reader. Chart pages: stays open for the next page and waits for the page to change before scanning again; "Done (n)". Phone light button where supported; "Use the camera app" fallback; camera-denied screen. Desktop unchanged. Tested with a simulated camera in Chromium (good / dark / shadow / tilted / far / blurred pages); not yet on a real iPhone or Android. PR #6 |
| 29 Oct 2026 | Editor v639 | Scan key table: brand option renamed "Kit’s own numbers" (no brand name). With kit numbers each row's colour square is a colour picker (`.pls-lt-col`, sets `pg.swatches[i]`, keeps `glyph`), so a wrongly read colour can be fixed before converting; thread number, stitch count and remove-row were already editable. Dark mode for the table header/rows. (v638 is the guided camera, PR #6, built in parallel) |
| 29 Oct 2026 | Editor v637 | Colour keys with the kit's own numbers: `PLScan.kitCodes(nums, swatches)` decodes the whole number column together instead of digit by digit. `legendNumbers` tokens now carry `alt` (each digit's best shape-filtered score); a Viterbi pass keeps each row's first number equal or +1 to the row above (soft, cost 0.8), allows one lost/extra glyph at a cost, and picks a blend's second number partly by colour (the square should look like the mean of the two single colours, ΔE/80). Riolis 2289: misread numbers 6→1 (phone photo), 6→0 (other photo), 6→3 (Preview scan JPEG), 6→2 (Preview PDF). Used only when the key is a colour key and brand = kit |
| 29 Oct 2026 | Editor v636 | Scan Your Pattern takes scanned PDFs: the two "From photos" inputs (now "Photos or PDF", `#pls-pick`, `.pls-legpick`) accept PDF; `pdfPages` renders each page with pdf.js at 3600 px long side to a JPEG File, so page cards, ↻ turn and reading work as for photos. Chart: every page (max 40) becomes a page card. Key: first page only (status says so when the PDF has more). Tested end-to-end with Cristian's iOS Preview scan of Riolis 2289: 110×110. v634–v635 merged to main (PR #5) |
| 29 Oct 2026 | Editor v635 | Colour charts: the grid finder gets its own area-averaged copy of the page at up to 2800 px (`resampleAvg`, `scaleMesh` in `analysePage`) instead of the darkest-pixel halving used for ink charts. Sharp full-page scans (iOS Preview scan of Riolis 2289, 2493×3450) halved to ~9 px cells and the grid failed (6×6); now 110×110 found. Ink-chart path unchanged |
| 28 Oct 2026 | Editor v634 | Scan Your Pattern reads charts printed in colour (Riolis tested with kit 2289): colour-chart grid finder, colour key squares with or without a symbol (plain colours matched by colour), backstitch line rows skipped, blended rows "9+10", "Kit's own numbers" brand option, shadow-tolerant colour matching with a paper (no stitch) class, ↻ turn buttons for sideways photos. Classic symbol charts (Luca-S) take the old path unchanged. Harness committed in `tools/scan/` |
| 27 Oct 2026 | Editor v633 | Quick photo convert: "Upload Image" / "Try with your photo" on the main page and menu (`startWithPhoto`) now open a full-screen guided flow `#qc` (Photo → Pattern → PDF, modelled on stitchmate) instead of the full editor. Photo: type (photo / pixel art / printed chart → Scan Your Pattern), replace, crop & straighten, erase background (border auto + tap to erase). Pattern: cross stitch / needlepoint / diamond painting, size presets + custom, cm/in, hours estimate, brand, strands, fabric count + colour, colour style, colour count, fine-tune, detail level, confetti % + clean-up (Plus), Pattern / Finished look / Original preview, palette with skeins. PDF: name, page size, chart style, layout → editor PDF engine and free-export quota; also Open in Editor / Stitch it in the Tracker. Editor's own upload zone unchanged. English only for now |
| 27 Oct 2026 | Editor v632 | Landing page on phones (≤860 px, web and apps): the three feature cards (Create Patterns / Convert Images / Stitch Tracker) are now a swipeable scroll-snap carousel with a peek of the next card and tappable dots, like the "three steps" section already was. One shared dots script drives both carousels; dark-mode dots fixed (the active dot was invisible in Night). Desktop layout unchanged |
| 27 Oct 2026 | Editor v631 | Removed the "Luca-S Shop ↗" link everywhere (web and apps): landing header, mobile menu, editor top bar and the My Account list. The `.pl-shop-link` hide rule is gone with it; the `acct.shop` i18n strings are left unused. The Account footnote "Luca-S shop account ↗" (orders & addresses) is kept |
| 27 Oct 2026 | Editor v630 | Pick / long-press on the chart no longer scrolls the page down to the colour list: only the list box scrolls to the picked colour, the view stays on the chart. v630 copied to patternly-app `www/` (apps carry v629 + v630) |
| 27 Oct 2026 | Editor v629 | Phone toolbar moved below the chart (above the colour list), Day-mode light pills with a Night-mode dark variant, about 15% smaller (buttons 40 px max instead of 46) |
| 27 Oct 2026 | Editor v628 | One-row phone toolbar as a CSS grid (modes → zoom → full screen), round buttons forced over the desktop rule (they were ovals), solid dark pills; French-knot focus from both colour lists |
| 27 Oct 2026 | Editor v627 + Studio v51 | No double-tap page zoom (`touch-action: manipulation` on buttons/links); backstitch + knots in the mobile colour sheet; dark-mode Settings sheet (toggle knob, white buttons, box-in-box, mini-map current page); hideable pattern-info strip; shop links hidden in apps (`body.pl-native`); slim guide row redesign; Studio phone layout |
| 27 Oct 2026 | Editor v626 | Guide banner compact after first use; "My Luca-S Patterns" removed from Account; 40 px selected-colour ✕; round mode buttons; full-screen label and zoom-pill auto-hide fixes; floating controls moved below the ruler |
| 26 Oct 2026 | Editor v625 | One-row toolbar attempt; round full-screen controls (dark pill, floating Close/Colours/Settings, −/⤢/+ pill) |
| 26 Oct 2026 | Editor v619–v624 | Zoomed-out tracker shows the picture (overview rendering); iPhone pinch zoom fixed in stages (render-time preview, commit on release, anchor kept on zoom-out) |
| 26 Oct 2026 | Editor v616–v618, v622–v623 | Scan Your Pattern BETA: key + page photos → tracker; BETA badge; unsure-cell review; thread numbers and counts read from the key; key table header fix |
| 26 Oct 2026 | Editor v615 | Anchored zoom (+/− around centre, wheel around mouse, pinch around fingers) |
| 25 Oct 2026 | Editor v612–v614 | Streak card + share image; widget data + pin toggle + tap deep link; full-screen bar fits all widths, Undo removed |
| 25 Oct 2026 | MW v99–v101 + Studio v48–v50 | Automatic notifications: weekly touch, streaks, nearly-there, kit bought never opened, weekly summary, new kit from your brand, Plus trial/lapsed, monthly new-kits, streak-at-risk evening reminder; `/streak` endpoint |
| 23–24 Oct 2026 | MW v93–v98 + Studio v41–v47, Editor v610–v611 | Push notifications end to end (device registration, APNs/FCM, send jobs, Notifications tab, translations, device timezone); forgot-password + invitation emails via Resend; one email+password sign-in for team and partners; per-tab URLs |
| 22 Oct 2026 | App 1.4 | App Store Connect + Play connected via GitHub Actions; 1.4 submitted (iOS) and promoted to production (Play, versionCode 9) |
| 18–21 Oct 2026 | MW v85–v92, Studio v33–v40, Editor v601–v609 | HJ QR redirects (`/kit/<SKU>`), team users with scopes, revenue overview, legend X/Y/Z counts, Erase mode, tint colour/opacity, pick colour from chart, tracker localisation stage 1 |

## Open items and known anomalies

### Waiting on Cristian

- [ ] Try v636 Scan Your Pattern on the Riolis 2289 kit (live on the website; PDF scans can be added directly). Full-page iOS Preview scan received 29 Oct (`scan-tests/riolis-2289/preview_scan.pdf`): 110×110, 2,406 empty cells, ~15 % of stitches flagged, 6/29 key numbers misread before v637, 2/29 after
- [x] Scanned PDFs as key / chart pages (v636)
- [ ] Colour key walk: tapping a coloured square in Riolis 2289 finds 28 of 29 squares (misses the near-white square with a dot, colour 1, at the top); tapping that white square itself is fragile (works on the JPEG, `nosymbol` on the PDF render)
- [ ] Check the v633 quick photo convert on the phone apps; decide whether confetti clean-up should stay Plus-only in the quick flow
- [x] v633 merged (PR #4) and copied to `patternly-app/www/` (27 Oct)
- [ ] Check v632 landing carousels on the phone (feature cards swipe, dots follow; "three steps" carousel unchanged apart from dark dots)
- [ ] Check v630 on the iPhone: Pick keeps the chart in view; toolbar under the chart (v629, checked on web by Cristian); French-knot focus on B1441 (v628); Studio on the phone
- [ ] Decide whether the desktop / tablet toolbar (>820 px) should also move below the chart (v629 changed phones only; on desktop the colour list is a side column, not below)
- [x] v629 + v630 copied to `patternly-app/www/` (27 Oct); next store build will carry them
- [x] v631 (no Luca-S Shop links) copied to `patternly-app/www/` (27 Oct)
- [x] v632 (landing carousels) copied to `patternly-app/www/` (27 Oct)
- [ ] Decide whether the Account-page footnote link "Luca-S shop account ↗" should also be hidden in the apps
- [x] 1.5 prepared on app `main` (29 Oct): www = editor v640, `release-1.5` merged (Android 10 / 1.5), iOS MARKETING_VERSION 1.5, Codemagic bridge workflow added
- [x] iOS 1.5 built on Codemagic, submitted 29 Oct, approved and live (READY_FOR_SALE) 30 Oct
- [ ] Cristian: try the guided scanner camera in the iOS 1.5 app (first build with the live camera in the app)
- [ ] Android 1.5: GitHub "Android release" (after the secrets) → internal testing → tick `docs/NEXT_RELEASE_1.5.md` → promote on Cristian's go
- [x] Cristian added GitHub secret `CODEMAGIC_API_TOKEN` (29 Oct) in patternly-app so Claude can start iOS builds and read their result
- [ ] Grant lifetime Plus to Charly (add to `PLUS_CUSTOMERS`) and future influencers as they sign in
- [ ] Shopify app scopes `read_products` / `write_products` still to be granted (needed for catalogue writes)
- [x] Android secrets added by Cristian (30 Oct); first CI release 1.5 (10) uploaded to Play internal testing 30 Oct 09:22Z (run 41032464209, accepted by Play so the upload key matches)
- [x] Android 1.5 (10) promoted to Production 30 Oct 09:35Z on Cristian's go (store request `play-promote-v10`; phone test skipped by his choice, so watch Android vitals / reviews for R8 or edge-to-edge issues)

### Scan roadmap (BETA)

- [ ] Riolis: re-test with Cristian's full-resolution photos (the ones tested were downscaled to 2016 px, ~14 px per cell); one photo of the whole sheet works best for one-sheet charts. Half stitches ("//" rows) are tracked as full stitches; backstitch rows are skipped
- [ ] Colour charts: no measured accuracy yet (no ground truth). Downscaled Riolis photo: 1,821 of 11,000 cells read as empty canvas (left blank, not counted), ~17 % of the 9,2xx stitches flagged "to check". 68 empty cells were close calls and are not flagged (review only covers stitched cells), so a very light colour could be missed silently
- [ ] Tracker banner after any scan still says "✓ Exact import … nothing parsed from a picture" (`trackerShowVerification` treats scans as exact grids since v616); give scans their own line
- [x] Live guided camera: page outline, light/glare/shadow/tilt/blur warnings, auto-shutter, straighten (v638, PR #6 merged 29 Oct)
- [ ] Test v638/v640 on a real iPhone and Android phone (web and app): thresholds were tuned on a simulated camera; check auto-capture isn't too strict/too eager, the tilt hint direction, the light button on Android
- [ ] Page-number detection in the camera (not built)
- [ ] Backstitch from photos; speed (~2 min per 160×160 chart); originals of BU5073 (key both sides + 6 pages) for a regression run of the classic path (second brand received: Riolis 2289, 28 Oct)
- [ ] Investigate: full-resolution key photo scores worse (85 %) than the 1800 px downscale (92.5 %); JS harness reports `nogrid` on 300 dpi scan pages and 94.9 % on scan p6 (in-app path unaffected)

### Tracker / parser backlog

- [ ] Cristian: try the v650–v652 preview (shopping list, blends, outlines) before merge
- [ ] Outlines: lines follow cell edges only (no half-cell "halfback" detail); a busy photo on More gives many short lines, Fewer is the safer default for photos
- [ ] Blends: PDF thread key lists a blend as one row ("DMC 437 + 738", skeins for the pair) rather than "1 strand each"; the editor's own Convert image has no blend option (quick convert only)
- [ ] Shopping list: thread brand of tracker kits whose codes carry no brand (plain "310") is not known, so their "Have" ticks don't match the same thread ticked in the Editor; tracker backstitch-only colours count only when the pattern stores metres

- [ ] Legend-count tolerance: printed Luca-S legends are often off by 1–3 stitches; show no warning for small differences (Cristian's request, Oct 22)
- [ ] Bitmap backstitch decoder for kits like B1442 (design specified: isolate saturated pixels, trace segments, snap to lattice) — not built
- [ ] Prune-guard sync bug; own-photo sprite swaps; tolerant progress loader before any grid-padding change
- [ ] Tracker localisation stage 2 (remaining strings), Studio intro block for non-partners

### Studio / backend backlog

- [ ] Partner onboarding kit (pitch email, brand one-pager, admin cheat-sheet)
- [ ] Optional ideas noted earlier: DeepL for notification translations, creators tab for the influencer programme, automated influencer outreach

### Known quirks

- `ui_test.js` in the scratchpad fails at its last step (clicking Colours from the home screen) on every version — a test bug, not a regression.
- Shopify App Proxy hides 5xx bodies; middleware answers errors as 200 + JSON so they stay visible.
- `pages.dev` origin has no Shopify signature → always signed-out; test auth only through luca-s.com.
- The Patternly repo `git push` prints "This repository moved" — the remote URL still works.
