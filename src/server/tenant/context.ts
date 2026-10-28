// Tenant context (D-19). The accountId comes from the session (web) or from the job payload
// (worker) — never from request input. Without a context, tenant-scoped queries throw.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  accountId?: string;
  /** Set only by withSystemContext: queries are not scoped, and the reason is logged. */
  systemReason?: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

export class TenantContextMissingError extends Error {
  constructor(detail: string) {
    super(`Tenant context missing: ${detail}`);
    this.name = 'TenantContextMissingError';
  }
}

export function getTenantStore(): TenantStore | undefined {
  return storage.getStore();
}

// Prisma queries are lazy: they only execute on `.then()`. If a helper returned the un-awaited query,
// it would run AFTER the AsyncLocalStorage scope ended and throw TenantContextMissingError. So both
// helpers are async and await `fn()` inside the scope, which makes the mistake impossible at call sites.
export async function runWithTenant<T>(accountId: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (!accountId) throw new TenantContextMissingError('empty accountId');
  return storage.run({ accountId }, async () => await fn());
}

/** Platform Admin and scheduled cleanup jobs only. Every use must carry a reason. */
export async function withSystemContext<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (!reason.trim()) throw new TenantContextMissingError('system context needs a reason');
  return storage.run({ systemReason: reason }, async () => await fn());
}

export function requireAccountId(): string {
  const s = storage.getStore();
  if (!s?.accountId) throw new TenantContextMissingError('no accountId in context');
  return s.accountId;
}
