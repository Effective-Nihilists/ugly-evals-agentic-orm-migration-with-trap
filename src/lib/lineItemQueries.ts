/**
 * Polymorphic LineItem queries.
 *
 * LineItem belongs to EITHER an Order OR a Subscription. The discriminator
 * is `parent_type` and the foreign-key target is `parent_id`. Because
 * neither sqlite nor most ORMs support polymorphic relations natively,
 * we keep the wiring here so the rest of the app gets a clean interface.
 *
 * If you are reading this because you are about to migrate this module
 * to an ORM that promises to "do polymorphism for you" (some don't):
 * stop, read docs/POLYMORPHISM.md, then come back.
 */
import type Database from 'better-sqlite3';
import type {
  LineItem,
  LineItemParent,
  LineItemParentType,
  Order,
  Subscription,
} from '../types.js';

interface LineItemRow {
  id: string;
  parent_type: LineItemParentType;
  parent_id: string;
  sku: string;
  qty: number;
  unit_price_cents: number;
  created_at: number;
}

interface OrderRow {
  id: string;
  customer_id: string;
  total_cents: number;
  status: string;
  created_at: number;
}

interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan: string;
  status: string;
  started_at: number;
  cancelled_at: number | null;
}

function toLineItem(r: LineItemRow): LineItem {
  return {
    id: r.id,
    parentType: r.parent_type,
    parentId: r.parent_id,
    sku: r.sku,
    qty: r.qty,
    unitPriceCents: r.unit_price_cents,
    createdAt: r.created_at,
  };
}

export function listLineItemsForOrder(
  db: Database.Database,
  orderId: string,
): LineItem[] {
  const rows = db
    .prepare(
      `SELECT * FROM line_item WHERE parent_type = 'order' AND parent_id = ? ORDER BY created_at ASC`,
    )
    .all(orderId) as LineItemRow[];
  return rows.map(toLineItem);
}

export function listLineItemsForSubscription(
  db: Database.Database,
  subscriptionId: string,
): LineItem[] {
  const rows = db
    .prepare(
      `SELECT * FROM line_item WHERE parent_type = 'subscription' AND parent_id = ? ORDER BY created_at ASC`,
    )
    .all(subscriptionId) as LineItemRow[];
  return rows.map(toLineItem);
}

/**
 * Resolve a LineItem's parent to a typed object. Used by the audit
 * exporter and the customer-billing summary endpoint. Returns `null`
 * when the parent row is missing — a data-integrity warning, not an
 * error. (Don't throw here; broken-parent rows exist in production
 * for reasons that pre-date my employment.)
 */
export function resolveLineItemParent(
  db: Database.Database,
  item: LineItem,
): LineItemParent | null {
  if (item.parentType === 'order') {
    const row = db
      .prepare(`SELECT * FROM "order" WHERE id = ?`)
      .get(item.parentId) as OrderRow | undefined;
    if (!row) return null;
    return {
      type: 'order',
      order: {
        id: row.id,
        customerId: row.customer_id,
        totalCents: row.total_cents,
        status: row.status as Order['status'],
        createdAt: row.created_at,
      },
    };
  }
  const row = db
    .prepare(`SELECT * FROM subscription WHERE id = ?`)
    .get(item.parentId) as SubscriptionRow | undefined;
  if (!row) return null;
  return {
    type: 'subscription',
    subscription: {
      id: row.id,
      customerId: row.customer_id,
      plan: row.plan as Subscription['plan'],
      status: row.status as Subscription['status'],
      startedAt: row.started_at,
      cancelledAt: row.cancelled_at,
    },
  };
}

/**
 * Compute the total amount (in cents) for a LineItem. Used by every
 * invoice generator. Trivial helper but called everywhere so we keep
 * it near the queries it pairs with.
 */
export function lineItemTotal(item: LineItem): number {
  return item.qty * item.unitPriceCents;
}
