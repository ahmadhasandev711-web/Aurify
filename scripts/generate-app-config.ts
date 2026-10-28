// Usage:
//   pnpm app-config --slug masastoreel --client-id <id> --name "Anoofy · masastoreel" --url https://anoofy.example.com
// Writes shopify/apps/shopify.app.<slug>.toml. Then: shopify app deploy --config <slug>

import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { renderAppConfig } from '../src/modules/shopify/app-config';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    'client-id': { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
  },
});

try {
  const toml = renderAppConfig({
    slug: values.slug ?? '',
    clientId: values['client-id'] ?? '',
    name: values.name ?? '',
    appUrl: values.url ?? '',
  });
  mkdirSync('shopify/apps', { recursive: true });
  const file = `shopify/apps/shopify.app.${values.slug}.toml`;
  writeFileSync(file, toml);
  console.log(`wrote ${file}\nnext: shopify app deploy --config ${values.slug}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
