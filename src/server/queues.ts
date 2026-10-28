// Queue names and job payload rules shared by the web app (producer) and the worker (consumer).

export const QUEUES = {
  webhook: 'shopify.webhook',
  sync: 'shopify.sync',
  reconcile: 'shopify.reconcile',
  retention: 'maintenance.retention',
} as const;

/** Every job carries its tenant (D-19). A job without it is rejected. */
export interface JobPayload {
  accountId: string;
  storeId: string;
}

export interface WebhookJobPayload extends JobPayload {
  topic: string;
  webhookId: string;
}

export function assertTenantPayload(data: unknown): asserts data is JobPayload {
  const d = data as Partial<JobPayload> | null;
  if (!d || typeof d.accountId !== 'string' || !d.accountId || typeof d.storeId !== 'string' || !d.storeId) {
    throw new Error('Job rejected: payload must include accountId and storeId');
  }
}

/** Group id used to serialize jobs on the same entity (D-12). */
export const entityGroup = (storeId: string, entityType: string, entityId: string) => ({
  id: `${storeId}:${entityType}:${entityId}`,
});
