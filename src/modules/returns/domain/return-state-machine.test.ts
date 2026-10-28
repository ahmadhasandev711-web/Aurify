import { describe, expect, it } from 'vitest';
import {
  restockMovements,
  transitionReturn,
  validateApproval,
  validateInspection,
  type InspectionItem,
} from './return-state-machine';

const item = (over: Partial<InspectionItem> = {}): InspectionItem => ({
  quantity: 3,
  restockQty: 2,
  damagedQty: 1,
  pendingQty: 0,
  ...over,
});

describe('inspection', () => {
  it('requires restock + damaged + pending = quantity per item', () => {
    expect(validateInspection([item()])).toBeNull();
    expect(validateInspection([item({ restockQty: 3 })])).toBe('QTY_MISMATCH');
    expect(validateInspection([item({ restockQty: -1, damagedQty: 4 })])).toBe('NEGATIVE_QTY');
    expect(validateInspection([])).toBe('NO_ITEMS');
  });

  it('approval needs every item decided', () => {
    expect(validateApproval([item({ restockQty: 1, damagedQty: 1, pendingQty: 1 })])).toBe('PENDING_ITEMS');
    expect(validateApproval([item()])).toBeNull();
  });
});

describe('restock movements (one per item, delta = restockQty)', () => {
  it('skips items with nothing to restock and keys by return item id', () => {
    const items = [
      { ...item({ quantity: 3, restockQty: 3, damagedQty: 0 }), id: 'ri_1' },
      { ...item({ quantity: 2, restockQty: 0, damagedQty: 2 }), id: 'ri_2' },
    ];
    expect(restockMovements(items)).toEqual([{ returnItemId: 'ri_1', delta: 3, idempotencyKey: 'return-item:ri_1' }]);
  });
});

describe('transitions', () => {
  it('walks the full path with the right actors', () => {
    expect(transitionReturn('OPENED', 'RECEIVE', 'WAREHOUSE')).toEqual({ ok: true, to: 'RECEIVED' });
    expect(transitionReturn('RECEIVED', 'INSPECT', 'WAREHOUSE', { items: [item({ restockQty: 1, damagedQty: 1, pendingQty: 1 })] })).toEqual({
      ok: true,
      to: 'INSPECTED',
    });
    expect(transitionReturn('INSPECTED', 'APPROVE', 'ORDER_MANAGER', { items: [item()] })).toEqual({ ok: true, to: 'APPROVED' });
    expect(transitionReturn('APPROVED', 'SYNC_SUCCEEDED', 'SYSTEM')).toEqual({ ok: true, to: 'CLOSED' });
  });

  it('blocks approval with pending items', () => {
    expect(
      transitionReturn('INSPECTED', 'APPROVE', 'ORDER_MANAGER', { items: [item({ restockQty: 1, damagedQty: 1, pendingQty: 1 })] }),
    ).toEqual({ ok: false, error: 'PENDING_ITEMS' });
  });

  it('Order Manager cannot inspect and Warehouse cannot approve', () => {
    expect(transitionReturn('RECEIVED', 'INSPECT', 'ORDER_MANAGER', { items: [item()] })).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(transitionReturn('INSPECTED', 'APPROVE', 'WAREHOUSE', { items: [item()] })).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('sync outcomes are system-only', () => {
    expect(transitionReturn('APPROVED', 'SYNC_SUCCEEDED', 'OWNER')).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(transitionReturn('APPROVED', 'SYNC_FAILED', 'SYSTEM')).toEqual({ ok: true, to: 'SYNC_FAILED' });
  });

  it('only the Owner retries a failed sync, back to APPROVED', () => {
    expect(transitionReturn('SYNC_FAILED', 'RETRY_SYNC', 'OWNER')).toEqual({ ok: true, to: 'APPROVED' });
    expect(transitionReturn('SYNC_FAILED', 'RETRY_SYNC', 'ORDER_MANAGER')).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('cancel works only before inspection and needs a reason', () => {
    expect(transitionReturn('OPENED', 'CANCEL', 'ORDER_MANAGER', { reason: 'x' })).toEqual({ ok: true, to: 'CANCELLED' });
    expect(transitionReturn('OPENED', 'CANCEL', 'ORDER_MANAGER')).toEqual({ ok: false, error: 'REASON_REQUIRED' });
    expect(transitionReturn('INSPECTED', 'CANCEL', 'ORDER_MANAGER', { reason: 'x' })).toEqual({ ok: false, error: 'INVALID_STATE' });
  });
});
