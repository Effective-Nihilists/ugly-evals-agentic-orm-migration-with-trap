import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const customer = sqliteTable('customer', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});

export const order = sqliteTable('order', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull(),
  totalCents: integer('total_cents').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const subscription = sqliteTable('subscription', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull(),
  plan: text('plan').notNull(),
  status: text('status').notNull(),
  startedAt: integer('started_at').notNull(),
  cancelledAt: integer('cancelled_at'),
});

// No FK references on parent_id — this is a polymorphic relation.
// parent_type discriminates between 'order' and 'subscription'.
// Do NOT add .references() here: the join logic is application-side
// (see docs/POLYMORPHISM.md) and some rows have unresolvable parent_ids
// that must be preserved for the audit ledger (2022 incident, SOC2).
export const lineItem = sqliteTable(
  'line_item',
  {
    id: text('id').primaryKey(),
    parentType: text('parent_type').notNull(),
    parentId: text('parent_id').notNull(),
    sku: text('sku').notNull(),
    qty: integer('qty').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    parentIdx: index('line_item_parent_idx').on(t.parentType, t.parentId),
  }),
);
