# Aurify

Shopify-integrated order / inventory / fulfillment / returns operations platform.
Architecture reference: `docs/` (v2.1). Shopify is the source of truth for what it owns
(quantities, payment, fulfillment); Aurify owns internal operations (calls, assignment,
preparation, inspection, COD settlement).

## Requirements

- Node.js 26 (`.nvmrc`). 24.x also works while 26 is not LTS yet.
- pnpm 12.15.0 (`corepack enable` or `npm i -g pnpm@12.15.0`)
- Docker (PostgreSQL 18)

## First run

```bash
pnpm install                 # also runs `prisma generate`
cp .env.example .env         # fill ENCRYPTION_KEY: openssl rand -base64 32
docker compose up -d db
pnpm db:migrate --name init  # creates prisma/migrations/<ts>_init (commit it)
pnpm dev                     # web   → http://localhost:3000
pnpm worker                  # worker (separate process, same code)
```

## Checks (CI runs the same)

```bash
pnpm db:validate && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Layout

```
src/app/          pages, route handlers, server actions
src/modules/      one folder per module; other modules import only "@/modules/<name>" (index.ts)
src/server/       db (the only place with raw SQL), tenant context, logger
src/worker/       worker entrypoint (pg-boss)
prisma/           schema (sections 8 of the architecture doc)
```

## Rules that are enforced, not just written

- **Tenant isolation (D-19):** every tenant model query goes through the Prisma extension in
  `src/server/db`; without an `accountId` context it throws. `$queryRaw` and friends are
  forbidden outside `src/server/db` by ESLint.
- **Module boundaries:** deep imports into another module fail lint.
- **Permissions (D-07):** `src/modules/identity/permissions.ts`, one test per matrix row.
- **State machines:** pure functions in each module's `domain/`, tested without a database.

## Version policy

Exact versions only (`save-exact=true`). Each bump is its own PR. Prisma stays on 7.10.1 until
8 is GA; TypeScript stays on 6.0.3 until typescript-eslint supports 7. See section 10 of the
architecture doc.
