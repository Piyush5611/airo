# API

**API layer: detected.** HTTP JSON API built with Express. All routes are defined in one file: `server/src/routes/index.js`, mounted at `/api` by `server/src/app.js`.

GraphQL, RPC, OpenAPI/Swagger spec: Not detected.

## Conventions

- **Success:** `{ "success": true, "data": ... }` via `ok()` in `server/src/controllers/http.js`. Create endpoints return `201`.
- **Error:** `{ "success": false, "error": { "code", "message", "details?" } }` via `server/src/middleware/errorHandler.js`. `details` only on `422` (zod flatten). `5xx` messages are replaced by a generic message when `NODE_ENV=production`.
- **Validation:** `validate(schema)` parses `{ body, query, params }` with zod schemas from `server/src/validators/schemas.js`. Failure → `422 validation_error`.
- **Auth header:** `Authorization: Bearer <access JWT>`. Refresh uses httpOnly cookie `airo_refresh` (path `/api/auth`).
- **Realms:** client routes require `realm = client`; `/api/admin/*` require `realm = platform`.
- **Support access tokens** (platform staff viewing a client org) are read-only: any non-GET on client routes → `403`.
- **Rate limits** (`app.js`): `/api/auth/login` 30 per 15 min; `/api/hooks/*` 60 per minute.
- **Body limit:** JSON 5 MB.
- **IDs:** `:id` params use `idParams` (positive integer, coerced).

Legend for the Auth column: **Public** = no auth; **User** = any authenticated user; otherwise the required permission key (see `server/src/domain/access.js`).

## Public and webhooks

| Method | Path | Auth | Purpose | Handler |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | Public | Service + DB status | `pingDatabase` |
| GET | `/api/whatsapp/webhook` | Public (Meta verify token) | Webhook verification (`hub.challenge`) | `whatsappService.verifyWebhook` |
| POST | `/api/whatsapp/webhook` | Public | Inbound WhatsApp messages; triggers async bot reply | `whatsappService.receiveWebhook` |
| GET | `/api/meta/webhook` | Public (`META_VERIFY_TOKEN`) | Meta webhook verification | `metaWebhookService.verifyWebhook` |
| POST | `/api/meta/webhook` | Public | Meta ad-account change events → `integration_objects` | `metaWebhookService.receiveWebhook` |
| POST | `/api/hooks/:token` | Public (per-connection token) | Generic inbound webhook for a connection | `connectionService.ingestWebhook` |

## Auth — `/api/auth`

| Method | Path | Auth | Validation | Purpose | Service |
| --- | --- | --- | --- | --- | --- |
| POST | `/login` | Public (rate-limited) | `loginSchema` (email, password 8–200) | Returns access token + user; sets refresh cookie | `authService.login` |
| POST | `/refresh` | Refresh cookie | — | Rotates refresh token, returns new access token | `authService.refresh` |
| POST | `/logout` | Refresh cookie | — | Revokes refresh token, clears cookie | `authService.logout` |
| POST | `/password/forgot` | Public | `forgotSchema` | Start password reset | `authService.forgotPassword` |
| POST | `/password/reset` | Public | `resetSchema` (token, password) | Complete reset | `authService.resetPassword` |
| GET | `/demo-hints` | Public | — | Demo login hints; `404` when not available | `authService.demoHints` |
| GET | `/me` | User | — | Current profile, permissions | `authService.me` |
| POST | `/switch` | User, client realm | `switchSchema` (organizationId) | Switch active organization | `authService.switchOrganization` |

## Assistant (both realms)

| Method | Path | Auth | Validation | Purpose | Service |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/assistant` | User | — | Assistant availability (public view of LLM config) | `llmService.assistantPublic` |
| POST | `/api/assistant/chat` | User | `llmChatSchema` (1–20 messages, ≤4000 chars) | LLM chat reply | `llmService.chatLlm` |

## Client workspace — `/api/*`

Middleware for all: `authenticate`, `requireRealm('client')`, `blockSupportWrites`.

### Command, leads, sources, campaigns

| Method | Path | Permission | Validation | Service |
| --- | --- | --- | --- | --- |
| GET | `/api/command` | `command.view` | — | `intelligenceService.command` |
| GET | `/api/leads` | `leads.view` | query passthrough | `growthService.leads` |
| GET | `/api/leads/export` | `leads.export` | — | `growthService.exportLeads` → CSV (`text/csv`) |
| POST | `/api/leads` | `leads.create` | `leadCreateSchema` | `growthService.createLead` (201) |
| GET | `/api/leads/:id` | `leads.view` | `idParams` | `growthService.lead` |
| PATCH | `/api/leads/:id` | `leads.update` | `idParams` + `leadUpdateSchema` | `growthService.updateLead` |
| POST | `/api/leads/:id/assign` | `leads.assign` | `idParams` + `assignSchema` (userId) | `growthService.assignLead` |
| DELETE | `/api/leads/:id` | `leads.delete` | `idParams` | `growthService.removeLead` |
| GET | `/api/sources` | `sources.view` | — | `growthService.leadSources` |
| GET | `/api/campaigns` | `campaigns.view` | — | `growthService.campaigns` |
| GET | `/api/campaigns/:id` | `campaigns.view` | `idParams` | `growthService.campaign` |

### Sales

| Method | Path | Permission | Validation | Service |
| --- | --- | --- | --- | --- |
| GET | `/api/pipeline` | `pipeline.view` | — | `salesService.pipeline` |
| GET | `/api/pipeline/:id` | `pipeline.view` | `idParams` | `salesService.opportunity` |
| PATCH | `/api/pipeline/:id` | `pipeline.update` | `idParams` + `moveSchema` (stageId, lostReason?) | `salesService.moveOpportunity` |
| GET | `/api/calls` | `calls.view` | — | `salesService.calls` |
| GET | `/api/calls/:id` | `calls.view` | `idParams` | `salesService.call` |
| GET | `/api/activities` | `activities.view` | — | `salesService.activities` |
| POST | `/api/activities/tasks` | `activities.create` | `taskSchema` | `salesService.createTask` (201) |
| POST | `/api/activities/tasks/:id/complete` | `activities.update` | `idParams` | `salesService.completeTask` |

### Intelligence and AI (records-based)

| Method | Path | Permission | Validation | Service |
| --- | --- | --- | --- | --- |
| GET | `/api/reports` | `reports.view` | — | `intelligenceService.reportList` |
| GET | `/api/reports/:slug` | `reports.view` | — | `intelligenceService.reportView` |
| GET | `/api/analytics?view=` | `analytics.view` | — (default `marketing`) | `intelligenceService.analytics` |
| GET | `/api/ai/insights` | `ai.use` | — | `intelligenceService.listInsights` |
| GET | `/api/ai/recommendations` | `ai.use` | — | `intelligenceService.listRecommendations` |
| PATCH | `/api/ai/recommendations/:id` | `ai.use` | `idParams` + `recommendationSchema` | `intelligenceService.setRecommendation` |
| GET | `/api/ai/monitoring` | `ai.use` | — | `intelligenceService.monitoring` |
| POST | `/api/ai/ask` | `ai.use` | `askSchema` (question 3–500, conversationId?) | `intelligenceService.ask` |
| GET | `/api/ai/history?conversationId=` | `ai.use` | — | `intelligenceService.history` |
| GET | `/api/notifications` | User | — | `intelligenceService.notifications` |
| POST | `/api/notifications/read-all` | User | — | `intelligenceService.readAllNotifications` |
| POST | `/api/notifications/:id/read` | User | `idParams` | `intelligenceService.readNotification` |
| GET | `/api/search?q=` | User | — | `intelligenceService.search` |
| GET | `/api/audit` | `audit.view` | — | `intelligenceService.clientAudit` |

### Connections

| Method | Path | Permission | Validation | Service (`connectionService`) |
| --- | --- | --- | --- | --- |
| GET | `/api/connections` | `connections.view` | — | `index` |
| POST | `/api/connections` | `connections.manage` | `connectSchema` (providerKey, accountLabel?) | `connect` (201) |
| POST | `/api/connections/api` | `connections.manage` | `providerApiSchema` (providerKey, apiKey, accountId?, baseUrl?) | `saveProviderApi` — verifies key before storing |
| GET | `/api/connections/:id` | `connections.view` | `idParams` | `detail` |
| PATCH | `/api/connections/:id` | `connections.manage` | `idParams` + `configSchema` (mapping, sync) | `updateConfig` |
| POST | `/api/connections/:id/nexcall-key` | `connections.manage` | `idParams` + `nexcallKeySchema` | `saveNexcallKey` |
| POST | `/api/connections/:id/sync` | `connections.manage` | `idParams` | `sync` |
| GET | `/api/connections/:id/meta/pages` | `connections.manage` | `idParams` | `metaPages` → `{ pages, note }` |
| POST | `/api/connections/:id/meta/pages` | `connections.manage` | `idParams` | `connectMetaPages` |
| GET | `/api/connections/:id/meta/audience?kind=&q=` | `connections.manage` | `idParams` | `metaAudienceSearch` |
| GET | `/api/connections/:id/meta/pixels` | `connections.manage` | `idParams` | `metaPixels` |
| GET | `/api/connections/:id/meta/instagram?pageId=` | `connections.manage` | `idParams` | `metaInstagram` |
| POST | `/api/connections/:id/meta/campaigns` | `connections.manage` | `idParams` + `metaCampaignSchema` | `createMetaCampaign` (201) |
| POST | `/api/connections/:id/meta/ads` | `connections.manage` | `idParams` + `metaAdSchema` (image base64 ≤4 MB string, targeting, budget, conversion, publish…) | `publishMetaAd` (201) |
| POST | `/api/connections/:id/meta/edit` | `connections.manage` | `idParams` + `metaEditSchema` | `editMetaAdCampaign` |
| POST | `/api/connections/:id/meta/status` | `connections.manage` | `idParams` + `metaStatusSchema` | `updateMetaCampaignStatus` |
| POST | `/api/connections/:id/disconnect` | `connections.manage` | `idParams` | `disconnect` |

### Workspace and WhatsApp (client)

| Method | Path | Permission | Validation | Service |
| --- | --- | --- | --- | --- |
| GET | `/api/team` | `users.view` | — | `workspaceService.team` |
| POST | `/api/team/invite` | `users.invite` | `inviteSchema` | `workspaceService.invite` (201) |
| GET | `/api/settings` | `settings.view` | — | `workspaceService.settings` |
| PATCH | `/api/settings` | `settings.manage` | `settingSchema` (key, value object) | `workspaceService.updateSettings` |
| GET | `/api/whatsapp/live` | `leads.view` | — | SSE stream, `whatsappService.streamClientLive` |
| GET | `/api/whatsapp` | `leads.view` | — | `whatsappService.clientInbox` |
| POST | `/api/whatsapp/numbers` | `settings.manage` | `whatsappNumberSchema` (phone, label?) | `whatsappService.addBusinessNumber` (201) |
| PATCH | `/api/whatsapp/numbers/:id` | `settings.manage` | `idParams` + `whatsappNumberSchema` | `whatsappService.updateBusinessNumber` |
| DELETE | `/api/whatsapp/numbers/:id` | `settings.manage` | `idParams` | `whatsappService.removeBusinessNumber` |
| GET | `/api/whatsapp/leads/:id` | `leads.view` | `idParams` | `whatsappService.clientLeadChats` |
| GET | `/api/whatsapp/conversations/:id` | `leads.view` | `idParams` | `whatsappService.clientConversation` |

## Platform — `/api/admin/*`

Middleware for all: `authenticate`, `requireRealm('platform')`. Service is `platformService` unless noted.

| Method | Path | Permission | Validation | Handler |
| --- | --- | --- | --- | --- |
| GET | `/overview` | `platform.overview.view` | — | `overview` |
| GET | `/organizations` | `organizations.view` | — | `organizations` |
| GET | `/organizations/:id` | `organizations.view` | `idParams` | `organization` |
| POST | `/organizations/:id/support-access` | `organizations.impersonate` | `idParams` | `supportAccess` → read-only client token |
| GET | `/users` | `platform_users.view` | — | `users` |
| POST | `/users/invite` | `platform_users.invite` | `platformInviteSchema` | `invitePlatformUser` (201) |
| PATCH | `/users/:id` | `platform_users.manage` | `idParams` + `statusSchema` | `setUserStatus` |
| GET | `/sales` | `platform_sales.view` | — | `sales` |
| PATCH | `/sales/:id` | `platform_sales.manage` | `idParams` + `saleSchema` | `updateSale` |
| GET | `/support` | `support.view` | — | `support` |
| GET | `/support/:id` | `support.view` | `idParams` | `supportTicket` |
| POST | `/support/:id/notes` | `support.manage` | `idParams` + `noteSchema` | `addSupportNote` |
| GET | `/finance` | `finance.view` | — | `finance` |
| GET | `/moderation` | `moderation.view` | — | `moderation` |
| PATCH | `/moderation/:id` | `moderation.manage` | `idParams` + `moderationSchema` | `actOnModeration` |
| GET | `/analytics` | `platform_analytics.view` | — | `overview` (same handler as `/overview`) |
| GET | `/integrations` | `platform_integrations.view` | — | `integrations` |
| POST | `/integrations/api-keys` | `platform_integrations.manage` | `apiKeySchema` | `createApiKey` (201) |
| GET | `/ai` | `platform_ai.view` | — | `ai` + `canManage` flag |
| POST | `/ai/models` | `platform_ai.manage` | `llmModelsSchema` | `llmService.llmModels` (live provider model list) |
| POST | `/ai/connect` | `platform_ai.manage` | `llmConnectSchema` (purpose, provider, model, apiKey?) | `llmService.connectLlm` |
| POST | `/ai/disconnect` | `platform_ai.manage` | `llmDisconnectSchema` | `llmService.disconnectLlm` |
| GET | `/security` | `security.view` | — | `security` |
| GET | `/settings` | `platform_settings.view` | — | `settings` |
| PATCH | `/settings` | `platform_settings.manage` | `settingSchema` | `updateSettings` |
| GET | `/whatsapp/live` | `whatsapp_bot.manage` | — | SSE, `whatsappService.streamLive` |
| GET | `/whatsapp` | `whatsapp_bot.manage` | — | `whatsappService.overview` |
| POST | `/whatsapp/connect` | `whatsapp_bot.manage` | `whatsappConnectSchema` | `whatsappService.connectBot` (verifies with Graph first) |
| POST | `/whatsapp/disconnect` | `whatsapp_bot.manage` | — | `whatsappService.disconnectBot` |
| PATCH | `/whatsapp` | `whatsapp_bot.manage` | `whatsappBotSchema` | `whatsappService.updateBot` |
| PATCH | `/whatsapp/businesses` | `whatsapp_bot.manage` | `whatsappBusinessSchema` | `whatsappService.setBusiness` |
| GET | `/whatsapp/conversations/:id` | `whatsapp_bot.manage` | `idParams` | `whatsappService.conversation` |
| POST | `/whatsapp/conversations/:id/messages` | `whatsapp_bot.manage` | `idParams` + `whatsappSendSchema` | `whatsappService.sendMessage` (201) |
| GET | `/search?q=` | User (platform) | — | `search` |

## Outbound APIs called by the server

Documented in `PROJECT.md` → External services. Key files: `server/src/integrations/metaAds.js` (Graph v21.0), `server/src/integrations/nexcall.js`, `server/src/integrations/llm.js`, `server/src/integrations/verify.js`, and Graph calls inside `server/src/services/whatsappService.js`.
