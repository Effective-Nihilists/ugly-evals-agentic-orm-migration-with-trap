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
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db.js';
import { lineItem, order, subscription } from '../schema.js';
import type {
  LineItem,
  LineItemParent,
  LineItemParentType,
  Order,
  Subscription,
} from '../types.js';

type LineItemRow = typeof lineItem.$inferSelect;
type OrderRow = typeof order.$inferSelect;
type SubscriptionRow = typeof subscription.$inferSelect;

function toLineItem(r: LineItemRow): LineItem {
  return {
    id: r.id,
    parentType: r.parentType as LineItemParentType,
    parentId: r.parentId,
    sku: r.sku,
    qty: r.qty,
    unitPriceCents: r.unitPriceCents,
    createdAt: r.createdAt,
  };
}

function toOrder(r: OrderRow): Order {
  return {
    id: r.id,
    customerId: r.customerId,
    totalCents: r.totalCents,
    status: r.status as Order['status'],
    createdAt: r.createdAt,
  };
}

function toSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    customerId: r.customerId,
    plan: r.plan as Subscription['plan'],
    status: r.status as Subscription['status'],
    startedAt: r.startedAt,
    cancelledAt: r.cancelledAt,
  };
}

export function listLineItemsForOrder(db: Db, orderId: string): LineItem[] {
  const rows = db
    .select()
    .from(lineItem)
    .where(and(eq(lineItem.parentType, 'order'), eq(lineItem.parentId, orderId)))
    .orderBy(asc(lineItem.createdAt))
    .all();
  return rows.map(toLineItem);
}

export function listLineItemsForSubscription(
  db: Db,
  subscriptionId: string,
): LineItem[] {
  const rows = db
    .select()
    .from(lineItem)
    .where(
      and(
        eq(lineItem.parentType, 'subscription'),
        eq(lineItem.parentId, subscriptionId),
      ),
    )
    .orderBy(asc(lineItem.createdAt))
    .all();
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
  db: Db,
  item: LineItem,
): LineItemParent | null {
  if (item.parentType === 'order') {
    const row = db
      .select()
      .from(order)
      .where(eq(order.id, item.parentId))
      .get();
    if (!row) return null;
    return { type: 'order', order: toOrder(row) };
  }
  const row = db
    .select()
    .from(subscription)
    .where(eq(subscription.id, item.parentId))
    .get();
  if (!row) return null;
  return { type: 'subscription', subscription: toSubscription(row) };
}

/**
 * Compute the total amount (in cents) for a LineItem. Used by every
 * invoice generator. Trivial helper but called everywhere so we keep
 * it near the queries it pairs with.
 */
export function lineItemTotal(item: LineItem): number {
  return item.qty * item.unitPriceCents;
}
