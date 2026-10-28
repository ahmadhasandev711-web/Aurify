// The only place that builds a PrismaClient, and the only place allowed to use raw SQL
// (enforced by ESLint). Every tenant-model query goes through the tenant extension (D-19).

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { getTenantStore, TenantContextMissingError } from '../tenant/context';
import { scopeArgs, TENANT_MODELS } from '../tenant/scope';
import { logger } from '../logger';

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const base = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  return base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          const store = getTenantStore();
          if (store?.systemReason) {
            logger.warn({ model, operation, reason: store.systemReason }, 'system-context query');
            return query(args);
          }
          if (!store?.accountId) {
            throw new TenantContextMissingError(`${model}.${operation} ran without a tenant context`);
          }
          return query(scopeArgs(operation, args as Record<string, unknown>, store.accountId));
        },
      },
    },
  });
}

type Db = ReturnType<typeof createClient>;
const globalForDb = globalThis as unknown as { __aurifyDb?: Db };

export const db: Db = (globalForDb.__aurifyDb ??= createClient());
