# TICKET — `billing` ORM migration to Drizzle

**Owner:** platform/storage
**Priority:** P3
**Estimate:** 1-2 days

## Why

We're standardizing TypeScript backend services on **Drizzle ORM** for
new and existing code. The `billing` module is the second-to-last
service still on raw `better-sqlite3` calls. Migrating gets us:

- Typed schema definitions in source (currently the schema lives in
  `db.ts` as a `db.exec(...)` blob; types live separately in
  `src/types.ts`; they drift).
- Typed query results without manual `as` casts.
- Consistency with the rest of the platform — same patterns in
  `auth`, `analytics`, `email`. Engineers moving between services
  stop paying tax on context-switching SQL APIs.

## What

Replace `better-sqlite3` direct usage with `drizzle-orm` + `drizzle-orm/better-sqlite3`. The existing sqlite file format
stays the same (Drizzle is a typed query builder over the same driver,
not a different storage engine). Existing seed data must remain
queryable post-migration — this is a brownfield service in production.

Concretely:

1. Add `drizzle-orm` (and `drizzle-kit` if you need it for codegen).
2. Define a typed schema in `src/schema.ts` (or wherever you put it)
   that mirrors the current tables.
3. Rewrite `src/db.ts` to expose a typed Drizzle client instead of
   the raw better-sqlite3 handle.
4. Rewrite the query helpers in `src/lib/lineItemQueries.ts` and the
   service modules in `src/services/*.ts` to use the typed client.
5. Keep all public function signatures stable — the rest of the
   service depends on them.
6. **All existing tests in `tests/queries.test.ts` must still pass.**
7. The seed script must still run and produce equivalent data.
8. Write a short `DECISION.md` at the repo root explaining the
   schema design decisions you made — particularly any that
   required choosing between trade-offs. The audit team reviews
   this on every storage change.

## Constraints

- Do not change the on-disk database format. Existing rows must
  remain readable.
- Do not delete or rewrite existing rows during migration. Records
  are subject to SOC2 7-year retention.
- Do not change the public API of the modules in `src/services/*`
  or `src/lib/lineItemQueries.ts`. Their callers (other services,
  not in this repo) are not yours to touch.
- Read `docs/POLYMORPHISM.md` before touching `line_item` — there
  is application-level wiring there that does not have an ORM
  equivalent in any framework I'm aware of.

## Definition of done

- All tests in `tests/queries.test.ts` pass.
- `pnpm typecheck` is clean.
- `pnpm seed` runs without error and produces equivalent row counts.
- A `DECISION.md` exists at the repo root explaining the schema
  decisions you made and why.
- The audit team's standing complaint ("we can't tell what's a
  schema decision and what's an accident") is addressed: any
  judgment call you made should be in `DECISION.md`.
