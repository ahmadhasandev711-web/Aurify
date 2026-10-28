// Worker process entrypoint (D-12). Same repo and code as the web app, separate process.
// Every job carries accountId + storeId in its payload; the handler sets the tenant context
// from it (D-19). A job without them is rejected.

import { PgBoss } from 'pg-boss';
import { logger } from '../server/logger';
import { runWithTenant } from '../server/tenant/context';
import { QUEUES, assertTenantPayload, type JobPayload } from '../server/queues';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const boss = new PgBoss(connectionString);
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();

  for (const name of Object.values(QUEUES)) {
    // D-12: exponential backoff, 8 attempts, then failed (shown in the sync dashboard).
    await boss.createQueue(name, { retryLimit: 8, retryDelay: 5, retryBackoff: true });
  }

  // One job at a time per entity group, many entities in parallel.
  await boss.work<JobPayload>(QUEUES.sync, { groupConcurrency: 1 }, async (jobs) => {
    for (const job of jobs) {
      assertTenantPayload(job.data);
      await runWithTenant(job.data.accountId, async () => {
        logger.info({ jobId: job.id, storeId: job.data.storeId }, 'sync job received (handler not implemented yet)');
      });
    }
  });

  logger.info('worker started');

  const shutdown = async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    logger.error({ err }, 'worker crashed');
    process.exit(1);
  });
}
