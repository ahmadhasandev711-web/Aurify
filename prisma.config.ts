import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env by itself, so load it here (Node's built-in loader).
try {
  process.loadEnvFile('.env');
} catch {
  // no .env: fall back to the local-dev default below
}

// Prisma 7: the connection URL lives here, not in schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://aurify:aurify@localhost:54329/aurify',
  },
});
