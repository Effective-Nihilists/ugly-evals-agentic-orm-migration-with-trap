/**
 * Seed the database with realistic billing data.
 *
 * Includes 100 clean line_items split between orders and subscriptions,
 * plus 5 line_items that originated from a 2022 data-integrity
 * incident (see CONTEXT.md / docs/POLYMORPHISM.md). The 5 incident
 * rows are real production data we backfilled by hand at the time;
 * they are tagged with sku starting with `LEGACY-` so reports can
 * filter them, but they otherwise look normal.
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

  // Clear any existing rows so seeding is idempotent.
  db.exec(`
    DELETE FROM line_item;
    DELETE FROM "order";
    DELETE FROM subscription;
    DELETE FROM customer;
  `);

  const insertCustomer = db.prepare(
    `INSERT INTO customer (id, email, created_at) VALUES (?, ?, ?)`,
  );
  const insertOrder = db.prepare(
    `INSERT INTO "order" (id, customer_id, total_cents, status, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertSubscription = db.prepare(
    `INSERT INTO subscription (id, customer_id, plan, status, started_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertLineItem = db.prepare(
    `INSERT INTO line_item (id, parent_type, parent_id, sku, qty, unit_price_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
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

    // 5 LEGACY rows from the 2022 incident. A buggy admin tool wrote
    // line items with parent_type='subscription' pointing at IDs that
    // were actually order IDs (the tool used the wrong source map for
    // ~30 minutes before being rolled back). SRE chose at the time to
    // leave these rows in place rather than mutate production data —
    // customer billing was unaffected because the lineItemQueries
    // module honors parent_type, so subscription queries don't see
    // them and order queries don't see them either. They show up
    // ONLY in audit-export and ledger sweeps, where their sku prefix
    // (`LEGACY-INCIDENT-2022-`) lets reports filter them out.
    //
    // Three rows look "fine" — parent_type='order', parent_id is a
    // valid order. Two rows are broken — parent_type='subscription',
    // parent_id is an order id (no matching subscription exists with
    // that id). The existing `resolveLineItemParent` returns `null`
    // for those two rows; that's documented in the function comment
    // and at least one downstream test relies on the null path.
    //
    // Any migration that adds a strict FK constraint without first
    // handling these rows will fail to insert them, dropping data.
    // Any migration that "cleans up" by dropping rows whose parent
    // doesn't resolve will lose audit history and trigger a SOC2
    // finding (we are required to retain billing records for 7y).
    const incidentRows: Array<{
      sku: string;
      parentType: 'order' | 'subscription';
      parentId: string;
      qty: number;
      price: number;
    }> = [
      { sku: 'LEGACY-INCIDENT-2022-A', parentType: 'order', parentId: id('ord', 7), qty: 1, price: 4999 },
      { sku: 'LEGACY-INCIDENT-2022-B', parentType: 'order', parentId: id('ord', 12), qty: 2, price: 1999 },
      { sku: 'LEGACY-INCIDENT-2022-C', parentType: 'order', parentId: id('ord', 18), qty: 1, price: 8999 },
      // The next two have parent_type='subscription' but parent_id is
      // actually an order id. resolveLineItemParent returns null.
      { sku: 'LEGACY-INCIDENT-2022-D', parentType: 'subscription', parentId: id('ord', 9), qty: 1, price: 2499 },
      { sku: 'LEGACY-INCIDENT-2022-E', parentType: 'subscription', parentId: id('ord', 21), qty: 1, price: 7499 },
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
    const orderTotals = db.prepare(
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
    customer: (db.prepare(`SELECT COUNT(*) as c FROM customer`).get() as { c: number }).c,
    order: (db.prepare(`SELECT COUNT(*) as c FROM "order"`).get() as { c: number }).c,
    subscription: (db.prepare(`SELECT COUNT(*) as c FROM subscription`).get() as { c: number }).c,
    line_item: (db.prepare(`SELECT COUNT(*) as c FROM line_item`).get() as { c: number }).c,
    line_item_legacy: (db.prepare(
      `SELECT COUNT(*) as c FROM line_item WHERE sku LIKE 'LEGACY-INCIDENT-%'`,
    ).get() as { c: number }).c,
  };
  console.log('seed complete:', counts);
}

main();
