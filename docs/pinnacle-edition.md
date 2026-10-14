# Pinnacle edition: handoff

Pinnacle Life Group runs on Suite CXO as one tenant, and it has its own phone look and its own store app. This note lists everything that is Pinnacle's. Use it to hand the edition to Pinnacle, or to copy it into their own database and accounts.

The rule: everything Pinnacle-specific lives in one config or edition layer. Shared components read the config and never name Pinnacle values. To move or copy the edition, change the files below and nothing else.

## 1. The edition layer (look, logo, name, bundle)

| What | Where | Notes |
|---|---|---|
| Phone look: font, light/dark tokens, money colour, Home words, Work order, assistant name | `lib/phoneVersions.ts`, the `pinnacle` entry | `skin`: Instrument Sans; money #016630 light / #D1FE17 dark; dark grounds #0F0F10 / #161617. `words`: "Issued premium", etc. Never the word "Score". |
| Logo | `lib/brandMarks.ts`, `BRAND_MARKS.pinnacle` | `MARK_PATH` copied exactly from `pinnacle-life-group/components/brand/logo.tsx`, plus the PINNACLE / LIFE GROUP lockup. Drawn by the shared `app/components/cxo/phone/PhoneLogo.tsx`. |
| Font file | `app/layout.tsx`, `Instrument_Sans` → `--font-instrument-sans` | Not preloaded; only a skinned phone shell uses it. |
| Who gets the Pinnacle version | `lib/phoneVersions.ts` `phoneVersionKeyFor`, from `pinnacleAllowed()` in `lib/pinnacle/access.ts` | |
| Store app: bundle ID, app name, the company it opens | `native/src/edition.ts`, `EDITIONS.pinnacle` | `com.suitecxo.pinnacle`, "Pinnacle", opens `pinnacle.suitecxo.com`. |
| Android flavor | `native/android/app/build.gradle` (`productFlavors.pinnacle`), `native/android/app/src/pinnacle/res/values/strings.xml` | `./gradlew bundlePinnacleRelease`. |
| iOS | `native/ios/App/App.xcodeproj` build setting `CXO_DISPLAY_NAME` (Info.plist reads it) | Build with `xcodebuild ... PRODUCT_BUNDLE_IDENTIFIER=com.suitecxo.pinnacle CXO_DISPLAY_NAME=Pinnacle`, after `npm run sync:pinnacle` in `native/`. |
| App links | `lib/nativeAppLinks.ts` (`PINNACLE_BUNDLE_ID`, `PINNACLE_ANDROID_PACKAGE`) | The AASA lists both apps. assetlinks adds Pinnacle once `CXO_PINNACLE_ANDROID_CERT_SHA256` is set. |
| Dev preview of the look | `/cxo/demo?version=book&edition=pinnacle`, local dev server only (`demoEdition`) | Deployed builds ignore it. The public demo never shows Pinnacle. |

Shared phone CSS (`app/components/cxo/phone/cxo-phone.css`, `[data-phone-skin]`) only reads `--cxph-*` variables. It holds no Pinnacle colour.

## 2. Data (the Pinnacle book)

- **Code:** `lib/pinnacle/*` (access, airtable, cache, kpis, load, people, rollup, sync*, writing).
- **Routes:**
  - `app/api/pinnacle/*` (summary, breakdown, refresh)
  - `app/api/cron/pinnacle-sync`, `app/api/cron/pinnacle-rollup`
  - `app/api/admin/pinnacle/*` (discover, reconcile)
- **Page:** `app/dashboard/pinnacle/page.tsx`.
- **Tables** (no tenant column; Pinnacle's book only):
  - `pinnacle_airtable_records`, `pinnacle_airtable_snapshots`
  - `pinnacle_airtable_sync_runs`, `pinnacle_sync_table_runs`
  - `pinnacle_sync_state`, `pinnacle_sync_cursor`
  - `pinnacle_people_rollup`
- **Source:** Pinnacle's Airtable bases. A copy into their own database means these tables, the cron, and their own Airtable token.
- **Scheduled job:** `vercel.json` cron `/api/cron/pinnacle-sync`.
- **Overview tiles:** the "Agencies and agents" number tiles in `app/components/cxo/ExecOverview.tsx` read this book. The owner approved them (10-14); keep them.

## 3. Tenant and hosts

- **Tenant:** `rep_spence`. It is the default allow-list in `lib/pinnacle/access.ts` (`PINNACLE_TENANT_DEFAULT`), and can be overridden with `PINNACLE_VIEWER_REP_IDS`.
- **Hosts:**
  - `mike.suitecxo.com` is the main address.
  - `spence.*` redirects there (`lib/hostRenames.ts`).
  - `pinnacle.*` is a working alias, and the store app opens it.

## 4. Environment variables (names only)

| Variable | Used for |
|---|---|
| `PINNACLE_AIRTABLE_TOKEN` | Airtable read access |
| `PINNACLE_AIRTABLE_BASE_ID`, `PINNACLE_AIRTABLE_BASES`, `PINNACLE_AIRTABLE_TABLES` | Which bases and tables sync |
| `PINNACLE_BOOK_LABELS` | Book labels |
| `PINNACLE_CHECK_EVERY_N_TICKS` | Sync pacing |
| `PINNACLE_VIEWER_REP_IDS` | Which tenants may read the book |
| `CXO_PINNACLE_ANDROID_CERT_SHA256` | Android App Links for the Pinnacle app (set once Play signing exists) |
| `CXO_EDITION=pinnacle` | Native build only: makes the Pinnacle app |

## 5. Owner steps not done in code

None of these have been done. Nothing has been uploaded to a store.

- Create the App Store Connect app record `com.suitecxo.pinnacle`, and turn on the Push capability on that App ID.
- Create the Play Console app `com.suitecxo.pinnacle`. Then set `CXO_PINNACLE_ANDROID_CERT_SHA256`.
- Push on Android: add `com.suitecxo.pinnacle` as an app in Firebase and use the updated `google-services.json`. If the file lists only `com.suitecxo.app`, the Pinnacle Android build stops at the google-services step.
- Store icons: the Pinnacle app uses the Suite CXO icons until its own art is added under `native/resources` (or flavor res folders).
- `suitecxo://` is shared by both apps. Give Pinnacle its own scheme if both apps will sit on one phone.
