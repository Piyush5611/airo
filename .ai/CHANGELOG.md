# Changelog

Significant structural changes only. Newest first.

### 2026-10-05

- **Change:** Nexcall is shown as **Call Yatri** everywhere users see it (provider name, WhatsApp report lines, LLM prompt, errors). The provider key, routes, and function names stay `nexcall`. The Call Yatri connection page (`CallYatriView` in `Connections.jsx`) shows sync status with skipped parts, the 7-day call report tiles, team performance, and Calls / Follow-ups / Leads tabs.
- **Change (same day):** `pullNexcall` uses `Promise.allSettled`: one failing endpoint no longer fails the sync; skipped parts are logged as warnings. The call report is stored as a `report` object (`last_7_days`, employee emails dropped) and returned as `callReport` on connection detail.
- **Change (same day):** Call Yatri report charts. New `GET /api/connections/:id/call-yatri/stats?day=YYYY-MM-DD` (`connections.view`) calls the Call Yatri report API once per IST day (last 7) and once per hour of the chosen day, cached in memory for 10 minutes. The page shows day-wise, hour-wise, status-wise, direction, and team-wise charts (plain SVG/CSS, no chart library) before the tables.
- **Change (same day):** Team head-wise Call Yatri report. The Call Yatri external API has no teams or heads (checked: no endpoint, report ignores team filters), so heads and members are set in AIRO. Migration `012_call_team_heads.sql` (`call_team_heads`, `call_team_members`; one team per employee, head counted in own team). `GET/PUT /api/connections/:id/call-yatri/teams` (view/manage). UI: `TeamHeadReport` + `TeamHeadEditor` in `Connections.jsx`. Switch to API data if Call Yatri adds team heads.
- **Change (same day):** Call Yatri data is no longer stored. Calls / Follow-ups / Leads tabs read live from new `GET /api/connections/:id/call-yatri/records?kind=calls|followups|leads&day=YYYY-MM-DD|week` (first 100 rows, employee emails dropped). Sync only checks the API, clears the stats cache, and deletes any stored Call Yatri objects; it no longer saves rows or `callReport`. The Call Yatri webhook is rejected. WhatsApp reports no longer look up stored calls. Migration `013_call_yatri_live_only.sql` deletes existing Call Yatri rows from `integration_objects`.
- **Change (same day):** Meta Ads and Google Ads pages redesigned (`AdsHeader`, `AdsPerformance`, `TrendChart`, `Donut`, `FunnelSteps`, `AudienceBars` in `Connections.jsx`; plain SVG/CSS). New `GET /api/connections/:id/meta/report?range=LAST_7_DAYS|LAST_14_DAYS|LAST_30_DAYS|THIS_MONTH|LAST_MONTH` (`connections.view`, `metaReport` in `metaAds.js`): daily account insights, campaigns, publisher-platform and age/gender breakdowns, read live, not stored. `googleReport` also returns `devices` (spend by device). The Google report now loads on page open, not only on the Report tab.
- **Change (same day):** "Remember me" on the login page. Migration `011_refresh_remember.sql` adds `refresh_tokens.remember`; unchecked logins get a session cookie and a 1-day refresh token.
- **Affected areas:** `nexcall.js`, `connectionService`, `providers.js`, `migrate.js`, `whatsappReport.js`, `llm.js`, `authService`, `authRepo`, `cookies.js`, `schemas.js`, `Login.jsx`, `auth.jsx`, `Connections.jsx`, `styles.css`.
- **Migration/API impact:** Run `npm run migrate` (011, 012, 013 + provider rename). Client rebuild needed.

### 2026-10-03

- **Change:** Live Google Ads integration: `server/src/integrations/googleAds.js`, Google OAuth connect + account picker, sync, Search campaign create/edit/status, keyword ideas, live report. New env names `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_ADS_API_VERSION`. `liveRecord` now also returns `parent`.
- **Change (same day):** "Connect with Facebook" for Meta Ads (Facebook Login, account picker), sharing the OAuth helpers with Google. New env names `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_OAUTH_REDIRECT_URI`. Connection detail returns `tokenExpiresAt`. Added `npm run check:logins` (`server/src/scripts/checkLogins.js`).
- **Fix (same day):** WhatsApp Meta ad chat (`metaAdChat.js`): an open draft no longer captures "run Google/LinkedIn ads" messages (they get a "not from WhatsApp yet" reply), drafts idle for 24 hours are dropped, and skipping the photo ends the draft at `done` instead of asking to skip again.
- **Change (same day):** Added `npm run create:reviewer -- --email <email> [--org <name>]` (`server/src/scripts/createReviewer.js`): creates an empty client organization with an owner login and prints a one-time random password, for Meta/Google app reviewers. No email is sent by AIRO, so invited users cannot set a password in production.
- **Change (2026-10-05):** WhatsApp Google Ads flow (`googleAdChat.js`, migration `010_google_ad_drafts.sql`, `llmService.writeGoogleAdPlan`): "run google ads" → product, website, location, budget → Google keyword ideas + model-written headlines/descriptions → owner approves or sends an idea/edits → Search campaign saved PAUSED → "haan" publishes. Starting a Google draft closes an open Meta draft and vice versa. Meta chat now answers greetings during an open draft instead of re-asking for the photo. `listMetaAdAccounts` retries without `business{name}` and names missing scopes.
- **Reason:** Manage, create, and report on Google Ads from AIRO, and let many businesses connect Google and Meta without pasting tokens.
- **Affected areas:** `connectionService`, `connectionRepo.setAccountLabel`, routes, schemas, `env.js`, `Connections.jsx`, `styles.css`.
- **Migration/API impact:** No migration. New endpoints under `/api/connections/google/*`, `/api/connections/:id/google/*`, and public `/api/google-ads/callback`. Client rebuild needed.

### 2026-10-02

- **Change:** Added the AI context system: `AI.md`, `.ai/PROJECT.md`, `.ai/ARCHITECTURE.md`, `.ai/FILE_STRUCTURE.md` (generated), `.ai/API.md`, `.ai/DATABASE.md`, `.ai/RULES.md`, `.ai/CHANGELOG.md`, and `scripts/generate-ai-context.cjs`. Added `"ai:context"` script to root `package.json`.
- **Reason:** Give AI coding assistants an accurate, discovered map of the project and its rules.
- **Affected areas:** Documentation and tooling only. No application code changed by this entry.
- **Migration/API impact:** None.
