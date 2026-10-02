# Database

**Database: detected.**

| Item | Value | Evidence |
| --- | --- | --- |
| Technology | MySQL-compatible (InnoDB engine, `JSON` columns, `utf8mb4_unicode_ci`). MySQL vs MariaDB — Needs verification. | `server/src/config/db.js` (`mysql2/promise`), `server/src/db/migrate.js`, `*.sql` |
| Access | Raw parameterized SQL. No ORM. | `server/src/db/sql.js` (`many`, `one`, `insert`, `run`), `server/src/repositories/*.js` |
| Pool | `connectionLimit: 10`, `timezone: 'Z'` (UTC), `dateStrings: true`, `decimalNumbers: true` | `server/src/config/db.js` |
| Config | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` from root `.env` (values never documented) | `server/src/config/env.js` |

## Migrations

- Location: `server/src/db/migrations/NNN_name.sql`, applied in filename order by `server/src/db/migrate.js`.
- Applied IDs stored in `schema_migrations`. `001_schema.sql` always re-runs (all `CREATE TABLE IF NOT EXISTS`); later files run once.
- `migrate.js` also: creates the database if missing, syncs platform permissions/grants from `server/src/domain/access.js`, ensures `whatsapp_bot` row id 1 and one `whatsapp_businesses` row per organization.
- Development server runs migrations on start; **production (`NODE_ENV=production`) does not** — run `npm run migrate`.
- Seed (`npm run seed`, `server/src/db/seed.js`) **truncates every table except `schema_migrations`** and inserts demo data. Never run it against real data.

| File | Change |
| --- | --- |
| `001_schema.sql` | Core schema (all tables below except those listed next). |
| `002_whatsapp.sql` | `whatsapp_bot`, `whatsapp_businesses`, `whatsapp_conversations`, `whatsapp_messages`. |
| `003_whatsapp_connect.sql` | `whatsapp_bot` + `provider_name`, `credential_ciphertext`, `connected_at`. |
| `004_whatsapp_api.sql` | `whatsapp_bot` + `api_version`, `phone_number_id`. |
| `005_connection_webhook.sql` | `integration_connections` + `webhook_token` (unique). |
| `006_llm.sql` | `llm_connection`. |
| `007_llm_purposes.sql` | `llm_connection.id` auto-increment, + `purpose` (unique). |
| `008_whatsapp_numbers.sql` | `whatsapp_business_numbers`. |
| `009_meta_ad_drafts.sql` | `meta_ad_drafts`. |

## Conventions

- PKs: `BIGINT UNSIGNED AUTO_INCREMENT` (a few singleton/config tables differ).
- Tenant column: `organization_id` with FK to `organizations(id)`, usually `ON DELETE CASCADE`.
- Money: `DECIMAL(14,2)` with `_inr` suffix.
- Timestamps: `DATETIME`, stored in UTC.
- Secrets: `*_ciphertext` / `ciphertext` columns hold AES-256-GCM encrypted JSON (`server/src/utils/cryptoBox.js`). Tokens stored as SHA-256 hashes (`token_hash`, `key_hash`).

## Tables

Columns listed are the important ones; see the SQL file for the full definition. FK = foreign key, UQ = unique key, IX = index.

### Identity, tenancy, access

| Table | Key columns | Relationships / keys |
| --- | --- | --- |
| `schema_migrations` | `id`, `applied_at` | PK `id` |
| `users` | `email`, `password_hash`, `full_name`, `phone`, `realm` (`platform`/`client`), `status` (`active`/`invited`/`suspended`), `last_login_at` | UQ `email` |
| `sessions` | `user_id`, `ip`, `user_agent`, `started_at`, `ended_at` | FK `user_id → users` |
| `refresh_tokens` | `user_id`, `organization_id`, `token_hash`, `expires_at`, `revoked_at`, `replaced_by` | UQ `token_hash`; IX `user_id`; FK `user_id → users` |
| `password_resets` | `user_id`, `token_hash`, `expires_at`, `used_at` | IX `token_hash`; FK `user_id → users` |
| `organizations` | `name`, `legal_name`, `slug`, `city`, `status`, `health_score`, `onboarding_step` | UQ `slug` |
| `workspaces` | `organization_id`, `name`, `slug`, `is_default` | UQ (`organization_id`, `slug`); FK org |
| `roles` | `scope`, `role_key`, `name`, `is_system` | UQ (`scope`, `role_key`) |
| `permissions` | `scope`, `perm_key`, `resource_name`, `action_name` | UQ (`scope`, `perm_key`) |
| `role_permissions` | `role_id`, `permission_id` | PK both; FK → `roles`, `permissions` |
| `user_roles` | `user_id`, `role_id`, `organization_id` (NULL = platform role) | UQ (`user_id`, `role_id`, `organization_id`); FK → `users`, `roles`, `organizations` |
| `organization_users` | `organization_id`, `user_id`, `role_id`, `status` | UQ (`organization_id`, `user_id`) |
| `teams` | `organization_id`, `name` | UQ (`organization_id`, `name`) |
| `team_members` | `team_id`, `user_id` | PK both |
| `data_scopes` | `organization_id`, `user_id`, `resource_name`, `scope_type` (`all`/`team`/`assigned`) | UQ (`organization_id`, `user_id`, `resource_name`) |

### Billing

| Table | Key columns | Relationships |
| --- | --- | --- |
| `plans` | `plan_key`, `name`, `monthly_inr` | UQ `plan_key` |
| `subscriptions` | `organization_id`, `plan_id`, `status`, `current_period_end` | FK org, `plans` |
| `invoices` | `organization_id`, `subscription_id`, `invoice_number`, `amount_inr`, `status`, `issued_on`, `due_on` | UQ `invoice_number` |
| `payments` | `organization_id`, `invoice_id`, `amount_inr`, `status`, `method_label`, `failure_reason`, `paid_at` | FK org, `invoices` |
| `credits` | `organization_id`, `amount_inr`, `reason` | FK org |
| `refunds` | `organization_id`, `payment_id`, `amount_inr`, `reason` | FK org, `payments` |

### Integrations (Connections)

| Table | Key columns | Relationships |
| --- | --- | --- |
| `integration_providers` | `category`, `provider_key`, `name`, `availability` | UQ `provider_key` |
| `integration_connections` | `organization_id`, `provider_id`, `status`, `account_label`, `mode` (`development`/`live`), `webhook_token`, `connected_at`, `last_sync_at` | UQ (`organization_id`, `provider_id`), UQ `webhook_token` |
| `integration_credentials` | `connection_id` (PK), `ciphertext` | FK → connections (cascade) |
| `integration_configs` | `connection_id` (PK), `mapping_json`, `sync_json` | FK → connections |
| `integration_objects` | `organization_id`, `connection_id`, `object_type`, `external_id`, `name`, `parent_external_id`, `payload` JSON | UQ (`connection_id`, `object_type`, `external_id`); IX (`organization_id`, `object_type`) |
| `integration_sync_jobs` | `connection_id`, `organization_id`, `status`, `started_at`, `finished_at`, `summary` | FK connections, org |
| `integration_sync_logs` | `job_id`, `level`, `message` | FK → jobs |
| `integration_errors` | `connection_id`, `organization_id`, `code`, `message`, `resolved_at` | FK connections, org |
| `webhook_events` | `organization_id`, `connection_id`, `event_name`, `status`, `payload` | No FKs |

### Growth

| Table | Key columns | Relationships |
| --- | --- | --- |
| `lead_sources` | `organization_id`, `name`, `category`, `provider_key` | UQ (`organization_id`, `name`) |
| `campaigns` | `organization_id`, `workspace_id`, `source_id`, `provider_key`, `external_id`, `name`, `project`, `status`, `budget_inr`, `start_date`, `end_date` | UQ (`organization_id`, `external_id`); IX (`organization_id`, `status`) |
| `campaign_metrics` | `campaign_id`, `metric_date`, `impressions`, `clicks`, `spend_inr`, `leads`, `qualified_leads` | UQ (`campaign_id`, `metric_date`); IX (`organization_id`, `metric_date`) |
| `leads` | `organization_id`, `workspace_id`, `source_id`, `campaign_id`, `assigned_user_id`, `external_id`, `full_name`, `phone`, `email`, `project`, `city`, `status` (`new`…`unqualified`), `score`, `intent`, `budget_inr`, `configuration`, `notes_summary` | UQ (`organization_id`, `external_id`); IX status, assigned, created; FK sources, campaigns, users |
| `lead_assignments` | `lead_id`, `from_user_id`, `to_user_id`, `assigned_by` | FK lead, org |
| `lead_activities` | `lead_id`, `actor_user_id`, `activity_type`, `body` | FK lead, org |
| `lead_tags` / `lead_tag_links` | tag `name`; link (`lead_id`, `tag_id`) | UQ (`organization_id`, `name`) |
| `lead_scores` | `lead_id`, `score`, `reason` | FK lead, org |

### Sales

| Table | Key columns | Relationships |
| --- | --- | --- |
| `pipelines` | `organization_id`, `name`, `is_default` | FK org |
| `pipeline_stages` | `pipeline_id`, `name`, `stage_key`, `sort_order` | UQ (`pipeline_id`, `stage_key`) |
| `opportunities` | `pipeline_id`, `stage_id`, `lead_id`, `owner_user_id`, `title`, `project`, `value_inr`, `status`, `lost_reason`, `expected_on` | IX (`organization_id`, `status`) |
| `opportunity_activities` | `opportunity_id`, `actor_user_id`, `body` | FK opportunity |
| `calls` | `lead_id`, `agent_user_id`, `direction`, `status`, `started_at`, `duration_seconds`, `outcome`, `provider_key` | IX (`organization_id`, `started_at`) |
| `call_recordings` | `call_id`, `storage_key`, `duration_seconds`, `available`, `note` | UQ `call_id` |
| `call_transcripts` | `call_id`, `body` | UQ `call_id` |
| `call_analysis` | `call_id`, `summary`, `buying_signals` JSON, `objections` JSON, `score` | UQ `call_id` |
| `tasks` | `assignee_user_id`, `title`, `status`, `due_at`, `related_type`, `related_id` | FK org, users |
| `notes` | `author_user_id`, `subject_type`, `subject_id`, `body` | FK org, users |
| `reminders` | `user_id`, `title`, `remind_at`, `related_type`, `related_id` | FK org, users |
| `activities` | `actor_user_id`, `activity_type`, `title`, `body`, `subject_type`, `subject_id`, `occurred_at` | IX (`organization_id`, `occurred_at`) |

### Intelligence and AI

| Table | Key columns | Relationships |
| --- | --- | --- |
| `reports` | `organization_id`, `slug`, `name`, `report_kind`, `config_json`, `is_custom` | UQ (`organization_id`, `slug`) |
| `ai_conversations` | `organization_id`, `user_id`, `title` | FK org, users |
| `ai_messages` | `conversation_id`, `role`, `content`, `payload` | FK conversation |
| `ai_insights` | `insight_key`, `title`, `body`, `evidence`, `severity`, `action_path` | UQ (`organization_id`, `insight_key`) |
| `ai_recommendations` | `rec_key`, `category`, `title`, `body`, `evidence`, `status` | UQ (`organization_id`, `rec_key`) |
| `ai_alerts` | `alert_key`, `category`, `priority` | UQ (`organization_id`, `alert_key`) |
| `ai_usage_logs` | `organization_id`, `user_id`, `surface`, `prompt_excerpt` | No FKs |
| `llm_connection` | `id`, `purpose` (UQ), `provider`, `model_name`, `base_url`, `status`, `credential_ciphertext`, `key_preview` | One row per purpose |

### Platform operations

| Table | Key columns | Relationships |
| --- | --- | --- |
| `tickets` | `organization_id`, `assignee_user_id`, `subject`, `category`, `priority`, `status`, `sla_due_at` | FK org, users |
| `ticket_messages` | `ticket_id`, `author_user_id`, `author_name`, `body` | FK ticket |
| `ticket_events` | `ticket_id`, `event_name` | FK ticket |
| `audit_logs` | `organization_id`, `actor_user_id`, `action`, `resource_name`, `resource_id`, `metadata`, `ip` | IX (`organization_id`, `created_at`), IX `actor_user_id`; no FKs |
| `security_events` | `organization_id`, `event_type`, `severity`, `message`, `ip`, `metadata` | No FKs |
| `notifications` | `user_id`, `notification_key`, `category`, `priority`, `title`, `body`, `action_path`, `read_at` | IX (`user_id`, `read_at`, `created_at`); FK users |
| `platform_prospects` | `company_name`, `contact_name`, `city`, `stage`, `value_inr`, `owner_user_id`, `next_follow_up` | FK users |
| `platform_settings` | `setting_key` (PK), `setting_value` JSON | — |
| `organization_settings` | (`organization_id`, `setting_key`) PK, `setting_value` JSON | FK org |
| `moderation_items` | `organization_id`, `item_type`, `summary`, `status`, `severity` | FK org |
| `platform_api_keys` | `name`, `key_prefix`, `key_hash`, `created_by`, `revoked_at` | FK users |
| `platform_webhooks` | `name`, `target_url`, `event_name`, `status` | — |
| `oauth_clients` | `name`, `client_public_id`, `redirect_uri`, `status` | UQ `client_public_id` |

### WhatsApp and Meta ad chat

| Table | Key columns | Relationships |
| --- | --- | --- |
| `whatsapp_bot` | singleton `id = 1`; `display_name`, `phone_label`, `status`, `mode`, `webhook_path`, `provider_name`, `credential_ciphertext`, `api_version`, `phone_number_id`, `connected_at` | — |
| `whatsapp_businesses` | `organization_id`, `enabled`, `business_label` | UQ `organization_id`; FK org |
| `whatsapp_business_numbers` | `organization_id`, `phone`, `phone_key` (last 10 digits), `label` | **UQ `phone_key` globally**; FK org |
| `whatsapp_conversations` | `organization_id`, `contact_name`, `contact_phone`, `topic`, `status`, `last_message_at` | IX (`organization_id`, `last_message_at`) |
| `whatsapp_messages` | `conversation_id`, `direction`, `body`, `action_taken`, `created_at` | FK conversation (cascade) |
| `meta_ad_drafts` | `organization_id`, `conversation_id`, `step`, `payload` JSON, `campaign_id`, `updated_at` | UQ `conversation_id`; FK org, conversation |

## Important query modules

| File | Area |
| --- | --- |
| `server/src/repositories/authRepo.js` | Users, memberships, refresh tokens, resets |
| `server/src/repositories/growthRepo.js` | Leads, sources, campaigns |
| `server/src/repositories/salesRepo.js` | Pipeline, calls, activities, tasks |
| `server/src/repositories/intelRepo.js` | Reports, analytics, insights, notifications, audit |
| `server/src/repositories/connectionRepo.js` | Connections, credentials, objects, sync jobs (`upsertObject`, `liveConnections`) |
| `server/src/repositories/workspaceRepo.js` | Team, settings |
| `server/src/repositories/platformRepo.js` | Platform overview, orgs, users, sales, support, finance, moderation |
| `server/src/repositories/whatsappRepo.js` | Bot, businesses, numbers, conversations, messages |
| `server/src/repositories/llmRepo.js` | `llm_connection` |
| `server/src/services/metaAdChat.js` | Direct SQL on `meta_ad_drafts` |
| `server/src/utils/scope.js` | Lead data-scope SQL fragment |
