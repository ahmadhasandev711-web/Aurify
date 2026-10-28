// Real dependencies for the Shopify webhook endpoint (see src/modules/shopify/webhook-handler.ts).

import type { WebhookDeps } from '@/modules/shopify';
import { db, Prisma } from './db';
import { decryptSecret } from './crypto';
import { getQueue } from './queue';
import { QUEUES, type WebhookJobPayload } from './queues';
import { runWithTenant, withSystemContext } from './tenant/context';

export const shopifyWebhookDeps: WebhookDeps = {
  async findStoreCredentials(shopDomain) {
    // No tenant exists yet: the shop domain is how we find it. Explicit, logged system context.
    const store = await withSystemContext('webhook: resolve store by shop domain', () =>
      db.store.findUnique({
        where: { shopDomain },
        select: { id: true, accountId: true, status: true, shopifyApp: { select: { clientSecretEnc: true } } },
      }),
    );
    if (!store || store.status === 'DISCONNECTED') return null;
    return {
      accountId: store.accountId,
      storeId: store.id,
      appSecret: decryptSecret(store.shopifyApp.clientSecretEnc),
    };
  },

  async recordEvent({ accountId, storeId, topic, webhookId, payload }) {
    return runWithTenant(accountId, async () => {
      try {
        await db.webhookEvent.create({
          data: { storeId, topic, webhookId, payload: payload as Prisma.InputJsonValue } as never,
        });
        return 'created' as const;
      } catch (err) {
        // Unique (storeId, webhookId): Shopify delivered the same webhook again.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate' as const;
        throw err;
      }
    });
  },

  async enqueue(job) {
    const boss = await getQueue();
    const payload: WebhookJobPayload = job;
    await boss.send(QUEUES.webhook, payload, { singletonKey: job.webhookId });
  },
};
