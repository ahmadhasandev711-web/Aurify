// Return / RTO state machine and inspection rules — D-06.

import type { Action, Role } from '@/modules/identity';
import { can } from '@/modules/identity';

export type ReturnStatus = 'OPENED' | 'RECEIVED' | 'INSPECTED' | 'APPROVED' | 'CLOSED' | 'SYNC_FAILED' | 'CANCELLED';
export type ReturnEvent = 'RECEIVE' | 'INSPECT' | 'APPROVE' | 'SYNC_SUCCEEDED' | 'SYNC_FAILED' | 'RETRY_SYNC' | 'CANCEL';

export interface InspectionItem {
  quantity: number;
  restockQty: number;
  damagedQty: number;
  pendingQty: number;
}

export type InspectionError = 'NEGATIVE_QTY' | 'QTY_MISMATCH' | 'PENDING_ITEMS' | 'NO_ITEMS';

/** restockQty + damagedQty + pendingQty must equal the returned quantity, per item. */
export function validateInspection(items: readonly InspectionItem[]): InspectionError | null {
  if (items.length === 0) return 'NO_ITEMS';
  for (const i of items) {
    if (i.restockQty < 0 || i.damagedQty < 0 || i.pendingQty < 0 || i.quantity < 1) return 'NEGATIVE_QTY';
    if (i.restockQty + i.damagedQty + i.pendingQty !== i.quantity) return 'QTY_MISMATCH';
  }
  return null;
}

/** Approval needs every item decided. */
export function validateApproval(items: readonly InspectionItem[]): InspectionError | null {
  const inspection = validateInspection(items);
  if (inspection) return inspection;
  return items.some((i) => i.pendingQty > 0) ? 'PENDING_ITEMS' : null;
}

/** One stock movement per return item, delta = restockQty. Items with 0 restock make no movement. */
export function restockMovements<T extends InspectionItem & { id: string }>(items: readonly T[]) {
  return items
    .filter((i) => i.restockQty > 0)
    .map((i) => ({ returnItemId: i.id, delta: i.restockQty, idempotencyKey: `return-item:${i.id}` }));
}

interface Rule {
  from: readonly ReturnStatus[];
  to: ReturnStatus;
  action: Action | null; // null = system event
}

const RULES: Record<ReturnEvent, Rule> = {
  RECEIVE: { from: ['OPENED'], to: 'RECEIVED', action: 'return.receiveAndInspect' },
  INSPECT: { from: ['RECEIVED'], to: 'INSPECTED', action: 'return.receiveAndInspect' },
  APPROVE: { from: ['INSPECTED'], to: 'APPROVED', action: 'return.approve' },
  SYNC_SUCCEEDED: { from: ['APPROVED'], to: 'CLOSED', action: null },
  SYNC_FAILED: { from: ['APPROVED'], to: 'SYNC_FAILED', action: null },
  RETRY_SYNC: { from: ['SYNC_FAILED'], to: 'APPROVED', action: 'sync.retry' },
  CANCEL: { from: ['OPENED', 'RECEIVED'], to: 'CANCELLED', action: 'return.approve' },
};

export type ReturnTransitionResult =
  | { ok: true; to: ReturnStatus }
  | { ok: false; error: 'INVALID_STATE' | 'FORBIDDEN' | InspectionError | 'REASON_REQUIRED' };

export function transitionReturn(
  status: ReturnStatus,
  event: ReturnEvent,
  actor: Role | 'SYSTEM',
  opts: { items?: readonly InspectionItem[]; reason?: string } = {},
): ReturnTransitionResult {
  const rule = RULES[event];
  if (!rule.from.includes(status)) return { ok: false, error: 'INVALID_STATE' };
  if (rule.action === null) {
    if (actor !== 'SYSTEM') return { ok: false, error: 'FORBIDDEN' };
  } else if (actor === 'SYSTEM' || !can(actor, rule.action)) {
    return { ok: false, error: 'FORBIDDEN' };
  }
  if (event === 'INSPECT') {
    const e = validateInspection(opts.items ?? []);
    if (e) return { ok: false, error: e };
  }
  if (event === 'APPROVE') {
    const e = validateApproval(opts.items ?? []);
    if (e) return { ok: false, error: e };
  }
  if (event === 'CANCEL' && !opts.reason?.trim()) return { ok: false, error: 'REASON_REQUIRED' };
  return { ok: true, to: rule.to };
}
