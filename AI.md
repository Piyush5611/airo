# AI.md — Start Here

This is the entry point for AI coding assistants working in this repository.

## Required workflow

1. **Read this file first.**
2. **Read only the `.ai/` files relevant to the task** (see the guide below). Do not load everything by default.
3. **Inspect the actual source code before changing anything.** The `.ai/` docs are a map, not a substitute for the code. If a doc and the code disagree, the code wins — then update the doc.
4. **Never assume technologies or architecture.** Everything here was discovered from files in the repo. Anything not confirmed is marked "Not detected" or "Needs verification".
5. **Reuse existing code.** Helpers already exist for SQL (`server/src/db/sql.js`), validation (`server/src/middleware/validate.js` + `server/src/validators/schemas.js`), errors (`server/src/utils/errors.js`), encryption (`server/src/utils/cryptoBox.js`), client data fetching (`client/src/data.js`, `client/src/api.js`) and UI primitives (`client/src/ui.jsx`).
6. **Make minimal, safe changes.** Change only what the task needs.
7. **Avoid new dependencies and unrequested refactors.**
8. **Do not break existing functionality.** Check callers before changing a function signature or response shape.
9. **Never expose secrets.** Do not read out, copy, log, or commit values from `.env` or decrypted credentials. Show at most the last 4 characters of a key.
10. **Update the docs** in `.ai/` when architecture, APIs, database schema, or important behaviour change, and add an entry to `.ai/CHANGELOG.md` for significant changes. Run `npm run ai:context` after adding, moving, or deleting files.

## Which file to read

| File | Read it when |
| --- | --- |
| `.ai/PROJECT.md` | You need the big picture: purpose, stack, features, roles, external services. |
| `.ai/ARCHITECTURE.md` | You are tracing a request, adding a layer, or touching auth, routing, WhatsApp, Meta Ads, LLM, or startup/migration flow. |
| `.ai/FILE_STRUCTURE.md` | You need to locate a file. Generated — never edit by hand. |
| `.ai/API.md` | You are adding, changing, or calling an HTTP endpoint. |
| `.ai/DATABASE.md` | You are writing SQL, adding a migration, or changing a table. |
| `.ai/RULES.md` | Always, before writing code. Contains project-specific constraints. |
| `.ai/CHANGELOG.md` | You need history of significant structural changes, or you made one. |

## Regenerating the file tree

```bash
npm run ai:context
```

This rewrites only `.ai/FILE_STRUCTURE.md`.
