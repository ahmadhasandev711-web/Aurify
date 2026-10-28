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
  it('throws outside a context, works inside', async () => {
    expect(() => requireAccountId()).toThrow(TenantContextMissingError);
    await expect(runWithTenant('a1', () => requireAccountId())).resolves.toBe('a1');
  });

  it('rejects an empty accountId', async () => {
    await expect(runWithTenant('', () => 1)).rejects.toBeInstanceOf(TenantContextMissingError);
  });

  it('system context needs a reason and is visible to the db layer', async () => {
    await expect(withSystemContext(' ', () => 1)).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(withSystemContext('retention cleanup', () => getTenantStore()?.systemReason)).resolves.toBe(
      'retention cleanup',
    );
  });

  it('survives async boundaries', async () => {
    const id = await runWithTenant('a9', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return requireAccountId();
    });
    expect(id).toBe('a9');
  });

  // Regression: Prisma queries are lazy thenables that only run on .then(). Returning one straight out of
  // the callback used to execute it after the scope had ended (TenantContextMissingError on every login).
  it('runs a lazy thenable inside the scope, not after it', async () => {
    // Like a PrismaPromise: does nothing until someone calls .then().
    const lazy = <T,>(get: () => T): PromiseLike<T> => ({
      then: (onFulfilled) => {
        const value = get();
        return Promise.resolve(onFulfilled ? onFulfilled(value) : value) as never;
      },
    });
    await expect(runWithTenant('a5', () => lazy(() => requireAccountId()))).resolves.toBe('a5');
    await expect(withSystemContext('why', () => lazy(() => getTenantStore()?.systemReason))).resolves.toBe('why');
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
