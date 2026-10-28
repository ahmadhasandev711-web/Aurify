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

export function runWithTenant<T>(accountId: string, fn: () => T): T {
  if (!accountId) throw new TenantContextMissingError('empty accountId');
  return storage.run({ accountId }, fn);
}

/** Platform Admin and scheduled cleanup jobs only. Every use must carry a reason. */
export function withSystemContext<T>(reason: string, fn: () => T): T {
  if (!reason.trim()) throw new TenantContextMissingError('system context needs a reason');
  return storage.run({ systemReason: reason }, fn);
}

export function requireAccountId(): string {
  const s = storage.getStore();
  if (!s?.accountId) throw new TenantContextMissingError('no accountId in context');
  return s.accountId;
}
