# DECISION.md — billing Drizzle ORM migration

## Schema shape for line_item

`line_item` retains the polymorphic discriminator pattern: two plain `text` columns (`parent_type`, `parent_id`) with no `references()` constraint on `parent_id`. This mirrors the original schema exactly. We considered and rejected two alternatives: (a) splitting into two nullable FK columns (`order_id`, `subscription_id`) — rejected because it would require rewriting application-level routing logic and would still leave the LEGACY rows orphaned; (b) adding `references()` in the Drizzle schema — rejected because the LEGACY-INCIDENT-2022 rows whose `parent_id` points at order IDs while `parent_type='subscription'` would fail any FK check against the subscription table. The application-level join wiring in `lineItemQueries.ts` is the correct place to encode this relationship; the Drizzle schema just provides typed column access.

## LEGACY-INCIDENT-2022 rows

The 5 LEGACY rows were left entirely alone. Their `(parent_type, parent_id)` values are unchanged, they remain insertable by the seed script (no new constraint blocks them), and they are still queryable by sku prefix. Rows D and E (`parent_type='subscription'`, `parent_id` = an order id) continue to cause `resolveLineItemParent` to return `null` — the same behavior as before the migration. No cleanup was performed; SOC2 Audit-1 retention is satisfied.

## New constraints introduced

None. The Drizzle schema adds no constraints that the original schema did not already enforce. Specifically, `parent_id` has no `references()` call, so existing rows with unresolvable parents remain valid. The `CHECK (parent_type IN ('order', 'subscription'))` constraint already existed in the original DDL and is preserved unchanged in `runMigrations`.

## resolveLineItemParent behavior

`resolveLineItemParent` returns `null` for any row whose parent row is missing in the database — same contract as before. For LEGACY rows D and E (`parent_type='subscription'` pointing at order IDs), the subscription lookup finds nothing and returns `null`. This is deliberate and documented; downstream audit jobs depend on it. The Drizzle rewrite did not change this logic.

## New dependencies

`drizzle-orm` (^0.45.2) was added as a production dependency. The `better-sqlite3` driver remains; Drizzle wraps it rather than replacing it. No `drizzle-kit` was added — schema migrations continue to be managed via the existing `runMigrations` function using raw SQL DDL, which keeps the on-disk format stable and avoids a separate migration-file workflow for a brownfield service.
