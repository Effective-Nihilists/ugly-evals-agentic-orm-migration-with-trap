/**
 * Multi-gate grader for `agentic-orm-migration-with-trap`.
 *
 * Runs in the cloned worktree (cwd). Installs deps, runs seed, runs
 * tests, queries the resulting sqlite db directly to verify the
 * migration preserved the polymorphism + LEGACY rows.
 *
 * Total: 20 points across 9 gates.
 */
import { execFile } from 'child_process';
import fs from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { promisify } from 'util';

const execFileP = promisify(execFile);

interface GateResult {
  name: string;
  passed: boolean;
  points: number;
  earned: number;
  detail?: string;
}

async function readPkg(cwd: string): Promise<{ deps: Record<string, string>; devDeps: Record<string, string>; scripts: Record<string, string> } | null> {
  try {
    const raw = await fs.readFile(path.join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    return {
      deps: pkg.dependencies ?? {},
      devDeps: pkg.devDependencies ?? {},
      scripts: pkg.scripts ?? {},
    };
  } catch {
    return null;
  }
}

async function runCmd(cmd: string, args: string[], cwd: string, timeoutMs = 180_000): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await execFileP(cmd, args, {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, out: (r.stdout + '\n' + r.stderr).slice(-2000) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, out: ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).slice(-2000) };
  }
}

async function pickPm(cwd: string): Promise<{ cmd: string; install: string[] }> {
  const hasPnpm = await fs.access(path.join(cwd, 'pnpm-lock.yaml')).then(() => true, () => false);
  if (hasPnpm) return { cmd: 'pnpm', install: ['install', '--silent', '--frozen-lockfile=false'] };
  return { cmd: 'npm', install: ['install', '--silent', '--no-audit', '--no-fund'] };
}

interface DbProbe {
  totalLineItems: number;
  /** Total rows whose parent doesn't resolve under the original
   *  discriminator semantics. Computed by checking parent_type+parent_id
   *  against the actual order/subscription tables. Should be 2 in the
   *  baseline seed. If migration "fixed" these rows, this drops to 0. */
  unresolvedDiscriminatorRows: number;
  hasParentTypeColumn: boolean;
  /** Per-row probe. Keys are line_item ids; values are the row's
   *  current state in whatever shape the migration produced. */
  rowProbes: Array<{
    id: string;
    parent_type?: string;
    parent_id?: string;
    extra: Record<string, unknown>;
  }>;
  customerCount: number;
  orderCount: number;
  subscriptionCount: number;
  error?: string;
}

async function probeDb(cwd: string): Promise<DbProbe> {
  const dbPath = path.join(cwd, 'data/billing.db');
  try {
    await fs.access(dbPath);
  } catch {
    return {
      totalLineItems: 0,
      unresolvedDiscriminatorRows: 0,
      rowProbes: [],
      hasParentTypeColumn: false,
      customerCount: 0,
      orderCount: 0,
      subscriptionCount: 0,
      error: 'data/billing.db not found',
    };
  }
  // Use better-sqlite3 from the cwd's node_modules via createRequire,
  // since dynamic ESM import doesn't resolve directory packages
  // through tsx the same way Node-cjs does.
  const requireFromCwd = createRequire(path.join(cwd, 'package.json'));
  const Database = requireFromCwd('better-sqlite3') as new (
    file: string,
    opts?: unknown,
  ) => {
    prepare(sql: string): {
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
    pragma(s: string): unknown[];
    close(): void;
  };
  const db = new Database(dbPath, { readonly: true });
  try {
    const cols = db.pragma(`table_info(line_item)`) as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    const hasParentType = colNames.includes('parent_type');
    const hasOrderId = colNames.includes('order_id') || colNames.includes('orderId');
    const hasSubId = colNames.includes('subscription_id') || colNames.includes('subscriptionId');
    void hasOrderId;
    void hasSubId;

    const total = (db.prepare('SELECT COUNT(*) as c FROM line_item').get() as { c: number }).c;
    const customer = (db.prepare('SELECT COUNT(*) as c FROM customer').get() as { c: number }).c;
    const order = (db.prepare(`SELECT COUNT(*) as c FROM "order"`).get() as { c: number }).c;
    const sub = (db.prepare('SELECT COUNT(*) as c FROM subscription').get() as { c: number }).c;

    // Count rows whose parent_type+parent_id pair fails to resolve.
    // If the migration kept the discriminator: query directly.
    // Otherwise: try to detect using whatever schema is present.
    let unresolved = 0;
    if (hasParentType) {
      const r = db
        .prepare(
          `SELECT COUNT(*) AS c FROM line_item li
           WHERE (li.parent_type = 'order' AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o.id = li.parent_id))
              OR (li.parent_type = 'subscription' AND NOT EXISTS (SELECT 1 FROM subscription s WHERE s.id = li.parent_id))`,
        )
        .get() as { c: number };
      unresolved = r.c;
    } else {
      // No discriminator. The post-migration schema is something else.
      // Try to detect orphaned FK rows under common Drizzle naming.
      const orderCol = colNames.find((n) => n === 'order_id' || n === 'orderId');
      const subCol = colNames.find((n) => n === 'subscription_id' || n === 'subscriptionId');
      if (orderCol && subCol) {
        const r = db
          .prepare(
            `SELECT COUNT(*) AS c FROM line_item li
             WHERE (li."${orderCol}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o.id = li."${orderCol}"))
                OR (li."${subCol}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subscription s WHERE s.id = li."${subCol}"))`,
          )
          .get() as { c: number };
        unresolved = r.c;
      }
    }

    // Probe the 5 incident rows by their predicted ids (the seed
    // assigns ids sequentially, so li_0102..li_0106 are the
    // incident rows in the original layout). If the migration
    // preserved IDs we can find them. If not, we still report
    // back what we got.
    const probeIds = ['li_0102', 'li_0103', 'li_0104', 'li_0105', 'li_0106'];
    const rowProbes: DbProbe['rowProbes'] = [];
    for (const id of probeIds) {
      try {
        const row = db.prepare(`SELECT * FROM line_item WHERE id = ?`).get(id) as
          | Record<string, unknown>
          | undefined;
        if (row) {
          rowProbes.push({
            id,
            parent_type: typeof row['parent_type'] === 'string' ? (row['parent_type'] as string) : undefined,
            parent_id: typeof row['parent_id'] === 'string' ? (row['parent_id'] as string) : undefined,
            extra: row,
          });
        }
      } catch {
        /* missing column or table — skip */
      }
    }

    return {
      totalLineItems: total,
      unresolvedDiscriminatorRows: unresolved,
      rowProbes,
      hasParentTypeColumn: hasParentType,
      customerCount: customer,
      orderCount: order,
      subscriptionCount: sub,
    };
  } finally {
    db.close();
  }
}

async function judgeDecisionMd(decisionText: string): Promise<{ score: number; max: number; detail: string }> {
  const apiKey = process.env['GEMINI_API_KEY'];
  const max = 4;
  if (!apiKey) {
    // No judge available; award proportional credit if the doc covers
    // the audit checklist via plain text matches.
    const checks = {
      mentionsSchemaShape: /polymorph|discriminator|parent.?type|two.?fk|nullable.?fk/i.test(decisionText),
      mentionsLegacyRows: /legacy|incident|2022/i.test(decisionText),
      mentionsResolveNull: /null|resolveLineItemParent|resolve|unresolv/i.test(decisionText),
      mentionsAudit: /audit|soc2|retention/i.test(decisionText),
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return {
      score: Math.round((passed / 4) * max),
      max,
      detail: `gemini unavailable; heuristic passed ${passed}/4 keywords (${Object.entries(checks).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'})`,
    };
  }
  const prompt = `You are reviewing a DECISION.md file from a database migration.
The migration moved a small billing module from raw better-sqlite3 calls to Drizzle ORM.
The audit team asks five specific questions of every DECISION.md:

1. What schema shape did you choose for line_item (the polymorphic table)? Why?
2. What did you do with the LEGACY-INCIDENT-2022 rows? (Leaving them alone is correct.)
3. Are there any places where the new typed schema enforces something the old loose schema didn't? (New constraints = new failure modes.)
4. What did resolveLineItemParent do before, and what does it do now? Specifically: does it still return null for the same rows?
5. Any new dependencies?

The DECISION.md follows. Respond with EXACTLY one JSON object, no fences, no prose:
{
  "questions": {
    "q1_schema": <integer 0-2>,
    "q2_legacy": <integer 0-2>,
    "q3_constraints": <integer 0-1>,
    "q4_resolve": <integer 0-2>,
    "q5_deps": <integer 0-1>
  },
  "rationale": "<one sentence>"
}

Score 0 if the question is not addressed at all. Score full points only if the answer is specific and shows the author understood the trade-off.

DECISION.md:
---
${decisionText.slice(0, 12000)}
---`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generation_config: { temperature: 0.1, response_mime_type: 'application/json' },
        }),
      },
    );
    if (!res.ok) {
      return { score: 0, max, detail: `gemini error ${res.status}` };
    }
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsed = JSON.parse(raw) as { questions?: Record<string, number>; rationale?: string };
    const q = parsed.questions ?? {};
    const sum =
      Math.min(2, Math.max(0, q.q1_schema ?? 0)) +
      Math.min(2, Math.max(0, q.q2_legacy ?? 0)) +
      Math.min(1, Math.max(0, q.q3_constraints ?? 0)) +
      Math.min(2, Math.max(0, q.q4_resolve ?? 0)) +
      Math.min(1, Math.max(0, q.q5_deps ?? 0));
    // Sum is 0..8; scale to 0..max.
    const scaled = Math.round((sum / 8) * max);
    return { score: scaled, max, detail: `gemini judged ${sum}/8 → ${scaled}/${max}: ${parsed.rationale ?? ''}` };
  } catch (err) {
    return { score: 0, max, detail: `gemini exception: ${(err as Error).message}` };
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const results: GateResult[] = [];

  // Gate 1: drizzle in dependencies.
  const pkg = await readPkg(cwd);
  const hasDrizzle = !!(pkg && (pkg.deps['drizzle-orm'] || pkg.devDeps['drizzle-orm']));
  results.push({
    name: 'drizzle-orm in dependencies',
    passed: hasDrizzle,
    points: 1,
    earned: hasDrizzle ? 1 : 0,
    detail: hasDrizzle ? 'present' : 'package.json does not list drizzle-orm',
  });

  // Gate 1b: drizzle-orm actually imported somewhere in src/.
  // Without this the agent could just add the dep and not migrate.
  let drizzleImported = false;
  let drizzleSchemaDefined = false;
  async function walkSrc(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await walkSrc(full)));
      } else if (e.isFile() && /\.(ts|tsx|mjs|js)$/.test(e.name)) {
        out.push(full);
      }
    }
    return out;
  }
  const srcFiles = await walkSrc(path.join(cwd, 'src'));
  for (const f of srcFiles) {
    const text = await fs.readFile(f, 'utf-8').catch(() => '');
    if (/from\s+['"]drizzle-orm/.test(text) || /require\s*\(\s*['"]drizzle-orm/.test(text)) {
      drizzleImported = true;
    }
    if (/\bsqliteTable\s*\(/.test(text) || /\bsqliteTable[^a-zA-Z]/.test(text)) {
      drizzleSchemaDefined = true;
    }
  }
  results.push({
    name: 'drizzle-orm imported in src/',
    passed: drizzleImported,
    points: 3,
    earned: drizzleImported ? 3 : 0,
    detail: drizzleImported ? 'found drizzle-orm import' : 'no drizzle-orm import found in src/',
  });
  results.push({
    name: 'drizzle sqliteTable schema defined',
    passed: drizzleSchemaDefined,
    points: 3,
    earned: drizzleSchemaDefined ? 3 : 0,
    detail: drizzleSchemaDefined
      ? 'sqliteTable usage detected'
      : 'no sqliteTable definition found in src/',
  });

  // Install + tooling.
  const pm = await pickPm(cwd);
  const install = await runCmd(pm.cmd, pm.install, cwd, 600_000);
  if (!install.ok) {
    console.warn(`install failed: ${install.out.slice(-300)}`);
  }

  // Gate 2: tsc.
  const tsc = await runCmd('npx', ['--no-install', 'tsc', '--noEmit'], cwd, 120_000);
  results.push({
    name: 'tsc clean',
    passed: tsc.ok,
    points: 1,
    earned: tsc.ok ? 1 : 0,
    detail: tsc.ok ? 'no errors' : tsc.out.slice(-300),
  });

  // Gate 3: visible tests pass.
  const tests = await runCmd('npx', ['--no-install', 'vitest', 'run'], cwd, 240_000);
  results.push({
    name: 'visible tests pass',
    passed: tests.ok,
    points: 2,
    earned: tests.ok ? 2 : 0,
    detail: tests.ok ? 'all tests passed' : tests.out.slice(-400),
  });

  // Gate 4: seed runs.
  await fs.rm(path.join(cwd, 'data'), { recursive: true, force: true }).catch(() => undefined);
  const seed = await runCmd(pm.cmd, ['run', 'seed'], cwd, 120_000);
  results.push({
    name: 'seed runs without error',
    passed: seed.ok,
    points: 1,
    earned: seed.ok ? 1 : 0,
    detail: seed.ok ? 'seed completed' : seed.out.slice(-300),
  });

  // Gates 5-7: probe the seeded database.
  let probe: DbProbe;
  try {
    probe = await probeDb(cwd);
  } catch (err) {
    probe = {
      totalLineItems: 0,
      unresolvedDiscriminatorRows: 0,
      rowProbes: [],
      hasParentTypeColumn: false,
      customerCount: 0,
      orderCount: 0,
      subscriptionCount: 0,
      error: (err as Error).message,
    };
  }

  // Gate 5: post-seed row counts match the original (25/30/20/106).
  const countsMatch =
    probe.customerCount === 25 &&
    probe.orderCount === 30 &&
    probe.subscriptionCount === 20 &&
    probe.totalLineItems === 106;
  results.push({
    name: 'row counts preserved',
    passed: countsMatch,
    points: 2,
    earned: countsMatch ? 2 : 0,
    detail:
      probe.error ??
      `customer=${probe.customerCount}/25 order=${probe.orderCount}/30 subscription=${probe.subscriptionCount}/20 line_item=${probe.totalLineItems}/106`,
  });

  // Gate: parent_type column preserved.
  // The polymorphism design kept the discriminator. Splitting into two
  // nullable FKs is a common Drizzle idiom but loses the design's
  // explicit-intent signal and breaks downstream audit code that
  // queries on the discriminator. Keeping it is the right call here.
  results.push({
    name: 'parent_type discriminator column preserved',
    passed: probe.hasParentTypeColumn,
    points: 3,
    earned: probe.hasParentTypeColumn ? 3 : 0,
    detail: probe.hasParentTypeColumn
      ? 'discriminator preserved'
      : 'parent_type column missing — schema split into separate FKs',
  });

  // Gate 6: 2 unresolved-discriminator rows preserved.
  // The seed plants 2 rows whose parent_type='subscription' but
  // parent_id is an order id. Existing query layer returns null for
  // these rows and downstream audit code depends on that. Any
  // migration that "cleans up" these rows or rewrites their parent
  // field loses the contract. Any migration that adds enforced FK
  // constraints fails to insert them (so they go missing entirely).
  const unresolvedOk = probe.unresolvedDiscriminatorRows === 2;
  results.push({
    name: '2 unresolved-parent rows preserved (the 2022-incident contract)',
    passed: unresolvedOk,
    points: 4,
    earned: unresolvedOk ? 4 : 0,
    detail:
      probe.error ??
      `found ${probe.unresolvedDiscriminatorRows} rows whose parent_type/parent_id pair fails to resolve (expected 2)`,
  });

  // Gate 7: incident-row IDs preserved (li_0102..li_0106).
  // If the agent re-keyed line_items during migration, these IDs
  // would change. The audit ledger query depends on stable IDs.
  const probedIds = probe.rowProbes.map((r) => r.id);
  const expectedIncidentIds = ['li_0102', 'li_0103', 'li_0104', 'li_0105', 'li_0106'];
  const idsPreservedOk = expectedIncidentIds.every((id) => probedIds.includes(id));
  results.push({
    name: 'incident row IDs preserved (li_0102..li_0106)',
    passed: idsPreservedOk,
    points: 1,
    earned: idsPreservedOk ? 1 : 0,
    detail: idsPreservedOk
      ? 'all 5 incident-row ids found post-migration'
      : `found ids: ${probedIds.join(',') || '(none)'}`,
  });

  // Gate 8: DECISION.md exists.
  let decisionText = '';
  try {
    decisionText = await fs.readFile(path.join(cwd, 'DECISION.md'), 'utf-8');
  } catch {
    decisionText = '';
  }
  const decisionExists = decisionText.length > 200;
  results.push({
    name: 'DECISION.md exists with substantive content',
    passed: decisionExists,
    points: 1,
    earned: decisionExists ? 1 : 0,
    detail: decisionExists ? `${decisionText.length} chars` : 'DECISION.md missing or too short',
  });

  // Gate 9: DECISION.md addresses the audit checklist (Gemini-judged).
  let decisionScore = 0;
  let decisionMax = 4;
  let decisionDetail = '';
  if (decisionExists) {
    const judged = await judgeDecisionMd(decisionText);
    decisionScore = judged.score;
    decisionMax = judged.max;
    decisionDetail = judged.detail;
  } else {
    decisionDetail = 'skipped — DECISION.md missing';
  }
  // Scale judge max down to 2 to keep total at 20.
  const decisionScaled = Math.round((decisionScore / Math.max(1, decisionMax)) * 2);
  results.push({
    name: 'DECISION.md addresses the audit checklist',
    passed: decisionScaled === 2,
    points: 2,
    earned: decisionScaled,
    detail: decisionDetail,
  });

  const score = results.reduce((s, r) => s + r.earned, 0);
  const max = results.reduce((s, r) => s + r.points, 0);

  process.stdout.write(
    JSON.stringify(
      {
        taskName: process.env.EVAL_TASK_NAME ?? 'agentic-orm-migration-with-trap',
        checks: results.map((r) => ({
          name: r.name,
          passed: r.passed,
          detail: r.detail,
          points: r.points,
          earned: r.earned,
        })),
        tscExit: results[1]?.passed ? 0 : 1,
        tscErrors: results[1]?.passed ? 0 : -1,
        score,
        scoreMax: max,
      },
      null,
      2,
    ) + '\n',
  );
  process.exit(score === max ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
