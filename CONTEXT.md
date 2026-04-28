# CONTEXT — billing ORM migration

A loose collection of Slack threads, design docs, and notes that
the previous engineer pointed at when she handed this off. Nothing
here is required reading; nothing here is forbidden either. The
threads are posted in chronological order so the gaps between
topics make sense.

---

## #platform-storage — three months ago

**@avery (platform lead)**
> standardizing on drizzle-orm across all backend services. analytics
> migrated last sprint, auth is in flight, email is on deck. billing
> is going to be the painful one because it has actual money in it.

**@jin (billing on-call)**
> i can take billing if you give me a clean week. we have ~12 tests
> and ~8 callers in other services, all of which i can map. the only
> weird thing in there is the line_item polymorphism which we
> deliberately keep out of the schema. drizzle won't help us model
> it; just don't fight it.

**@avery**
> noted. ticket'd, low priority for now.

**@jin**
> docs/POLYMORPHISM.md has the warnings. anyone who picks this up
> please read that before you start writing code.

---

## #billing-eng — eight weeks ago, unrelated thread on customer email rate limiting

**@priya (eng lead)**
> we need to throttle marketing-tier sends per customer. proposal:
> add a `customer.send_quota` JSON column with a sliding window.

**@kareem**
> can we do this on the email service side instead? billing is
> already overloaded with non-billing concerns and the next
> engineer to touch it is going to ask why customer has a
> send_quota column.

**@priya**
> fair. moving it to email. closing.

(this thread is here because if you grep the slack archive for
"billing" you'll find it. it's noise. ignore.)

---

## #billing-eng — six weeks ago

**@jin**
> ok i started looking at the drizzle migration. couple of quick
> findings before i forget.

**@jin**
> 1. line_item is the entire job. everything else is a 30-minute
>    refactor.
> 2. the legacy rows from the 2022 incident are STILL THERE. we
>    talked about cleaning them up in the migration. don't.
>    seriously. don't.
> 3. resolveLineItemParent's null path is load-bearing. there's a
>    downstream audit job in another service that depends on it
>    returning null for those exact rows. if you "fix" them, the
>    audit job breaks silently and we don't find out for a quarter.

**@priya**
> wait i thought we had cleaned those up after the incident? what
> still has parent_type='subscription' pointing at order ids?

**@jin**
> 5 rows. 3 are normal LEGACY-INCIDENT rows on actual orders. 2 are
> the weird ones. they look like subscription line items but their
> parent_id is an order. resolveLineItemParent returns null for
> those two. that's the contract.

**@priya**
> ok. what's the SOC2 implication of leaving them?

**@jin**
> already cleared with audit in 2022. retention is satisfied because
> the rows still exist. modifying them would re-trigger the same
> review and i don't want that on my plate.

**@priya**
> understood. flagging in the migration ticket.

---

## #platform-storage — four weeks ago, drizzle questions

**@kareem**
> drifting question for the drizzle folks: when you migrate a table
> with foreign keys that don't exist in the data, does the typed
> schema force you to add `references()`? we have some application-
> level FKs in billing that aren't enforced at the DB layer.

**@avery**
> drizzle won't enforce anything you don't tell it to. `references()`
> is opt-in on column definitions. if your existing rows would
> violate a constraint you'd add, leave the constraint off and
> document it.

**@kareem**
> got it. so you can model "this is the FK target conceptually"
> without forcing every row to satisfy it.

**@avery**
> right. document the loose constraint in DECISION.md so the next
> person knows it's intentional.

---

## #incidents — earlier this week, unrelated outage

**@oncall**
> P0 in payments — stripe webhook 500s on idempotency-key collisions.
> billing service is involved as a downstream consumer.

**@jin**
> not related to the migration in flight. we're not touching the
> webhook path.

**@oncall**
> ack. closing this from the migration's worry list.

(this thread is here for the same reason as the rate-limit thread.
search noise. ignore unless something connects.)

---

## docs/POLYMORPHISM.md (excerpt, for convenience)

> "The 5 LEGACY rows… show up in the audit ledger… in chronological
> order, which is correct. resolveLineItemParent returns null for
> the two rows whose parent doesn't resolve. The function's contract
> documents this."
>
> Per SOC2 Audit-1 control, we retain billing records for 7 years
> verbatim. **Do not delete or silently rewrite them.** If migration
> requires re-shaping, preserve their (parent_type, parent_id)
> values exactly and ensure they remain queryable via sku prefix.

---

## handoff notes from @jin (last message in the channel before she left)

> the migration ticket is sized for 1-2 days. the only thing that
> can blow that up is overthinking line_item. the existing wiring
> works. drizzle's typed schema can model `line_item` as having
> two text columns (`parent_type`, `parent_id`) with no relation,
> and the helper functions in lineItemQueries.ts can stay
> structurally identical — just typed via the new client.
>
> if you find yourself reaching for "let me just clean up the
> legacy rows" or "let me model this with two nullable FKs" or
> "let me normalize the schema first" — pause. read
> POLYMORPHISM.md again. neither of those is the right move.
> the simple migration is the right migration.

---

## Audit team checklist (for DECISION.md)

When you write DECISION.md, the audit team is going to look for:

1. **What schema shape did you choose for line_item?** Did you
   keep the polymorphic discriminator pattern, or did you split
   into two FKs, or something else? Why?
2. **What did you do with the LEGACY-INCIDENT-2022 rows?** "I left
   them alone" is a valid answer. "I cleaned them up" requires a
   re-review of the SOC2 implications.
3. **Are there any places where the new typed schema enforces
   something the old loose schema didn't?** New constraints can
   create new failure modes for existing data. Audit needs to know.
4. **What did `resolveLineItemParent` do before, and what does it
   do now?** Specifically: does it still return `null` for the same
   rows it returned `null` for before?
5. **Any new dependencies?** Drizzle adds a couple — call them out.

A two-paragraph DECISION.md that addresses these five questions
directly is what we're looking for. A README-style write-up that
talks about Drizzle generally is not.
