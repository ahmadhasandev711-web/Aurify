import { describe, expect, it } from 'vitest';
import {
  eventsFrom,
  onShopifyCancelled,
  transition,
  type OrderContext,
  type OrderEvent,
  type OrderStatus,
} from './order-state-machine';

const ctx = (over: Partial<OrderContext> = {}): OrderContext => ({
  hasLoggedCall: true,
  stockWarningPresent: false,
  stockWarningAccepted: false,
  assigned: true,
  allLinesPrepared: true,
  editedAfterPreparingUnconfirmed: false,
  shipmentSynced: true,
  deliveryAttempts: 1,
  maxDeliveryAttempts: 3,
  reason: 'سبب',
  syncPending: false,
  ...over,
});

describe('happy path', () => {
  it('NEW → … → DELIVERED', () => {
    const steps: [OrderStatus, OrderEvent, Parameters<typeof transition>[2], OrderStatus][] = [
      ['NEW', 'LOG_FIRST_CALL', 'CUSTOMER_SERVICE', 'UNDER_REVIEW'],
      ['UNDER_REVIEW', 'CONFIRM', 'CUSTOMER_SERVICE', 'CONFIRMED'],
      ['CONFIRMED', 'START_PREPARING', 'WAREHOUSE', 'PREPARING'],
      ['PREPARING', 'FINISH_PREPARING', 'WAREHOUSE', 'READY_TO_SHIP'],
      ['READY_TO_SHIP', 'SHIP', 'SHIPPING', 'SHIPPED'],
      ['SHIPPED', 'MARK_DELIVERED', 'SHIPPING', 'DELIVERED'],
    ];
    for (const [from, event, actor, to] of steps) {
      const r = transition(from, event, actor, ctx());
      expect(r, `${from} --${event}-->`).toMatchObject({ ok: true, to });
    }
  });
});

describe('confirmation (D-01, D-07)', () => {
  it('needs a logged call', () => {
    expect(transition('UNDER_REVIEW', 'CONFIRM', 'CUSTOMER_SERVICE', ctx({ hasLoggedCall: false }))).toEqual({
      ok: false,
      error: 'CALL_CONFIRMATION_REQUIRED',
    });
  });

  it('Customer Service cannot accept a stock warning', () => {
    expect(
      transition('UNDER_REVIEW', 'CONFIRM', 'CUSTOMER_SERVICE', ctx({ stockWarningPresent: true })),
    ).toEqual({ ok: false, error: 'STOCK_WARNING_NEEDS_MANAGER' });
  });

  it('Order Manager must accept the warning explicitly, then it passes', () => {
    expect(transition('UNDER_REVIEW', 'CONFIRM', 'ORDER_MANAGER', ctx({ stockWarningPresent: true }))).toEqual({
      ok: false,
      error: 'STOCK_WARNING_NOT_ACCEPTED',
    });
    expect(
      transition('UNDER_REVIEW', 'CONFIRM', 'ORDER_MANAGER', ctx({ stockWarningPresent: true, stockWarningAccepted: true })),
    ).toMatchObject({ ok: true, to: 'CONFIRMED' });
  });

  it('rejecting needs a reason and cancels in Shopify (D-04)', () => {
    expect(transition('UNDER_REVIEW', 'REJECT', 'CUSTOMER_SERVICE', ctx({ reason: ' ' }))).toEqual({
      ok: false,
      error: 'REASON_REQUIRED',
    });
    expect(transition('UNDER_REVIEW', 'REJECT', 'CUSTOMER_SERVICE', ctx())).toMatchObject({
      ok: true,
      to: 'REJECTED',
      effects: ['SYNC_ORDER_CANCEL_WITH_RESTOCK'],
    });
  });
});

describe('cancellation (D-04)', () => {
  it('direct cancel before preparing cancels in Shopify with restock', () => {
    for (const from of ['NEW', 'UNDER_REVIEW', 'CONFIRMED'] as const) {
      expect(transition(from, 'CANCEL_DIRECT', 'ORDER_MANAGER', ctx())).toMatchObject({
        ok: true,
        to: 'CANCELLED',
        effects: ['SYNC_ORDER_CANCEL_WITH_RESTOCK'],
      });
    }
  });

  it('after preparing it goes through CANCELLATION_PENDING and sends nothing to Shopify yet', () => {
    for (const from of ['PREPARING', 'READY_TO_SHIP'] as const) {
      const r = transition(from, 'REQUEST_CANCEL', 'ORDER_MANAGER', ctx());
      expect(r).toMatchObject({ ok: true, to: 'CANCELLATION_PENDING', effects: [] });
    }
    expect(transition('PREPARING', 'CANCEL_DIRECT', 'ORDER_MANAGER', ctx())).toEqual({ ok: false, error: 'INVALID_STATE' });
  });

  it('restock confirmation by the warehouse triggers the Shopify cancel', () => {
    expect(transition('CANCELLATION_PENDING', 'CONFIRM_RESTOCKED', 'WAREHOUSE', ctx())).toMatchObject({
      ok: true,
      to: 'CANCELLED',
      effects: ['SYNC_ORDER_CANCEL_WITH_RESTOCK'],
    });
  });

  it('cannot cancel once shipped', () => {
    for (const ev of ['CANCEL_DIRECT', 'REQUEST_CANCEL'] as const) {
      expect(transition('SHIPPED', ev, 'OWNER', ctx())).toEqual({ ok: false, error: 'INVALID_STATE' });
    }
  });

  it('Customer Service and Warehouse cannot cancel', () => {
    expect(transition('CONFIRMED', 'CANCEL_DIRECT', 'CUSTOMER_SERVICE', ctx())).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(transition('PREPARING', 'REQUEST_CANCEL', 'WAREHOUSE', ctx())).toEqual({ ok: false, error: 'FORBIDDEN' });
  });
});

describe('preparing and shipping', () => {
  it('needs an assignee to start', () => {
    expect(transition('CONFIRMED', 'START_PREPARING', 'WAREHOUSE', ctx({ assigned: false }))).toEqual({
      ok: false,
      error: 'ORDER_NOT_ASSIGNED',
    });
  });

  it('cannot finish while lines are unprepared or an external edit is unconfirmed (D-16)', () => {
    expect(transition('PREPARING', 'FINISH_PREPARING', 'WAREHOUSE', ctx({ allLinesPrepared: false }))).toEqual({
      ok: false,
      error: 'LINES_NOT_PREPARED',
    });
    expect(
      transition('PREPARING', 'FINISH_PREPARING', 'WAREHOUSE', ctx({ editedAfterPreparingUnconfirmed: true })),
    ).toEqual({ ok: false, error: 'REPREPARATION_NOT_CONFIRMED' });
  });

  it('cannot ship until the Shopify fulfillment is synced', () => {
    expect(transition('READY_TO_SHIP', 'SHIP', 'SHIPPING', ctx({ shipmentSynced: false }))).toEqual({
      ok: false,
      error: 'SHIPMENT_NOT_SYNCED',
    });
  });

  it('Warehouse cannot ship', () => {
    expect(transition('READY_TO_SHIP', 'SHIP', 'WAREHOUSE', ctx())).toEqual({ ok: false, error: 'FORBIDDEN' });
  });
});

describe('delivery failure and RTO (D-04, D-06)', () => {
  it('failure needs a reason', () => {
    expect(transition('SHIPPED', 'MARK_DELIVERY_FAILED', 'SHIPPING', ctx({ reason: '' }))).toEqual({
      ok: false,
      error: 'REASON_REQUIRED',
    });
  });

  it('retry is allowed below the limit and blocked at it', () => {
    expect(transition('DELIVERY_FAILED', 'RETRY_DELIVERY', 'SHIPPING', ctx({ deliveryAttempts: 2 }))).toMatchObject({
      ok: true,
      to: 'SHIPPED',
    });
    expect(transition('DELIVERY_FAILED', 'RETRY_DELIVERY', 'SHIPPING', ctx({ deliveryAttempts: 3 }))).toEqual({
      ok: false,
      error: 'MAX_DELIVERY_ATTEMPTS_REACHED',
    });
  });

  it('physical receipt opens the RTO return and tags the order', () => {
    expect(transition('DELIVERY_FAILED', 'RECEIVE_RETURNED', 'WAREHOUSE', ctx())).toMatchObject({
      ok: true,
      to: 'RETURNED_TO_ORIGIN',
      effects: ['OPEN_RTO_RETURN', 'ADD_RTO_TAG'],
    });
  });
});

describe('sync lock', () => {
  it('blocks every transition while a Shopify operation is pending', () => {
    expect(transition('NEW', 'LOG_FIRST_CALL', 'CUSTOMER_SERVICE', ctx({ syncPending: true }))).toEqual({
      ok: false,
      error: 'SYNC_IN_PROGRESS',
    });
  });
});

describe('eventsFrom', () => {
  it('lists offered events per status', () => {
    expect(eventsFrom('NEW')).toEqual(['LOG_FIRST_CALL', 'CANCEL_DIRECT']);
    expect(eventsFrom('DELIVERED')).toEqual([]);
    expect(eventsFrom('CANCELLED')).toEqual([]);
  });
});

describe('Shopify-side cancellation (D-16)', () => {
  it.each([
    ['NEW', 'CANCELLED', false, false],
    ['CONFIRMED', 'CANCELLED', false, false],
    ['PREPARING', 'CANCELLED', false, true],
    ['READY_TO_SHIP', 'CANCELLED', false, true],
    ['CANCELLATION_PENDING', 'CANCELLED', false, true],
    ['SHIPPED', null, true, false],
    ['DELIVERED', null, true, false],
    ['CANCELLED', null, false, false],
  ] as const)('%s → %s (needsDecision=%s, restockTask=%s)', (from, to, needsDecision, createRestockTask) => {
    expect(onShopifyCancelled(from)).toEqual({ to, needsDecision, createRestockTask });
  });
});
