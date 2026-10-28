import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES, authorize, can, ForbiddenError, type Action, type Role } from './permissions';

const O = 'OWNER', OM = 'ORDER_MANAGER', WH = 'WAREHOUSE', SH = 'SHIPPING', CS = 'CUSTOMER_SERVICE';
const ALL: Role[] = [O, OM, WH, SH, CS];

// Written independently from the matrix in section 7 of the architecture doc.
const EXPECTED: Record<Action, Role[]> = {
  'store.manage': [O],
  'staff.manage': [O],
  'order.view': ALL,
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
  'inventory.view': ALL,
  'inventory.adjust': [O, OM, WH],
  'inventory.count': [O, OM, WH],
  'return.open': [O, OM, CS],
  'return.receiveAndInspect': [O, WH],
  'return.approve': [O, OM],
  'sync.view': [O, OM],
  'sync.retry': [O],
  'audit.view': [O],
};

describe('permissions matrix', () => {
  it('covers exactly the same actions as the doc', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const action of Object.keys(EXPECTED) as Action[]) {
    it(`${action}`, () => {
      for (const role of ROLES) {
        expect(can(role, action), `${role} → ${action}`).toBe(EXPECTED[action].includes(role));
      }
    });
  }

  it('Owner can do everything', () => {
    for (const action of Object.keys(PERMISSIONS) as Action[]) expect(can('OWNER', action)).toBe(true);
  });

  it('Warehouse cannot see customer contact details', () => {
    expect(can('WAREHOUSE', 'order.viewCustomerContact')).toBe(false);
  });
});

describe('authorize', () => {
  it('passes for an active member with the right role', () => {
    expect(() => authorize({ role: 'ORDER_MANAGER', status: 'ACTIVE' }, 'order.cancel')).not.toThrow();
  });

  it('throws for the wrong role', () => {
    expect(() => authorize({ role: 'SHIPPING', status: 'ACTIVE' }, 'order.cancel')).toThrow(ForbiddenError);
  });

  it('throws for a disabled membership, even an Owner', () => {
    expect(() => authorize({ role: 'OWNER', status: 'DISABLED' }, 'order.view')).toThrow(ForbiddenError);
  });
});
