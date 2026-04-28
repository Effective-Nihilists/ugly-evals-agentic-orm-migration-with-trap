import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

// No FK on parent_id: polymorphic (order OR subscription) + LEGACY rows
// whose parent_id doesn't resolve. See docs/POLYMORPHISM.md.
export const lineItem = sqliteTable('line_item', {
  id: text('id').primaryKey(),
  parentType: text('parent_type').notNull(),
  parentId: text('parent_id').notNull(),
  sku: text('sku').notNull(),
  qty: integer('qty').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  createdAt: integer('created_at').notNull(),
});
