# Changelog

Significant structural changes only. Newest first.

### 2026-10-03

- **Change:** Live Google Ads integration: `server/src/integrations/googleAds.js`, Google OAuth connect + account picker, sync, Search campaign create/edit/status, keyword ideas, live report. New env names `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_ADS_API_VERSION`. `liveRecord` now also returns `parent`.
- **Reason:** Manage, create, and report on Google Ads from AIRO.
- **Affected areas:** `connectionService`, `connectionRepo.setAccountLabel`, routes, schemas, `env.js`, `Connections.jsx`, `styles.css`.
- **Migration/API impact:** No migration. New endpoints under `/api/connections/google/*`, `/api/connections/:id/google/*`, and public `/api/google-ads/callback`. Client rebuild needed.

### 2026-10-02

- **Change:** Added the AI context system: `AI.md`, `.ai/PROJECT.md`, `.ai/ARCHITECTURE.md`, `.ai/FILE_STRUCTURE.md` (generated), `.ai/API.md`, `.ai/DATABASE.md`, `.ai/RULES.md`, `.ai/CHANGELOG.md`, and `scripts/generate-ai-context.cjs`. Added `"ai:context"` script to root `package.json`.
- **Reason:** Give AI coding assistants an accurate, discovered map of the project and its rules.
- **Affected areas:** Documentation and tooling only. No application code changed by this entry.
- **Migration/API impact:** None.
