# Project

## Name

**AIRO.** Evidence: `client/index.html` (`<title>AIRO</title>`), root `package.json` (`"name": "airo"`), `server/src/server.js` log line "AIRO API listening", `README.md` (`# airo`).

## Purpose

AI-assisted real estate growth and sales platform. Evidence: `client/index.html` meta description "AIRO — AI-powered real estate growth and sales intelligence", lead model with `project`, `configuration`, `site_visit`, `booked` statuses (`001_schema.sql`), and real-estate portal providers (MagicBricks, 99acres, Housing.com, NoBroker in `server/src/domain/providers.js`).

It has two separate areas:

- **Client workspace** (`/app`) — a business (organization) manages leads, campaigns, pipeline, calls, reports, connections, WhatsApp, and AI tools.
- **Platform** (`/platform`) — internal AIRO staff manage organizations, platform users, sales, support, finance, moderation, integrations, the shared WhatsApp chatbot, LLM connections, and security.

## Project type

**Full-stack web application in an npm workspaces monorepo** (root `package.json` → `"workspaces": ["server", "client"]`).

- `client/` — single-page application.
- `server/` — HTTP JSON API + MySQL-compatible database.

## Technology stack (detected)

| Area | Technology | Evidence |
| --- | --- | --- |
| Language | JavaScript (ES modules), JSX | `"type": "module"` in `server/package.json` and `client/package.json`; `.jsx` files |
| Runtime | Node.js `>=20` | `server/package.json` `engines` |
| Frontend | React 19, React DOM 19 | `client/package.json` |
| Routing (client) | React Router DOM 7 | `client/package.json`, `client/src/App.jsx` |
| Build tool | Vite 6 + `@vitejs/plugin-react` | `client/package.json`, `client/vite.config.js` |
| Backend | Express 4 | `server/package.json`, `server/src/app.js` |
| Security middleware | helmet, cors, express-rate-limit | `server/src/app.js` |
| Validation | zod | `server/src/validators/schemas.js` |
| Auth | jsonwebtoken (JWT), bcryptjs | `server/src/services/authService.js` |
| Database driver | mysql2 (promise pool) | `server/src/config/db.js` |
| Config | dotenv (root `.env`) | `server/src/config/env.js` |
| Tests | Node built-in test runner (`node --test`) | `server/package.json`, `server/src/tests/isolation.test.js` |
| Dev orchestration | concurrently | root `package.json` |
| Styling | Plain CSS (`client/src/styles.css`) | No CSS framework detected |

Not detected: TypeScript, ORM, CSS framework, state-management library, Docker, CI/CD config.

## Database

MySQL-compatible (mysql2 driver, InnoDB, `JSON` columns). Exact server (MySQL vs MariaDB) — **Needs verification**. See `DATABASE.md`.

## Main modules

Client workspace (from `client/src/shell.jsx` `clientNav` and `client/src/App.jsx`):

- Command center: Overview, AI insights
- Growth: Campaigns, Lead sources, Leads, WhatsApp
- Sales: Pipeline, Calls, Activities
- Intelligence: Reports, Analytics
- Integrations: Connections (external providers)
- AI workspace: Assistant (LLM chat), AI Assistant (records-based Q&A), Recommendations, Monitoring
- Workspace: Team, Settings

Platform (from `platformNav`): Overview, Organizations (with read-only support access), Platform Users & Access, Platform Sales, Customer Support, Finance & Billing, Content & Moderation, Platform Analytics, Integrations & Technical, WhatsApp Chatbot, Platform AI, Security & Audit, Platform Settings, Assistant.

## User roles (`server/src/domain/access.js`)

- **Client roles:** Owner, Admin, Member, Viewer.
- **Platform roles:** Super Admin, Operations Admin, Support Admin, Sales Admin, Finance Admin, Content/Moderation, Analyst, Developer/Admin.

Permissions are keyed strings (e.g. `leads.view`, `platform_ai.manage`) stored in DB tables `roles`, `permissions`, `role_permissions`, `user_roles`. Per-user lead data scope (`all` / `team` / `assigned`) lives in `data_scopes`.

## Authentication

- Email + password login (bcrypt hashes).
- Short-lived JWT access token (15 min) sent as `Authorization: Bearer`.
- Refresh token (14 days) in an httpOnly cookie `airo_refresh` scoped to `/api/auth`; hashed in `refresh_tokens`.
- Password reset via hashed tokens in `password_resets`.
- Platform "support access": a platform user with `organizations.impersonate` can get a read-only client token for an organization.

## External services (detected in code)

| Service | Where | Notes |
| --- | --- | --- |
| Meta Graph / Marketing API (v21.0) | `server/src/integrations/metaAds.js` | Verify account, pull campaigns/ad sets/ads/insights, list Pages/pixels/Instagram, audience search, Ad Library search, create campaign/ad set/creative/ad, change status. |
| Facebook Login (Meta OAuth) | `server/src/integrations/metaAds.js` (`metaAuthUrl`, `exchangeMetaCode`, `listMetaAdAccounts`) | "Connect with Facebook" per organization. Needs `META_APP_ID`, `META_APP_SECRET`; optional `META_LOGIN_CONFIG_ID`. |
| Meta webhooks | `server/src/services/metaWebhookService.js` | `/api/meta/webhook`. |
| Google Ads API (REST, `GOOGLE_ADS_API_VERSION`, default v25) + Google OAuth | `server/src/integrations/googleAds.js` | OAuth sign-in (scope `adwords`), list accessible accounts (incl. via manager), pull campaigns/ad groups/ads/keywords + 30-day metrics, live report (daily, campaigns, keywords, search terms), location/language search, keyword ideas, create Search campaign (paused), edit name/budget, enable/pause. Needs `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`. |
| WhatsApp Cloud API (Graph) | `server/src/services/whatsappService.js` | Shared platform chatbot: webhook receive, send text, download inbound media. |
| Nexcall / W-Caller external API | `server/src/integrations/nexcall.js` | Read-only, `x-api-key`; leads, calls, call report, follow-ups. |
| OpenAI, Anthropic, Google Gemini | `server/src/integrations/llm.js` | List models, chat replies. One model per purpose (`server/src/domain/llmPurposes.js`). |
| Google, LinkedIn, HubSpot, Salesforce token checks | `server/src/integrations/verify.js` | Key verification only. |
| Other providers (portals, CRMs, analytics…) | `server/src/integrations/adapters.js` | **Development adapters only** — they return fixed sample objects and call no live API. |

## Storage

- Relational data: MySQL-compatible DB.
- Provider credentials: AES-256-GCM encrypted JSON in DB (`server/src/utils/cryptoBox.js`).
- File/object storage: **Not detected.** `call_recordings.storage_key` exists but no storage client is implemented. Ad images are forwarded to Meta (`adimages`) and not stored locally.
- Browser: access token in memory; support-access token in `sessionStorage`.

## Deployment

**No deployment configuration is present in the repository** (no Dockerfile, CI workflow, PM2 ecosystem file, or web-server config). Detected facts:

- `npm run build` builds the client to `client/dist` (gitignored).
- `npm run start` runs `node server/src/server.js`.
- In production (`NODE_ENV=production`) the server does **not** auto-migrate; `npm run migrate` must be run manually.
- The client calls relative `/api` paths; in development Vite proxies `/api` to `http://localhost:4000`.

Hosting provider, process manager, and reverse proxy — **Needs verification** (not defined in repo files).

## Important dependencies

Server: express, cors, helmet, express-rate-limit, jsonwebtoken, bcryptjs, mysql2, zod, dotenv.
Client: react, react-dom, react-router-dom; dev: vite, @vitejs/plugin-react.
Root dev: concurrently.

## Environment variables (names only — see `.env.example`)

`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (required at startup by `env.js`, but no other code reads it — refresh tokens are random opaque values), `PORT`, `NODE_ENV`, `CLIENT_ORIGIN`, `CREDENTIALS_KEY` (optional; falls back to a key derived from `JWT_SECRET`), `WHATSAPP_VERIFY_TOKEN`, `META_VERIFY_TOKEN`, `SEED_PASSWORD` (development seed only).
