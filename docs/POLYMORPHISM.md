# LineItem polymorphism — design notes

`line_item` belongs to either `order` or `subscription`. The discriminator
column is `parent_type` and the FK target is `parent_id`. SQL doesn't
support a single FK pointing at one of two tables, so the join logic
lives application-side in `src/lib/lineItemQueries.ts`.

## Schema shape

```
line_item (
  id            text primary key,
  parent_type   text not null check (parent_type in ('order', 'subscription')),
  parent_id     text not null,
  sku           text not null,
  qty           integer not null,
  unit_price_cents integer not null,
  created_at    integer not null
)
```

There is no foreign-key constraint between `line_item.parent_id` and
the parent tables. The data is not guaranteed to be referentially
clean — `resolveLineItemParent` returns `null` when a parent row can't
be found, and downstream code handles the null path explicitly.

## Query layer

All cross-boundary access goes through `lineItemQueries.ts`. There are
three primary helpers:

- `listLineItemsForOrder(db, orderId)` — filters by `parent_type='order'`.
- `listLineItemsForSubscription(db, subscriptionId)` — filters by `parent_type='subscription'`.
- `resolveLineItemParent(db, item)` — uses `parent_type` to choose
  the lookup table; returns `null` when the target row is missing.

The discriminator-based filter is what keeps the parent-listing queries
clean. Without it, every order query would have to LEFT JOIN every
parent table.

## What downstream code expects

The audit ledger and the customer-billing summary both call
`resolveLineItemParent` and branch on the `null` case. The ledger
treats `null` as "orphaned line item" and surfaces it on a separate
report. The billing summary skips it.

If you change this module, those two consumers depend on:
1. The `(parent_type, parent_id)` pair being preserved per row.
2. `resolveLineItemParent` continuing to return `null` for rows whose
   parent doesn't resolve under the discriminator.
3. The ledger seeing every line_item exactly once.
