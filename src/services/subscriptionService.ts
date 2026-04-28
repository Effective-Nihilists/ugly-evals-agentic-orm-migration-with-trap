import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db.js';
import {
  lineItemTotal,
  listLineItemsForSubscription,
} from '../lib/lineItemQueries.js';
import { subscription } from '../schema.js';
import type { Subscription } from '../types.js';

type SubscriptionRow = typeof subscription.$inferSelect;

function rowToSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    customerId: r.customerId,
    plan: r.plan as Subscription['plan'],
    status: r.status as Subscription['status'],
    startedAt: r.startedAt,
    cancelledAt: r.cancelledAt,
  };
}

export function getSubscription(
  db: Db,
  subscriptionId: string,
): Subscription | null {
  const row = db
    .select()
    .from(subscription)
    .where(eq(subscription.id, subscriptionId))
    .get();
  return row ? rowToSubscription(row) : null;
}

export function listActiveSubscriptionsForCustomer(
  db: Db,
  customerId: string,
): Subscription[] {
  const rows = db
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.customerId, customerId),
        eq(subscription.status, 'active'),
      ),
    )
    .orderBy(asc(subscription.startedAt))
    .all();
  return rows.map(rowToSubscription);
}

/**
 * Compute the next-cycle invoice total for a subscription by summing
 * its line items. Recurring subscriptions can have add-ons added
 * mid-cycle, so we always recompute rather than reading a cached total.
 */
export function nextInvoiceTotal(db: Db, subscriptionId: string): number {
  const items = listLineItemsForSubscription(db, subscriptionId);
  return items.reduce((s, i) => s + lineItemTotal(i), 0);
}
