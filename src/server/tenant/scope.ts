// Pure query-scoping logic used by the Prisma extension (D-19). Kept free of Prisma imports
// so it can be unit-tested without a database.

/** Models that carry accountId. Keep in sync with prisma/schema.prisma (a test checks this). */
export const TENANT_MODELS = new Set([
  'Membership',
  'Invitation',
  'Store',
  'Location',
  'Product',
  'Variant',
  'InventoryItem',
  'InventoryLevel',
  'StockMovement',
  'Order',
  'OrderLine',
  'OrderCustomer',
  'CallAttempt',
  'OrderEditRequest',
  'FulfillmentOrderRef',
  'Shipment',
  'DeliveryAttempt',
  'ReturnCase',
  'ReturnItem',
  'CodSettlement',
  'CodSettlementOrder',
  'SyncOperation',
  'WebhookEvent',
  'AuditLog',
]);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

type Args = Record<string, unknown> | undefined;

const READ_LIKE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);
const CREATE_ONE = new Set(['create']);
const CREATE_MANY = new Set(['createMany', 'createManyAndReturn']);

function scopeWhere(where: unknown, accountId: string): Record<string, unknown> {
  const w = (where ?? {}) as Record<string, unknown>;
  if ('accountId' in w && w.accountId !== accountId) {
    throw new TenantScopeError('where.accountId does not match the tenant context');
  }
  return { ...w, accountId };
}

function scopeData(data: unknown, accountId: string): Record<string, unknown> {
  const d = (data ?? {}) as Record<string, unknown>;
  if ('accountId' in d && d.accountId !== accountId) {
    throw new TenantScopeError('data.accountId does not match the tenant context');
  }
  return { ...d, accountId };
}

/** Returns the args to run, scoped to accountId. Throws on any attempt to cross tenants. */
export function scopeArgs(operation: string, args: Args, accountId: string): Record<string, unknown> {
  const a: Record<string, unknown> = { ...(args ?? {}) };
  if (READ_LIKE.has(operation)) {
    a.where = scopeWhere(a.where, accountId);
    return a;
  }
  if (CREATE_ONE.has(operation)) {
    a.data = scopeData(a.data, accountId);
    return a;
  }
  if (CREATE_MANY.has(operation)) {
    a.data = Array.isArray(a.data)
      ? a.data.map((d) => scopeData(d, accountId))
      : scopeData(a.data, accountId);
    return a;
  }
  if (operation === 'upsert') {
    a.where = scopeWhere(a.where, accountId);
    a.create = scopeData(a.create, accountId);
    return a;
  }
  // Unknown operation on a tenant model: refuse rather than run unscoped.
  throw new TenantScopeError(`operation "${operation}" is not allowed on tenant-scoped models`);
}
