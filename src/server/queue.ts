// Producer-side pg-boss for the web process. The worker owns schema migration and queue
// creation; the web process only sends jobs, so it runs with supervision/scheduling off.

import { PgBoss } from 'pg-boss';
import { logger } from './logger';

const g = globalThis as unknown as { __anoofyBoss?: Promise<PgBoss> };

export function getQueue(): Promise<PgBoss> {
  g.__anoofyBoss ??= (async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    const boss = new PgBoss({ connectionString, supervise: false, schedule: false, migrate: false });
    boss.on('error', (err) => logger.error({ err }, 'pg-boss (web) error'));
    await boss.start();
    return boss;
  })().catch((err) => {
    g.__anoofyBoss = undefined; // allow a retry on the next request
    throw err;
  });
  return g.__anoofyBoss;
}
