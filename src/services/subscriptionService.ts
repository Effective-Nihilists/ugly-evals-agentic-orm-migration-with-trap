import type Database from 'better-sqlite3';
import {
  lineItemTotal,
  listLineItemsForSubscription,
} from '../lib/lineItemQueries.js';
import type { Subscription } from '../types.js';

interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan: string;
  status: string;
  started_at: number;
  cancelled_at: number | null;
}

function rowToSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id,
    customerId: r.customer_id,
    plan: r.plan as Subscription['plan'],
    status: r.status as Subscription['status'],
    startedAt: r.started_at,
    cancelledAt: r.cancelled_at,
  };
}

export function getSubscription(
  db: Database.Database,
  subscriptionId: string,
): Subscription | null {
  const row = db
    .prepare(`SELECT * FROM subscription WHERE id = ?`)
    .get(subscriptionId) as SubscriptionRow | undefined;
  return row ? rowToSubscription(row) : null;
}

export function listActiveSubscriptionsForCustomer(
  db: Database.Database,
  customerId: string,
): Subscription[] {
  const rows = db
    .prepare(
      `SELECT * FROM subscription WHERE customer_id = ? AND status = 'active' ORDER BY started_at ASC`,
    )
    .all(customerId) as SubscriptionRow[];
  return rows.map(rowToSubscription);
}

/**
 * Compute the next-cycle invoice total for a subscription by summing
 * its line items. Recurring subscriptions can have add-ons added
 * mid-cycle, so we always recompute rather than reading a cached total.
 */
export function nextInvoiceTotal(
  db: Database.Database,
  subscriptionId: string,
): number {
  const items = listLineItemsForSubscription(db, subscriptionId);
  return items.reduce((s, i) => s + lineItemTotal(i), 0);
}
