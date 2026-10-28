# Aurify — working rules

Shopify-integrated operations platform (orders, inventory, fulfillment, returns, COD) for the Egyptian
market. One Shopify Custom App per client store. Source of truth for design: `docs/architecture-v2.1.docx`
(decisions D-01…D-19). If code and the doc disagree, stop and say so; do not silently pick one.

## Communication
- The owner writes Egyptian Arabic; answer in Egyptian Arabic, direct and technical, no filler.
- Developer machine is Windows (PowerShell). Give PowerShell commands, not bash.

## Stack (pinned exact; always use the latest *verified* versions when adding/upgrading)
Node 26 · pnpm 12.15.0 · TypeScript 6 · Next 16 · React 19 · Prisma 7.10.1 (+adapter-pg; NOT 8 RC) ·
PostgreSQL 18 · pg-boss 12 · Better Auth 1.7.x · Zod 4 · next-intl 4 · Vitest 5 · Shopify Admin API 2026-10.
Verify a version on the registry before adding or bumping a dependency. `.npmrc` has save-exact.
"Latest" means the latest version that passes pnpm's supply-chain policy (release-age check). Never add
`minimumReleaseAgeExclude`; pick the newest version old enough instead.
Line endings are LF (`.gitattributes`); do not commit whole-file CRLF rewrites.

## Commands
- `pnpm install` · `pnpm dev` · `pnpm worker` (separate process) · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build`
- DB: `docker compose up -d db` (host port from `AURIFY_DB_PORT` in `.env`), `pnpm db:migrate --name <x>`
- Before every commit: `pnpm db:validate && pnpm typecheck && pnpm lint && pnpm test && pnpm build` must pass.
- Commit migrations (`prisma/migrations`). Never commit `.env`.

## Architecture rules (do not break)
- Modular monolith: `src/modules/<name>` owns its domain. Cross-module imports only through the module's `index.ts`
  (ESLint enforces it). Pure domain logic (state machines, permissions) has no I/O and is fully unit-tested.
- Tenant isolation is fail-closed (D-19): every tenant-model query runs inside `runWithTenant` (from the session,
  never from request input). Cross-tenant access only via `withSystemContext(reason)`, which is logged.
  Raw SQL (`$queryRaw`, `$executeRaw`) is banned outside `src/server/db`.
- Shopify is the source of truth for quantities, payment and fulfillment. All Shopify writes go through the
  outbox + worker (pg-boss), idempotent. Webhooks are signals: re-fetch the entity (D-17). HMAC is verified with
  the store's own app secret; failures return a uniform 401.
- State changes go through the state machines (`transition(...)`), never by writing `status` directly.
- Secrets (Shopify client secret, access tokens) are encrypted with `src/server/crypto.ts`; never log them
  (pino redaction is configured).
- Prisma 7: URL lives in `prisma.config.ts` (which loads `.env`); client is generated to `src/generated/prisma`
  and imported only via `src/server/db`.
- Prisma queries are lazy thenables. `runWithTenant` / `withSystemContext` are async and await the callback inside the
  scope; still write `async () => await db...` in callbacks so the query provably runs inside the context.
- `db` and `auth` are lazy on purpose so `next build` works without `DATABASE_URL`. Keep it that way.

## UI rules
- Arabic (RTL, default) and English (LTR) are both first-class (D-09). No hard-coded user-facing text:
  every string is a key in `messages/ar.json` AND `messages/en.json` (a test enforces identical keys).
- Use logical CSS properties (`margin-inline-start`, `padding-inline-end`, `text-align: start`), never left/right.
- Locale is a cookie (`NEXT_LOCALE`), not a URL prefix.

## Roles (D-07)
OWNER, ORDER_MANAGER, WAREHOUSE, SHIPPING, CUSTOMER_SERVICE (see `src/modules/identity/permissions.ts`).
Add a permission there first, with a test, then use `authorize`/`withMember` in the action.
