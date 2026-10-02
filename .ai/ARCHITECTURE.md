# Architecture

Discovered from source. Components not listed here were not found.

## Overview

```
Browser (React SPA, client/)
   │  fetch('/api/...')  Authorization: Bearer <access JWT>
   │  cookie airo_refresh (httpOnly, path /api/auth)
   ▼
Express app (server/src/app.js)
   helmet → cors(CLIENT_ORIGIN) → express.json(5mb) → rate limits → /api router
   │
   ├─ routes/index.js        route table, middleware per route
   │     authenticate → requireRealm → requirePermission → validate(zod)
   ├─ services/*.js          business logic
   ├─ repositories/*.js      SQL (via db/sql.js helpers)
   ├─ integrations/*.js      outbound HTTP to Meta, WhatsApp, Nexcall, LLM providers
   └─ middleware/errorHandler.js   uniform JSON errors
   ▼
MySQL-compatible database (mysql2 pool, config/db.js)
```

Inbound webhooks (Meta, WhatsApp, generic connection hooks) enter the same Express app without user auth.

## Layers (server)

| Layer | Path | Responsibility |
| --- | --- | --- |
| Entry | `server/src/server.js` | Migrate (non-production only), ping DB, listen, refresh insights. |
| App | `server/src/app.js` | Middleware stack, mounts `/api`. |
| Routes | `server/src/routes/index.js` | Single file. Public, auth, client (`/api/*`), and platform (`/api/admin/*`) routers. |
| Controller helper | `server/src/controllers/http.js` | `ok(res, data, status)` → `{ success: true, data }`. |
| Middleware | `server/src/middleware/` | `authenticate`, `requireRealm`, `requirePermission`, `blockSupportWrites`, `validate`, `errorHandler`, `notFound`. |
| Validation | `server/src/validators/schemas.js` | zod schemas over `{ body, query, params }`. |
| Services | `server/src/services/` | Domain logic per area (auth, growth, sales, connections, intelligence, workspace, platform, whatsapp, llm, metaAdChat, whatsappReport, metaWebhook, audit). |
| Repositories | `server/src/repositories/` | Raw parameterized SQL per area. |
| Integrations | `server/src/integrations/` | `metaAds.js`, `nexcall.js`, `llm.js`, `verify.js`, `adapters.js` (dev-only sample adapters). |
| Domain constants | `server/src/domain/` | Roles/permissions (`access.js`), provider catalog (`providers.js`), LLM purposes (`llmPurposes.js`). |
| DB tooling | `server/src/db/` | `migrate.js`, `seed.js`, `sql.js`, `migrations/*.sql`. |
| Utils | `server/src/utils/` | `errors.js` (ApiError, asyncHandler), `cryptoBox.js` (AES-GCM, token hashing), `cookies.js`, `scope.js` (lead data scope SQL). |

## Request lifecycle

```
request
  → authenticate        verify JWT (JWT_SECRET); load user, permissions, data scopes from DB
  → requireRealm        'client' or 'platform'
  → blockSupportWrites  support-access tokens are read-only (client router)
  → requirePermission   permission keys must all be granted
  → validate(schema)    zod parse; 422 on failure
  → service             business logic, audit logging
  → repository          SQL through db/sql.js (many/one/insert/run)
  → ok(res, data)       { success: true, data }
errors → errorHandler   { success: false, error: { code, message, details? } }
                        5xx messages are hidden in production
```

## Multi-tenancy

- Every client-workspace row carries `organization_id`; the JWT carries `organizationId` and services filter by `req.auth.organizationId`.
- Lead visibility is further narrowed by `utils/scope.js` (`assigned` / `team` / `all`). Owner, Admin, and support access see all.
- `server/src/tests/isolation.test.js` covers tenant isolation, realm separation, and lead scope (requires a seeded DB).

## Authentication

```
POST /api/auth/login  → bcrypt compare → access JWT (15m) in body
                                        + refresh token cookie (14d, hash in refresh_tokens)
POST /api/auth/refresh → rotate refresh token → new access JWT
POST /api/admin/organizations/:id/support-access → read-only client JWT (supportAccess: true)
```

Client side: `client/src/api.js` keeps the access token in memory, retries once via `/api/auth/refresh` on 401, and emits `airo:unauthorized` if refresh fails. `client/src/auth.jsx` (React context) boots the session and exposes `login`, `logout`, `enterSupport`, `can(permission)`.

## Client (frontend)

```
main.jsx → BrowserRouter → AuthProvider → App (routes)
   /login, /reset-password
   /app/*       <Require realm="client">   Shell(clientNav)   → pages/*
   /platform/*  <Require realm="platform"> Shell(platformNav) → pages/*
```

- Routing: `client/src/App.jsx`. Navigation + permission gating of menu items: `client/src/shell.jsx`.
- State management: React state + one context (`AuthContext`). Data fetching hook `useResource(path)` in `client/src/data.js`. No global store library.
- Shared UI: `client/src/ui.jsx` (Page, State, Badge, MetricStrip, Table, LineChart, Funnel, Insight, Subnav). Formatting: `client/src/format.js`.
- Live updates: Server-Sent Events from `/api/whatsapp/live` and `/api/admin/whatsapp/live` (`server/src/services/whatsappLive.js`, in-process EventEmitter).

## Connections (external providers)

```
Connections page → /api/connections/*
   connectionService
     ├─ verify key (integrations/verify.js, metaAds.verifyMetaAccount, nexcall.verifyNexcall)
     ├─ store encrypted secret → integration_credentials (cryptoBox AES-256-GCM)
     ├─ sync: live pull (Meta Ads, Nexcall) or development adapter (others)
     └─ normalized objects → integration_objects, jobs/logs → integration_sync_jobs/_logs
```

External systems are **providers inside Connections**, not separate modules (`server/src/domain/providers.js`). Inbound generic webhooks: `POST /api/hooks/:token` (token = `integration_connections.webhook_token`).

## Shared WhatsApp chatbot

```
Meta → POST /api/whatsapp/webhook
  whatsappService.receiveWebhook
    → storeInbound: match sender phone (last 10 digits) to whatsapp_business_numbers.phone_key
                    → conversation assigned to that organization
    → answerWithModel (async, fire-and-forget)
         ├─ inbound image? download via Graph media API
         ├─ metaAdChat.handleMetaAdChat   ("run meta ads" draft flow, meta_ad_drafts)
         └─ else llmService.replyWhatsapp (+ whatsappReport for Nexcall call reports)
    → deliverWhatsapp: Graph /{phone_number_id}/messages (only within 24h of last inbound)
    → whatsapp_messages + SSE notify
```

One bot for the whole platform (`whatsapp_bot` row id 1), managed by platform permission `whatsapp_bot.manage`. Organizations register their own business numbers.

## Meta Ads creation

`server/src/integrations/metaAds.js` creates objects **paused**: campaign → ad set → (image upload, optional lead form) → creative → ad; publishing sets ACTIVE. Used by both the Connections UI (`/api/connections/:id/meta/*`) and the WhatsApp `metaAdChat` flow. Click-to-Messenger leads run under objective `OUTCOME_ENGAGEMENT` (`campaignObjective()`).

## LLM

- Platform connects providers (OpenAI, Anthropic, Gemini) per purpose (`assistant`, `whatsapp`, `leads`, `ads`, `calls`) → `llm_connection` table, encrypted key.
- `POST /api/assistant/chat` is available to authenticated users of both realms.
- `/api/ai/*` (client "AI Assistant", insights, recommendations, monitoring) is computed from DB records by `intelligenceService`, separate from the LLM chat.

## Database

MySQL-compatible via `mysql2/promise` pool (`timezone: 'Z'`, `dateStrings: true`). Migrations are ordered `.sql` files tracked in `schema_migrations`. See `DATABASE.md`.

## Build and run

| Command (root) | Effect |
| --- | --- |
| `npm run dev` | `concurrently` server (`node --watch src/server.js`) + client (`vite`, port 5173, proxies `/api` → `localhost:4000`). |
| `npm run build` | `vite build` → `client/dist`. |
| `npm run start` | `node src/server.js` in `server/`. |
| `npm run migrate` | Apply pending migrations. |
| `npm run seed` | **Truncates all tables** then loads demo data. Development only. |
| `npm run setup` | install + migrate + seed. |
| `npm test` | `node --test src/tests/isolation.test.js`. |
| `npm run ai:context` | Regenerate `.ai/FILE_STRUCTURE.md`. |

The Express app does not serve `client/dist`; how static files are served in production — **Needs verification** (no config in repo).
