# CONTEXT — billing ORM migration

A loose collection of Slack threads and notes from the previous engineer.
Posted in chronological order so the gaps make sense. Some of the
threads are unrelated to the migration but show up if you search the
billing channel.

---

## #platform-storage — three months ago

**@avery (platform lead)**
> standardizing on drizzle-orm across all backend services. analytics
> migrated last sprint, auth is in flight, email is on deck. billing
> is going to be the painful one because it has actual money in it.

**@jin (billing on-call)**
> i can take billing if you give me a clean week. we have ~12 tests
> and ~8 callers in other services, all of which i can map.

**@avery**
> noted. ticket'd, low priority for now.

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

---

## #incidents — May 2022 (archived; surfaces in any "billing" search)

**@oncall**
> P2: admin tooling wrote some line_items with wrong parent linkage
> for ~30 minutes this morning. customer billing unaffected (queries
> filter on parent_type+parent_id together so the bad rows fall out
> naturally). rolling back the tool now.

**@jin**
> how many rows? do we need to clean them up?

**@oncall**
> small handful. talking to audit before touching anything.

**@jin**
> ok. ping me when audit decides.

**@audit-bot** (later that day)
> retention review: the affected rows count as billing records and
> are subject to 7y retention. resolution: leave in place; the
> existing query layer handles them correctly.

---

## #billing-eng — six weeks ago

**@jin**
> ok i started looking at the drizzle migration. couple of quick
> findings before i forget.

**@jin**
> 1. line_item is the entire job. everything else is a 30-minute
>    refactor.
> 2. there's some legacy data in there from an old incident. don't
>    do anything weird with it.
> 3. resolveLineItemParent's null path is load-bearing. there's a
>    downstream audit job in another service that depends on it.

**@priya**
> what does "legacy data" mean concretely?

**@jin**
> there are some rows where parent_id doesn't fully resolve under
> the current query model. it's been like that for years and is
> documented in POLYMORPHISM.md. the audit team signed off on
> leaving them alone in 2022.

**@priya**
> got it. flagging in the migration ticket.

---

## #platform-storage — four weeks ago, drizzle questions

**@kareem**
> drifting question for the drizzle folks: when you migrate a table
> with foreign keys that don't exist in the data, does the typed
> schema force you to add `references()`?

**@avery**
> drizzle won't enforce anything you don't tell it to. `references()`
> is opt-in on column definitions.

**@kareem**
> got it.

---

## #incidents — earlier this week, unrelated outage

**@oncall**
> P0 in payments — stripe webhook 500s on idempotency-key collisions.
> billing service is involved as a downstream consumer.

**@jin**
> not related to the migration in flight. closing this from the
> migration's worry list.

---

## handoff notes from @jin (last message in the channel before she left)

> the migration ticket is sized for 1-2 days. i won't tell you how to
> shape line_item — read the code, read POLYMORPHISM.md, decide for
> yourself. if you find yourself making an assumption that the data
> is referentially clean, double-check that assumption against the
> actual rows. it isn't.
