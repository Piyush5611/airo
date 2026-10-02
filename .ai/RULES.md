# Rules for AI Coding Assistants

## General

1. **Inspect before modifying.** Read the route, service, repository, schema, and client page involved before changing code.
2. **Reuse existing implementation.** Search for an existing helper, service function, or UI component before writing a new one.
3. **Avoid duplicate functionality.** Extend the existing service/integration rather than creating a parallel path.
4. **Follow existing conventions** (below).
5. **No new dependencies** unless the task cannot be done with what exists. Ask first.
6. **No unrequested refactors**, renames, or file moves.
7. **Do not delete functionality** without explicit approval.
8. **Never expose secrets** — `.env` values, decrypted credentials, tokens, DB passwords. Never paste them into code, docs, logs, chat, or commits.
9. **Do not change the architecture** (layers, realms, provider model) without approval.
10. **Keep docs current.** Update `.ai/` for architecture/API/schema changes; run `npm run ai:context` when files are added, moved, or removed.

## Project conventions (from the code)

- **ES modules everywhere** (`"type": "module"`). Use `import`/`export`. Only `scripts/*.cjs` use CommonJS.
- **Routes live only in `server/src/routes/index.js`.** Each route: `requirePermission(...)` (if needed) → `validate(schema)` → `asyncHandler` → `ok(res, data)`.
- **Validation:** add/extend zod schemas in `server/src/validators/schemas.js` using the `body(...)` / `params(...)` helpers.
- **Errors:** throw `new ApiError(status, message, code)` from `server/src/utils/errors.js`. Use `422 validation_error` for user-fixable problems. Messages are short, plain sentences shown to users.
- **SQL:** use `many` / `one` / `insert` / `run` from `server/src/db/sql.js` with `?` placeholders. Never build SQL from user input by string concatenation. Put queries in `server/src/repositories/`.
- **Tenancy:** every client query must filter by `req.auth.organizationId`. Lead queries must apply `leadScope(auth)` from `server/src/utils/scope.js`.
- **Permissions:** new capabilities need a permission key in `server/src/domain/access.js` and a grant on the right roles. Platform grants are synced by `migrate.js`; client grants come from the seed / role setup.
- **Audit:** state-changing actions call `recordAudit` (`server/src/services/auditService.js`). Do not store secrets, phone lists, or message bodies in audit metadata.
- **Schema changes:** add a new numbered file `server/src/db/migrations/0NN_name.sql`. Never edit an applied migration. Production does not auto-migrate.
- **Credentials:** store provider secrets only via `encryptJson` into `integration_credentials` / `*_ciphertext`. Show at most the last 4 characters.
- **Client data fetching:** use `api` from `client/src/api.js` and `useResource` from `client/src/data.js`. Relative `/api/...` paths only.
- **Client UI:** use components from `client/src/ui.jsx` and formatters from `client/src/format.js`. Gate UI with `useAuth().can(permission)` and nav `permission` fields in `client/src/shell.jsx`.
- **Comments:** sparse. Only state constraints the code cannot show.

## Project-specific rules

- **Two realms, never mixed.** Platform (`/platform`, `/api/admin`) is internal AIRO staff; client workspace (`/app`, `/api/*`) is a business. Client roles are only Owner, Admin, Member, Viewer. Platform roles are the eight in `access.js`.
- **External systems are providers inside Connections**, not sidebar modules (`server/src/domain/providers.js`). Do not add Google Ads, Meta, portals, CRMs, etc. as top-level modules.
- **WhatsApp is one shared platform chatbot**, managed with `whatsapp_bot.manage`. Organizations only register business numbers (`whatsapp_business_numbers`, globally unique `phone_key`). Client users must never see other organizations' data or the bot's phone number.
- **No fake live data.** Do not invent KPIs, spend, competitor data, or mark a connection "connected" before the provider key is verified. A failed verification must not store the key. `server/src/integrations/adapters.js` is development-only sample data and must not be presented as live.
- **Meta ads are created paused**; publishing is a separate explicit step. Do not force a special ad category or demographic targeting; those are user choices.
- **LLM:** do not preselect models — list them live from the provider. One model per purpose. Do not send organization records to the model beyond what the existing prompts already include.
- **Support access is read-only.** Do not add write paths that bypass `blockSupportWrites` / `requirePermission`.
- **Never run `npm run seed` against real data** — it truncates every table.
- **Do not commit `.env`.** `.env.example` lists variable names only.
- **Client changes need `npm run build`; schema changes need `npm run migrate`** in production. Note this when handing off.
- **Stray files:** `body.txt` and `tmp-body.txt` at the root contain a captured API error response. Do not rely on them; ask before deleting.
