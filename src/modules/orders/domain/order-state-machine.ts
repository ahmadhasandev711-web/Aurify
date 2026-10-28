// Order state machine — section 6 of the architecture doc (D-04, D-15, D-16).
// Pure functions: no DB, no Shopify. Use cases load the context, call `transition`,
// then persist the new status + enqueue the SyncOperation that `effects` asks for.

import type { Action, Role } from '@/modules/identity';
import { can } from '@/modules/identity';

export type OrderStatus =
  | 'NEW'
  | 'UNDER_REVIEW'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'PREPARING'
  | 'READY_TO_SHIP'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURNED_TO_ORIGIN';

export type OrderEvent =
  | 'LOG_FIRST_CALL'
  | 'CONFIRM'
  | 'REJECT'
  | 'CANCEL_DIRECT' // before preparing
  | 'START_PREPARING'
  | 'FINISH_PREPARING'
  | 'REQUEST_CANCEL' // preparing / ready to ship
  | 'CONFIRM_RESTOCKED' // warehouse put items back
  | 'SHIP'
  | 'MARK_DELIVERED'
  | 'MARK_DELIVERY_FAILED'
  | 'RETRY_DELIVERY'
  | 'RECEIVE_RETURNED';

export type Effect =
  | 'SYNC_ORDER_CANCEL_WITH_RESTOCK' // orderCancel(restock, no refund)
  | 'OPEN_RTO_RETURN'
  | 'ADD_RTO_TAG';

export interface OrderContext {
  hasLoggedCall: boolean;
  stockWarningPresent: boolean;
  stockWarningAccepted: boolean;
  assigned: boolean;
  allLinesPrepared: boolean;
  editedAfterPreparingUnconfirmed: boolean;
  shipmentSynced: boolean;
  deliveryAttempts: number;
  maxDeliveryAttempts: number;
  reason?: string;
  syncPending: boolean;
}

interface Rule {
  from: readonly OrderStatus[];
  to: OrderStatus;
  /** Roles are derived from the permissions matrix, not duplicated here. */
  action: Action;
  guard?: (c: OrderContext, actor: Role) => string | null;
  effects?: readonly Effect[];
}

const needReason = (c: OrderContext) => (c.reason?.trim() ? null : 'REASON_REQUIRED');

const RULES: Record<OrderEvent, Rule> = {
  LOG_FIRST_CALL: {
    from: ['NEW'],
    to: 'UNDER_REVIEW',
    action: 'order.logCall',
  },
  CONFIRM: {
    from: ['UNDER_REVIEW'],
    to: 'CONFIRMED',
    action: 'order.confirmOrReject',
    guard: (c, actor) => {
      if (!c.hasLoggedCall) return 'CALL_CONFIRMATION_REQUIRED';
      // D-01/D-07: a stock warning needs Owner/Order Manager to accept it.
      if (c.stockWarningPresent && !c.stockWarningAccepted) {
        return can(actor, 'order.acceptStockWarning') ? 'STOCK_WARNING_NOT_ACCEPTED' : 'STOCK_WARNING_NEEDS_MANAGER';
      }
      return null;
    },
  },
  REJECT: {
    from: ['UNDER_REVIEW'],
    to: 'REJECTED',
    action: 'order.confirmOrReject',
    guard: needReason,
    effects: ['SYNC_ORDER_CANCEL_WITH_RESTOCK'], // D-04: Rejected also cancels in Shopify
  },
  CANCEL_DIRECT: {
    from: ['NEW', 'UNDER_REVIEW', 'CONFIRMED'],
    to: 'CANCELLED',
    action: 'order.cancel',
    guard: needReason,
    effects: ['SYNC_ORDER_CANCEL_WITH_RESTOCK'],
  },
  START_PREPARING: {
    from: ['CONFIRMED'],
    to: 'PREPARING',
    action: 'order.prepare',
    guard: (c) => (c.assigned ? null : 'ORDER_NOT_ASSIGNED'),
  },
  FINISH_PREPARING: {
    from: ['PREPARING'],
    to: 'READY_TO_SHIP',
    action: 'order.prepare',
    guard: (c) => {
      if (!c.allLinesPrepared) return 'LINES_NOT_PREPARED';
      if (c.editedAfterPreparingUnconfirmed) return 'REPREPARATION_NOT_CONFIRMED';
      return null;
    },
  },
  REQUEST_CANCEL: {
    from: ['PREPARING', 'READY_TO_SHIP'],
    to: 'CANCELLATION_PENDING',
    action: 'order.cancel',
    guard: needReason, // nothing is sent to Shopify yet
  },
  CONFIRM_RESTOCKED: {
    from: ['CANCELLATION_PENDING'],
    to: 'CANCELLED',
    action: 'order.confirmRestock',
    effects: ['SYNC_ORDER_CANCEL_WITH_RESTOCK'],
  },
  SHIP: {
    from: ['READY_TO_SHIP'],
    to: 'SHIPPED',
    action: 'shipment.create',
    guard: (c) => (c.shipmentSynced ? null : 'SHIPMENT_NOT_SYNCED'),
  },
  MARK_DELIVERED: {
    from: ['SHIPPED'],
    to: 'DELIVERED',
    action: 'delivery.record',
  },
  MARK_DELIVERY_FAILED: {
    from: ['SHIPPED'],
    to: 'DELIVERY_FAILED',
    action: 'delivery.record',
    guard: needReason,
  },
  RETRY_DELIVERY: {
    from: ['DELIVERY_FAILED'],
    to: 'SHIPPED',
    action: 'delivery.retry',
    guard: (c) => (c.deliveryAttempts < c.maxDeliveryAttempts ? null : 'MAX_DELIVERY_ATTEMPTS_REACHED'),
  },
  RECEIVE_RETURNED: {
    from: ['DELIVERY_FAILED'],
    to: 'RETURNED_TO_ORIGIN',
    action: 'return.receiveAndInspect',
    effects: ['OPEN_RTO_RETURN', 'ADD_RTO_TAG'],
  },
};

export type TransitionError =
  | 'INVALID_STATE'
  | 'FORBIDDEN'
  | 'SYNC_IN_PROGRESS'
  | 'REASON_REQUIRED'
  | 'CALL_CONFIRMATION_REQUIRED'
  | 'STOCK_WARNING_NOT_ACCEPTED'
  | 'STOCK_WARNING_NEEDS_MANAGER'
  | 'ORDER_NOT_ASSIGNED'
  | 'LINES_NOT_PREPARED'
  | 'REPREPARATION_NOT_CONFIRMED'
  | 'SHIPMENT_NOT_SYNCED'
  | 'MAX_DELIVERY_ATTEMPTS_REACHED';

export type TransitionResult =
  | { ok: true; from: OrderStatus; to: OrderStatus; effects: readonly Effect[] }
  | { ok: false; error: TransitionError };

export function transition(
  status: OrderStatus,
  event: OrderEvent,
  actor: Role,
  ctx: OrderContext,
): TransitionResult {
  const rule = RULES[event];
  if (!rule.from.includes(status)) return { ok: false, error: 'INVALID_STATE' };
  if (!can(actor, rule.action)) return { ok: false, error: 'FORBIDDEN' };
  // D-04: no transitions while a Shopify operation is pending on the order.
  if (ctx.syncPending) return { ok: false, error: 'SYNC_IN_PROGRESS' };
  const guardError = rule.guard?.(ctx, actor) ?? null;
  if (guardError) return { ok: false, error: guardError as TransitionError };
  return { ok: true, from: status, to: rule.to, effects: rule.effects ?? [] };
}

/** Which events could be offered in the UI for this status (UI still re-validates on submit). */
export function eventsFrom(status: OrderStatus): OrderEvent[] {
  return (Object.keys(RULES) as OrderEvent[]).filter((e) => RULES[e].from.includes(status));
}

/**
 * D-16: what an `orders/cancelled` webhook (cancelled in Shopify, not by us) does to our order.
 * Returns the new status, or null with `needsDecision` when we must not move it automatically.
 */
export function onShopifyCancelled(status: OrderStatus): {
  to: OrderStatus | null;
  needsDecision: boolean;
  createRestockTask: boolean;
} {
  if (status === 'CANCELLED' || status === 'REJECTED') return { to: null, needsDecision: false, createRestockTask: false };
  if (status === 'PREPARING' || status === 'READY_TO_SHIP' || status === 'CANCELLATION_PENDING') {
    return { to: 'CANCELLED', needsDecision: false, createRestockTask: true };
  }
  if (status === 'NEW' || status === 'UNDER_REVIEW' || status === 'CONFIRMED') {
    return { to: 'CANCELLED', needsDecision: false, createRestockTask: false };
  }
  // Shipped and later: never moved automatically.
  return { to: null, needsDecision: true, createRestockTask: false };
}
