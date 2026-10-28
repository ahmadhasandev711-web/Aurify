import { describe, expect, it } from 'vitest';
import {
  AppConfigError,
  COMPLIANCE_TOPICS,
  SCOPES,
  SHOPIFY_API_VERSION,
  WEBHOOK_TOPICS,
  renderAppConfig,
} from './app-config';

const input = { slug: 'masastoreel', clientId: 'abc123', name: 'Anoofy · masastoreel', appUrl: 'https://anoofy.example.com' };

describe('renderAppConfig', () => {
  const toml = renderAppConfig(input);

  it('pins the API version and the non-embedded app settings', () => {
    expect(SHOPIFY_API_VERSION).toBe('2026-10');
    expect(toml).toContain('api_version = "2026-10"');
    expect(toml).toContain('embedded = false');
    expect(toml).toContain('client_id = "abc123"');
    expect(toml).toContain('application_url = "https://anoofy.example.com/"');
  });

  it('requests exactly the scopes from the architecture doc', () => {
    expect(toml).toContain(`scopes = "${SCOPES.join(',')}"`);
    for (const s of ['write_order_edits', 'read_returns', 'write_returns', 'write_inventory']) {
      expect(SCOPES).toContain(s);
    }
    expect(SCOPES).not.toContain('read_all_orders');
  });

  it('subscribes to every topic, and compliance topics in their own subscription', () => {
    for (const t of WEBHOOK_TOPICS) expect(toml).toContain(`"${t}"`);
    for (const t of COMPLIANCE_TOPICS) expect(toml).toContain(`"${t}"`);
    expect(toml).toContain('compliance_topics = [');
    expect(toml.match(/\[\[webhooks\.subscriptions\]\]/g)).toHaveLength(2);
  });

  it('points the webhook and OAuth callback at this app', () => {
    expect(toml).toContain('uri = "/api/webhooks/shopify"');
    expect(toml).toContain('redirect_urls = [ "https://anoofy.example.com/api/shopify/callback" ]');
  });

  it('escapes quotes in the name', () => {
    expect(renderAppConfig({ ...input, name: 'My "App"' })).toContain('name = "My \\"App\\""');
  });
});

describe('input validation', () => {
  it.each([
    [{ slug: 'Bad Slug' }, 'slug'],
    [{ slug: 'a' }, 'slug'],
    [{ clientId: ' ' }, 'clientId'],
    [{ name: '' }, 'name'],
    [{ appUrl: 'http://anoofy.example.com' }, 'https'],
    [{ appUrl: 'not a url' }, 'valid URL'],
    [{ appUrl: 'https://anoofy.example.com/app' }, 'path'],
  ])('rejects %j', (over, msg) => {
    expect(() => renderAppConfig({ ...input, ...over })).toThrow(AppConfigError);
    expect(() => renderAppConfig({ ...input, ...over })).toThrow(msg);
  });
});
