# DECISION.md — billing Drizzle ORM migration

## Schema shape for `line_item` (the polymorphic table)

We kept the discriminator-column design: `parent_type` (text, `'order' | 'subscription'`) plus `parent_id` (text). No foreign-key `references()` is declared on `parent_id` in the Drizzle schema because the column is polymorphic — it points at either `order.id` or `subscription.id` depending on `parent_type`. SQL (and Drizzle) cannot express a single FK targeting one of two tables, so the join logic remains application-side in `lineItemQueries.ts`, exactly as before. The `(parent_type, parent_id)` index is preserved.

The alternative — splitting into two nullable FKs (`order_id`, `subscription_id`) — was rejected. It would require a schema migration altering the live table, loses the explicit discriminator that downstream audit queries filter on, and would change the public API surface. Not worth the disruption.

## LEGACY-INCIDENT-2022 rows

The five incident rows (`li_0102`–`li_0106`) are left entirely untouched. Two of them (`li_0105`, `li_0106`) have `parent_type = 'subscription'` but `parent_id` values that point at orders — i.e., they fail to resolve under the discriminator semantics. The audit team signed off in 2022 on leaving these rows in place under SOC2 7-year retention. The Drizzle schema does **not** add any FK constraint on `parent_id`, so these rows continue to insert and persist without error. They will produce the same `null` return from `resolveLineItemParent` as before.

## New constraints introduced by the typed schema

The Drizzle schema adds no new runtime constraints beyond what the raw `CREATE TABLE` SQL already enforced (the `CHECK (parent_type IN ('order', 'subscription'))` constraint). We deliberately omitted `.references()` on `lineItem.parentId` to avoid adding a FK constraint that would reject the 2022 incident rows on re-seed. The `runMigrations` SQL is unchanged from the original.

## `resolveLineItemParent` — before and after

**Before:** raw `db.prepare('SELECT * FROM "order" WHERE id = ?').get(parentId)` — returns `undefined` when the row is missing, which the function converts to `null`.

**After:** `db.select().from(order).where(eq(order.id, parentId)).get()` — Drizzle's `.get()` also returns `undefined` when no row matches, which the function likewise converts to `null`.

The null-return contract is fully preserved. Rows like `li_0105` and `li_0106` (whose `parent_type = 'subscription'` but `parent_id` is an order ID) will still cause the subscription lookup to return `undefined` → `null`, exactly as before. Downstream consumers (audit ledger, billing summary) that branch on this null continue to work without any change.

## New dependencies

- **`drizzle-orm`** (production dependency): the typed query builder over the existing `better-sqlite3` driver. No new storage engine; the on-disk `.db` file format is unchanged.
- **`drizzle-kit`** was not added — it is only needed for migration codegen, which we are not using (migrations are written by hand in `runMigrations`).
