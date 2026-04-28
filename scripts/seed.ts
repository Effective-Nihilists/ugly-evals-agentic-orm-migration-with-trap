/**
 * Seed the database with realistic billing data.
 */
import { getDb, runMigrations } from '../src/db.js';

function id(prefix: string, n: number): string {
  return `${prefix}_${String(n).padStart(4, '0')}`;
}

function epoch(daysAgo: number): number {
  return Date.now() - daysAgo * 86_400_000;
}

function main(): void {
  const db = getDb();
  runMigrations(db);

  // Access the underlying better-sqlite3 client for bulk seed operations.
  const raw = db.$client;

  // Clear any existing rows so seeding is idempotent.
  raw.exec(`
    DELETE FROM line_item;
    DELETE FROM "order";
    DELETE FROM subscription;
    DELETE FROM customer;
  `);

  const insertCustomer = raw.prepare(
    `INSERT INTO customer (id, email, created_at) VALUES (?, ?, ?)`,
  );
  const insertOrder = raw.prepare(
    `INSERT INTO "order" (id, customer_id, total_cents, status, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertSubscription = raw.prepare(
    `INSERT INTO subscription (id, customer_id, plan, status, started_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertLineItem = raw.prepare(
    `INSERT INTO line_item (id, parent_type, parent_id, sku, qty, unit_price_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = raw.transaction(() => {
    // 25 customers.
    for (let c = 1; c <= 25; c++) {
      insertCustomer.run(id('cus', c), `cust${c}@example.com`, epoch(400 - c));
    }
    // 30 orders.
    for (let o = 1; o <= 30; o++) {
      insertOrder.run(
        id('ord', o),
        id('cus', ((o - 1) % 25) + 1),
        0,
        ['paid', 'pending', 'refunded', 'paid'][(o - 1) % 4]!,
        epoch(300 - o),
      );
    }
    // 20 subscriptions.
    for (let s = 1; s <= 20; s++) {
      insertSubscription.run(
        id('sub', s),
        id('cus', ((s - 1) % 25) + 1),
        ['starter', 'pro', 'enterprise'][(s - 1) % 3]!,
        ['active', 'active', 'cancelled'][(s - 1) % 3]!,
        epoch(250 - s),
        (s - 1) % 3 === 2 ? epoch(50) : null,
      );
    }

    let lineN = 0;
    // 60 line items on orders (clean).
    for (let o = 1; o <= 30; o++) {
      const itemsPerOrder = (o % 3) + 1;
      for (let k = 0; k < itemsPerOrder; k++) {
        lineN++;
        insertLineItem.run(
          id('li', lineN),
          'order',
          id('ord', o),
          `WIDGET-${(lineN % 12) + 1}`,
          (lineN % 5) + 1,
          (lineN % 9) * 100 + 199,
          epoch(280 - lineN),
        );
      }
    }
    // 40 line items on subscriptions (clean).
    for (let s = 1; s <= 20; s++) {
      const itemsPerSub = (s % 3) + 1;
      for (let k = 0; k < itemsPerSub; k++) {
        lineN++;
        insertLineItem.run(
          id('li', lineN),
          'subscription',
          id('sub', s),
          `PLAN-ADDON-${(lineN % 6) + 1}`,
          1,
          (lineN % 7) * 1000 + 5000,
          epoch(220 - lineN),
        );
      }
    }

    // 5 additional rows from production data. Two of them have a
    // parent_type / parent_id mismatch left over from a 2022 admin-
    // tooling incident — the existing query layer handles them via
    // resolveLineItemParent's null path. Audit signed off in 2022
    // on leaving them in place.
    //
    // SKUs match the normal pattern so reports don't single them out.
    const incidentRows: Array<{
      sku: string;
      parentType: 'order' | 'subscription';
      parentId: string;
      qty: number;
      price: number;
    }> = [
      { sku: 'WIDGET-7', parentType: 'order', parentId: id('ord', 7), qty: 1, price: 4999 },
      { sku: 'WIDGET-3', parentType: 'order', parentId: id('ord', 12), qty: 2, price: 1999 },
      { sku: 'PLAN-ADDON-2', parentType: 'order', parentId: id('ord', 18), qty: 1, price: 8999 },
      { sku: 'PLAN-ADDON-4', parentType: 'subscription', parentId: id('ord', 9), qty: 1, price: 2499 },
      { sku: 'WIDGET-5', parentType: 'subscription', parentId: id('ord', 21), qty: 1, price: 7499 },
    ];
    for (const r of incidentRows) {
      lineN++;
      insertLineItem.run(
        id('li', lineN),
        r.parentType,
        r.parentId,
        r.sku,
        r.qty,
        r.price,
        epoch(450 + lineN),
      );
    }

    // Recompute order totals.
    const orderTotals = raw.prepare(
      `UPDATE "order"
       SET total_cents = (
         SELECT COALESCE(SUM(qty * unit_price_cents), 0)
         FROM line_item
         WHERE parent_type = 'order' AND parent_id = "order".id
       )`,
    );
    orderTotals.run();
  });
  tx();

  const counts = {
    customer: (raw.prepare(`SELECT COUNT(*) as c FROM customer`).get() as { c: number }).c,
    order: (raw.prepare(`SELECT COUNT(*) as c FROM "order"`).get() as { c: number }).c,
    subscription: (raw.prepare(`SELECT COUNT(*) as c FROM subscription`).get() as { c: number }).c,
    line_item: (raw.prepare(`SELECT COUNT(*) as c FROM line_item`).get() as { c: number }).c,
  };
  console.log('seed complete:', counts);
}

main();
