import { handleShopifyWebhook } from '@/modules/shopify';
import { shopifyWebhookDeps } from '@/server/shopify-webhook-deps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  // The HMAC is computed over the exact raw bytes, so read the body as text, never as parsed JSON.
  const rawBody = await req.text();
  const res = await handleShopifyWebhook({ headers: req.headers, rawBody }, shopifyWebhookDeps);
  return new Response(null, { status: res.status });
}
