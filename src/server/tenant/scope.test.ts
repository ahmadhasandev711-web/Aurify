import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runWithTenant, requireAccountId, TenantContextMissingError, withSystemContext, getTenantStore } from './context';
import { scopeArgs, TENANT_MODELS, TenantScopeError } from './scope';

describe('scopeArgs', () => {
  it('adds accountId to reads and keeps the caller filter', () => {
    expect(scopeArgs('findMany', { where: { storeId: 's1' } }, 'a1')).toEqual({ where: { storeId: 's1', accountId: 'a1' } });
    expect(scopeArgs('findMany', undefined, 'a1')).toEqual({ where: { accountId: 'a1' } });
  });

  it('scopes unique lookups, updates and deletes', () => {
    for (const op of ['findUnique', 'update', 'delete', 'updateMany', 'deleteMany', 'count']) {
      expect(scopeArgs(op, { where: { id: 'x' } }, 'a1').where).toEqual({ id: 'x', accountId: 'a1' });
    }
  });

  it('refuses a where that targets another account', () => {
    expect(() => scopeArgs('findMany', { where: { accountId: 'a2' } }, 'a1')).toThrow(TenantScopeError);
  });

  it('stamps accountId on create and createMany', () => {
    expect(scopeArgs('create', { data: { name: 'x' } }, 'a1').data).toEqual({ name: 'x', accountId: 'a1' });
    expect(scopeArgs('createMany', { data: [{ n: 1 }, { n: 2 }] }, 'a1').data).toEqual([
      { n: 1, accountId: 'a1' },
      { n: 2, accountId: 'a1' },
    ]);
  });

  it('refuses to create rows for another account', () => {
    expect(() => scopeArgs('create', { data: { accountId: 'a2' } }, 'a1')).toThrow(TenantScopeError);
    expect(() => scopeArgs('createMany', { data: [{ accountId: 'a2' }] }, 'a1')).toThrow(TenantScopeError);
  });

  it('scopes upsert on both sides', () => {
    const r = scopeArgs('upsert', { where: { id: 'x' }, create: { n: 1 }, update: { n: 2 } }, 'a1');
    expect(r.where).toEqual({ id: 'x', accountId: 'a1' });
    expect(r.create).toEqual({ n: 1, accountId: 'a1' });
  });

  it('refuses unknown operations instead of running them unscoped', () => {
    expect(() => scopeArgs('somethingNew', {}, 'a1')).toThrow(TenantScopeError);
  });
});

describe('tenant context', () => {
  it('throws outside a context, works inside', () => {
    expect(() => requireAccountId()).toThrow(TenantContextMissingError);
    expect(runWithTenant('a1', () => requireAccountId())).toBe('a1');
  });

  it('rejects an empty accountId', () => {
    expect(() => runWithTenant('', () => 1)).toThrow(TenantContextMissingError);
  });

  it('system context needs a reason and is visible to the db layer', () => {
    expect(() => withSystemContext(' ', () => 1)).toThrow(TenantContextMissingError);
    expect(withSystemContext('retention cleanup', () => getTenantStore()?.systemReason)).toBe('retention cleanup');
  });

  it('survives async boundaries', async () => {
    const id = await runWithTenant('a9', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return requireAccountId();
    });
    expect(id).toBe('a9');
  });
});

describe('TENANT_MODELS stays in sync with the Prisma schema', () => {
  it('lists exactly the models that have an accountId column', () => {
    const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
    const withAccountId = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+accountId\s/m.test(body ?? ''))
      .map(([, name]) => name as string)
      .sort();
    expect(withAccountId).toEqual([...TENANT_MODELS].sort());
  });
});
