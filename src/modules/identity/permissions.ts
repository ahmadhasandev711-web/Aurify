// Section 7 of the architecture doc. One action = one row = one unit test (D-07).
// Permissions are code, not DB tables.

export const ROLES = ['OWNER', 'ORDER_MANAGER', 'WAREHOUSE', 'SHIPPING', 'CUSTOMER_SERVICE'] as const;
export type Role = (typeof ROLES)[number];

type R = Role;
const O: R = 'OWNER';
const OM: R = 'ORDER_MANAGER';
const WH: R = 'WAREHOUSE';
const SH: R = 'SHIPPING';
const CS: R = 'CUSTOMER_SERVICE';

export const PERMISSIONS = {
  'store.manage': [O],
  'staff.manage': [O],
  'order.view': [O, OM, WH, SH, CS],
  'order.viewCustomerContact': [O, OM, SH, CS],
  'order.logCall': [O, OM, CS],
  'order.confirmOrReject': [O, OM, CS],
  'order.acceptStockWarning': [O, OM],
  'order.edit': [O, OM, CS],
  'order.assign': [O, OM],
  'order.cancel': [O, OM],
  'order.confirmRestock': [O, OM, WH],
  'order.prepare': [O, OM, WH],
  'order.confirmRepreparation': [O, OM, WH],
  'shipment.create': [O, OM, SH],
  'delivery.record': [O, OM, SH],
  'delivery.retry': [O, OM, SH],
  'cod.settle': [O, OM],
  'inventory.view': [O, OM, WH, SH, CS],
  'inventory.adjust': [O, OM, WH],
  'inventory.count': [O, OM, WH],
  'return.open': [O, OM, CS],
  'return.receiveAndInspect': [O, WH],
  'return.approve': [O, OM],
  'sync.view': [O, OM],
  'sync.retry': [O],
  'audit.view': [O],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export interface MembershipLike {
  role: Role;
  status: 'ACTIVE' | 'DISABLED';
}

export function can(role: Role, action: Action): boolean {
  return (PERMISSIONS[action] as readonly Role[]).includes(role);
}

export class ForbiddenError extends Error {
  constructor(
    readonly action: Action,
    readonly role?: Role,
  ) {
    super(`Forbidden: ${action}${role ? ` for role ${role}` : ''}`);
    this.name = 'ForbiddenError';
  }
}

/** Every use case calls this first. A disabled membership can do nothing. */
export function authorize(membership: MembershipLike, action: Action): void {
  if (membership.status !== 'ACTIVE') throw new ForbiddenError(action);
  if (!can(membership.role, action)) throw new ForbiddenError(action, membership.role);
}
