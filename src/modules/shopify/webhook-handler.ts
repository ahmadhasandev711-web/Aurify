// Core of the Shopify webhook endpoint (D-14, D-17). Framework- and DB-free: the route
// handler passes real dependencies, tests pass fakes.
//
// Order of operations:
//   1. identify the store from X-Shopify-Shop-Domain, fetch THAT store's app secret
//   2. verify HMAC over the raw body with that secret
//   3. store the event under a unique (storeId, webhookId); duplicates are acknowledged, not re-queued
//   4. enqueue processing and answer 200 quickly
// Any identification or signature failure returns the same bare 401, so the response never
// reveals which shops are registered with us.

import { verifyShopifyWebhookHmac } from './hmac';

export interface StoreCredentials {
  accountId: string;
  storeId: string;
  appSecret: string;
}

export interface WebhookDeps {
  findStoreCredentials(shopDomain: string): Promise<StoreCredentials | null>;
  recordEvent(e: {
    accountId: string;
    storeId: string;
    topic: string;
    webhookId: string;
    payload: unknown;
  }): Promise<'created' | 'duplicate'>;
  enqueue(job: { accountId: string; storeId: string; topic: string; webhookId: string }): Promise<void>;
}

export interface WebhookRequest {
  headers: { get(name: string): string | null };
  rawBody: string;
}

export interface WebhookResponse {
  status: 200 | 400 | 401 | 500;
}

// Used when the shop is unknown, so an unknown shop costs the same HMAC work as a known one.
const DUMMY_SECRET = 'unknown-shop-dummy-secret';

export async function handleShopifyWebhook(req: WebhookRequest, deps: WebhookDeps): Promise<WebhookResponse> {
  const shop = req.headers.get('x-shopify-shop-domain');
  const topic = req.headers.get('x-shopify-topic');
  const webhookId = req.headers.get('x-shopify-webhook-id');
  const hmac = req.headers.get('x-shopify-hmac-sha256');

  if (!shop || !hmac) return { status: 401 };

  let creds: StoreCredentials | null;
  try {
    creds = await deps.findStoreCredentials(shop.toLowerCase());
  } catch {
    return { status: 500 };
  }

  const valid = verifyShopifyWebhookHmac(req.rawBody, hmac, creds?.appSecret ?? DUMMY_SECRET);
  if (!creds || !valid) return { status: 401 };

  // Signed but malformed: nothing useful to retry.
  if (!topic || !webhookId) return { status: 400 };

  let payload: unknown;
  try {
    payload = JSON.parse(req.rawBody || '{}');
  } catch {
    return { status: 400 };
  }

  try {
    const result = await deps.recordEvent({
      accountId: creds.accountId,
      storeId: creds.storeId,
      topic,
      webhookId,
      payload,
    });
    if (result === 'created') {
      await deps.enqueue({ accountId: creds.accountId, storeId: creds.storeId, topic, webhookId });
    }
    return { status: 200 };
  } catch {
    // Shopify retries non-2xx responses.
    return { status: 500 };
  }
}
