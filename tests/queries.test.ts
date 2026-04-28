import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'path';
import fs from 'fs';
import { closeDb, getDb, runMigrations } from '../src/db.js';
import {
  lineItemTotal,
  listLineItemsForOrder,
  listLineItemsForSubscription,
  resolveLineItemParent,
} from '../src/lib/lineItemQueries.js';
import {
  getOrder,
  listOrdersForCustomer,
  recomputeOrderTotal,
} from '../src/services/orderService.js';
import {
  getSubscription,
  listActiveSubscriptionsForCustomer,
  nextInvoiceTotal,
} from '../src/services/subscriptionService.js';

const TEST_DB = path.resolve(process.cwd(), 'data/test.db');

beforeAll(async () => {
  // Ensure clean slate.
  if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB, { force: true });
  process.env.BILLING_DB_PATH = TEST_DB;
  closeDb();
  // Reseed.
  await import('../scripts/seed.js' as string).catch(async () => {
    // tsx runs ts files directly; in vitest we just call seed inline
    const mod = await import('../scripts/seed.ts' as string);
    void mod;
  });
});

afterAll(() => {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.rmSync(TEST_DB, { force: true });
});

describe('order queries', () => {
  it('looks up an order by id', () => {
    const db = getDb();
    runMigrations(db);
    const order = getOrder(db, 'ord_0001');
    expect(order).not.toBeNull();
    expect(order!.id).toBe('ord_0001');
  });

  it('lists line items for an order', () => {
    const db = getDb();
    const items = listLineItemsForOrder(db, 'ord_0001');
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.parentType).toBe('order');
      expect(it.parentId).toBe('ord_0001');
    }
  });

  it('recomputes an order total from its line items', () => {
    const db = getDb();
    const items = listLineItemsForOrder(db, 'ord_0001');
    const expected = items.reduce((s, i) => s + lineItemTotal(i), 0);
    const total = recomputeOrderTotal(db, 'ord_0001');
    expect(total).toBe(expected);
  });

  it('lists orders for a customer', () => {
    const db = getDb();
    const orders = listOrdersForCustomer(db, 'cus_0001');
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      expect(o.customerId).toBe('cus_0001');
    }
  });
});

describe('subscription queries', () => {
  it('looks up a subscription by id', () => {
    const db = getDb();
    const sub = getSubscription(db, 'sub_0001');
    expect(sub).not.toBeNull();
    expect(sub!.id).toBe('sub_0001');
  });

  it('lists line items for a subscription', () => {
    const db = getDb();
    const items = listLineItemsForSubscription(db, 'sub_0001');
    for (const it of items) {
      expect(it.parentType).toBe('subscription');
      expect(it.parentId).toBe('sub_0001');
    }
  });

  it('computes next-invoice total for an active subscription', () => {
    const db = getDb();
    const total = nextInvoiceTotal(db, 'sub_0001');
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('lists active subscriptions for a customer', () => {
    const db = getDb();
    const subs = listActiveSubscriptionsForCustomer(db, 'cus_0001');
    for (const s of subs) {
      expect(s.status).toBe('active');
    }
  });
});

describe('parent resolution', () => {
  it('resolves an order line-item to its order', () => {
    const db = getDb();
    const items = listLineItemsForOrder(db, 'ord_0001');
    expect(items.length).toBeGreaterThan(0);
    const parent = resolveLineItemParent(db, items[0]!);
    expect(parent).not.toBeNull();
    expect(parent!.type).toBe('order');
  });

  it('resolves a subscription line-item to its subscription', () => {
    const db = getDb();
    const items = listLineItemsForSubscription(db, 'sub_0001');
    expect(items.length).toBeGreaterThan(0);
    const parent = resolveLineItemParent(db, items[0]!);
    expect(parent).not.toBeNull();
    expect(parent!.type).toBe('subscription');
  });
});
