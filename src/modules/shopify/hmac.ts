import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies X-Shopify-Hmac-Sha256: base64(HMAC-SHA256(rawBody, appSecret)).
 * The body must be the exact raw bytes Shopify sent, not re-serialized JSON.
 */
export function verifyShopifyWebhookHmac(rawBody: string | Buffer, hmacHeader: string | null | undefined, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(hmacHeader, 'base64');
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
