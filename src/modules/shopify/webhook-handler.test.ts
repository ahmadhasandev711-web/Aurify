import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifyShopifyWebhookHmac } from './hmac';
import { handleShopifyWebhook, type WebhookDeps } from './webhook-handler';

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64');

const SECRET_A = 'secret-of-store-a';
const SECRET_B = 'secret-of-store-b';
const body = JSON.stringify({ id: 123, name: '#1001' });

function headers(over: Record<string, string | null> = {}) {
  const h: Record<string, string | null> = {
    'x-shopify-shop-domain': 'store-a.myshopify.com',
    'x-shopify-topic': 'orders/create',
    'x-shopify-webhook-id': 'wh_1',
    'x-shopify-hmac-sha256': sign(body, SECRET_A),
    ...over,
  };
  return { get: (n: string) => h[n.toLowerCase()] ?? null };
}

function makeDeps(over: Partial<WebhookDeps> = {}) {
  const deps: WebhookDeps = {
    findStoreCredentials: vi.fn(async (shop: string) =>
      shop === 'store-a.myshopify.com'
        ? { accountId: 'acc_a', storeId: 'st_a', appSecret: SECRET_A }
        : shop === 'store-b.myshopify.com'
          ? { accountId: 'acc_b', storeId: 'st_b', appSecret: SECRET_B }
          : null,
    ),
    recordEvent: vi.fn(async () => 'created' as const),
    enqueue: vi.fn(async () => {}),
    ...over,
  };
  return deps;
}

describe('verifyShopifyWebhookHmac', () => {
  it('accepts a correct signature', () => {
    expect(verifyShopifyWebhookHmac(body, sign(body, SECRET_A), SECRET_A)).toBe(true);
  });
  it('rejects a wrong secret, a changed body, and junk', () => {
    expect(verifyShopifyWebhookHmac(body, sign(body, SECRET_A), SECRET_B)).toBe(false);
    expect(verifyShopifyWebhookHmac(body + ' ', sign(body, SECRET_A), SECRET_A)).toBe(false);
    expect(verifyShopifyWebhookHmac(body, 'not-base64!!', SECRET_A)).toBe(false);
    expect(verifyShopifyWebhookHmac(body, '', SECRET_A)).toBe(false);
    expect(verifyShopifyWebhookHmac(body, null, SECRET_A)).toBe(false);
  });
});

describe('handleShopifyWebhook', () => {
  it('accepts, records and enqueues a valid webhook', async () => {
    const deps = makeDeps();
    const res = await handleShopifyWebhook({ headers: headers(), rawBody: body }, deps);
    expect(res).toEqual({ status: 200 });
    expect(deps.recordEvent).toHaveBeenCalledWith({
      accountId: 'acc_a',
      storeId: 'st_a',
      topic: 'orders/create',
      webhookId: 'wh_1',
      payload: { id: 123, name: '#1001' },
    });
    expect(deps.enqueue).toHaveBeenCalledWith({ accountId: 'acc_a', storeId: 'st_a', topic: 'orders/create', webhookId: 'wh_1' });
  });

  it('acknowledges a duplicate delivery without enqueuing again', async () => {
    const deps = makeDeps({ recordEvent: vi.fn(async () => 'duplicate' as const) });
    expect(await handleShopifyWebhook({ headers: headers(), rawBody: body }, deps)).toEqual({ status: 200 });
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a wrong signature', async () => {
    const deps = makeDeps();
    const res = await handleShopifyWebhook({ headers: headers({ 'x-shopify-hmac-sha256': sign(body, 'nope') }), rawBody: body }, deps);
    expect(res).toEqual({ status: 401 });
    expect(deps.recordEvent).not.toHaveBeenCalled();
  });

  it('rejects a webhook for store A signed with store B\'s secret', async () => {
    const deps = makeDeps();
    const res = await handleShopifyWebhook(
      { headers: headers({ 'x-shopify-hmac-sha256': sign(body, SECRET_B) }), rawBody: body },
      deps,
    );
    expect(res).toEqual({ status: 401 });
    expect(deps.recordEvent).not.toHaveBeenCalled();
  });

  it('returns the same 401 for an unknown shop as for a bad signature', async () => {
    const deps = makeDeps();
    const unknown = await handleShopifyWebhook(
      { headers: headers({ 'x-shopify-shop-domain': 'ghost.myshopify.com' }), rawBody: body },
      deps,
    );
    const bad = await handleShopifyWebhook({ headers: headers({ 'x-shopify-hmac-sha256': sign(body, 'x') }), rawBody: body }, deps);
    expect(unknown).toEqual(bad);
    expect(unknown).toEqual({ status: 401 });
  });

  it('rejects missing identification headers', async () => {
    const deps = makeDeps();
    expect(await handleShopifyWebhook({ headers: headers({ 'x-shopify-shop-domain': null }), rawBody: body }, deps)).toEqual({ status: 401 });
    expect(await handleShopifyWebhook({ headers: headers({ 'x-shopify-hmac-sha256': null }), rawBody: body }, deps)).toEqual({ status: 401 });
  });

  it('normalizes the shop domain case before lookup', async () => {
    const deps = makeDeps();
    const res = await handleShopifyWebhook(
      { headers: headers({ 'x-shopify-shop-domain': 'STORE-A.myshopify.com' }), rawBody: body },
      deps,
    );
    expect(res).toEqual({ status: 200 });
  });

  it('returns 400 for a signed webhook without topic or id', async () => {
    const deps = makeDeps();
    expect(await handleShopifyWebhook({ headers: headers({ 'x-shopify-topic': null }), rawBody: body }, deps)).toEqual({ status: 400 });
    expect(await handleShopifyWebhook({ headers: headers({ 'x-shopify-webhook-id': null }), rawBody: body }, deps)).toEqual({ status: 400 });
  });

  it('returns 500 (so Shopify retries) when storage or the queue fails', async () => {
    const failingStore = makeDeps({ recordEvent: vi.fn(async () => { throw new Error('db down'); }) });
    expect(await handleShopifyWebhook({ headers: headers(), rawBody: body }, failingStore)).toEqual({ status: 500 });
    const failingQueue = makeDeps({ enqueue: vi.fn(async () => { throw new Error('queue down'); }) });
    expect(await handleShopifyWebhook({ headers: headers(), rawBody: body }, failingQueue)).toEqual({ status: 500 });
    const failingLookup = makeDeps({ findStoreCredentials: vi.fn(async () => { throw new Error('db down'); }) });
    expect(await handleShopifyWebhook({ headers: headers(), rawBody: body }, failingLookup)).toEqual({ status: 500 });
  });
});
