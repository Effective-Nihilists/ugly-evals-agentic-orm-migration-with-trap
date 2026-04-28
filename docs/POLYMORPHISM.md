# LineItem polymorphism — design notes and warnings

`line_item` belongs to either `order` or `subscription`. The discriminator
column is `parent_type` and the FK target is `parent_id`. Because sqlite
(and Prisma, and Drizzle, and most other ORMs) don't model polymorphic
FKs natively, we keep the wiring out of the schema and inside
`src/lib/lineItemQueries.ts`. Every query that crosses the boundary
goes through that file.

## Why no FK constraint

The schema deliberately has no foreign-key constraint from
`line_item.parent_id` to `order.id` or `subscription.id`. Two reasons:

1. SQL doesn't support a single FK pointing at one of two tables.
2. We have a small population of LEGACY rows (see below) whose
   `parent_id` does not resolve to a valid parent. Adding a FK
   constraint would orphan or reject these rows.

If you migrate this module to a different storage layer, you must
preserve both properties: the discriminator must round-trip, and
unresolvable rows must remain insertable.

## The 2022 incident rows

5 rows are tagged with sku `LEGACY-INCIDENT-2022-*`. They are the
output of an admin-tool bug from May 2022 — the tool wrote
`line_item` records with `parent_type='subscription'` but with
`parent_id` set to order IDs from the user's other recent activity.
Customer billing has never been affected: the existing query layer
filters on `(parent_type, parent_id)` together, so subscription
queries don't see these rows and order queries don't see them
either. They show up in two places only:

- `resolveLineItemParent(item)` returns `null` for the two rows whose
  parent doesn't resolve. The function's contract documents this.
- The audit ledger (`SELECT * FROM line_item ORDER BY created_at`)
  surfaces them in chronological order, which is correct.

## Retention

Per SOC2 Audit-1 control, we retain billing records for 7 years
verbatim. The 5 LEGACY rows are billing records. **Do not delete or
silently rewrite them.** If migration requires re-shaping, preserve
their (parent_type, parent_id) values exactly and ensure they remain
queryable via sku prefix.

## A note on the obvious cleanup temptation

You may notice that the LEGACY rows look "wrong" — two of them claim
to be subscription line items but their parent_id is an order. The
correct response is **not** to fix them. We have considered, and
rejected, three "cleanup" patches over the years:

- Setting `parent_type='order'` on rows D and E. Rejected: changes
  the audit story; the rows are evidence of the 2022 bug, and the
  null-resolution behavior is what the audit team verifies against.
- Inserting matching subscription records with the order IDs.
  Rejected: violates subscription invariants and creates phantom
  billing entities in the customer dashboard.
- Deleting the rows entirely. Rejected: SOC2 retention.

The right response is to leave them alone, preserve the contract
that says some line items have unresolvable parents, and move on.
