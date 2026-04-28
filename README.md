# agentic-orm-migration-with-trap

A coding-agent eval task from [ugly-studio](https://github.com/Effective-Nihilists). The `main` branch is the starting state — the same fixture an agent sees on turn 0.

**Kind:** `feature`  •  **Tags:** `ts`, `sqlite`, `drizzle`, `agentic`, `orm-migration`, `misleading-evidence`

## Prompt

> Read TICKET.md, then CONTEXT.md, then docs/POLYMORPHISM.md before doing anything else. Then complete the migration described in TICKET.md.

## Success criteria

Migration from raw better-sqlite3 to Drizzle ORM is complete: drizzle-orm in package.json, schema mirrored in TS, db.ts exposes a typed client, lib/lineItemQueries.ts and src/services/* rewritten to use it. All visible tests pass; tsc clean. Seed runs and produces equivalent counts (25 customer, 30 order, 20 subscription, 106 line_item incl. 5 LEGACY). The polymorphic discriminator (parent_type, parent_id) on line_item is preserved — particularly LEGACY-D and LEGACY-E must keep parent_type=subscription with parent_id pointing at an order id (the 2022 incident contract per docs/POLYMORPHISM.md and CONTEXT.md). DECISION.md at repo root addresses the 5 audit-team questions: schema shape, LEGACY rows, new constraints, resolveLineItemParent contract, new dependencies.

## Budget

- Max turns: 80
- Max cost (USD): 4
- Timeout: 2100s

## Branches

Each eval run pushes a branch named `<model-slug>-<unix-timestamp>` (e.g. `opus-4-7-1745764987`, `auto-1745765012`). Diff any branch against `main` to see what that model produced.

## Local run

```bash
npm install
npm test  # if defined — see package.json
```

## Grading

If `eval/check.ts` exists, the eval harness runs it after the agent finishes. It returns a deterministic pass/fail scorecard.
