# Coding-Agent Workflow — IA#2

Status: **P1 locally implemented and tested; student review pending** (2026-11-04). See `evidence/p1-validation.txt` for actual disposable validation. P2–P5 and live traffic are NOT RUN. The remaining workflow is a handoff checklist. Work one phase at a time; commit code changes and ask the student to inspect each gate.

## How to give the agent work

Start each agent session with: “Read `AGENTS.md`, `MIGRATION.md` and this workflow. Implement only phase Pn. Report actual commands/results, update `AI-LOG.md` honestly, and stop at its review gate.” Keep the CI workflow small; run the full two-instance traffic rehearsal locally.

| Phase | Agent-owned tasks | Done when | Review gate |
|---|---|---|---|
| P0 — baseline | Inspect starter, pin original v1 SHA; run test/migrate/seed in an isolated DB; prepare version worktrees and traffic-run instructions | Baseline passes; v1 resolves to original source | Confirm setup and no unintended data changes |
| P1 — expand/v2 | Add `002_add_price_vnd.up/down.sql`; implement legacy-read/dual-write API, old/new payload validation and response fields; add tests | v1+v2 compatibility tests pass; create and PATCH update both columns | Student reviews queries, validation, migration-down output |
| P2 — backfill | Implement `scripts/backfill.js` using bounded batches and transactions, resumable without changing completed rows; add runtime traffic-share toggle | Backfill under live writes, twice, yields `CONSISTENT` and 0 nulls; traffic remains one process | Student verifies that no v1 writer remains and enables new clients |
| P3 — switch reads | Implement/tag v3; roll v2→v3 one instance at a time; roll v3→v2→v3 while traffic continues | Mixed-version writes stay consistent; zero failed requests; consistency before/after rollback | Student reviews logged `down`/`back` events |
| P4 — contract | Add reversible bridge `003`; implement/tag new-only v4; roll v3→v4; add `004_drop_price.up/down.sql` only after v4 is everywhere | Old and new clients work after drop; no references to `price` in v4 SQL; no traffic failures | **Explicit student approval** for drop/point of no return |
| P5 — submission | Re-run clean demonstration once, capture all evidence, update English docs, self-score with precise file/line evidence, package `.git` | Tags can be checked out and replayed; one ZIP with correct ID/score name | Student verifies and submits from university account |

## Phase-specific implementation checklist

### P1: Expand + dual write

- [x] `002` adds nullable INTEGER without changing or deleting `price`, and its down can revert safely before newer code depends on it (disposable rehearsal passed).
- [x] Both `POST /menu` and `PATCH /menu/:id` accept legacy `price` or new `priceVnd` and write both columns atomically.
- [x] `GET /menu`, `GET /menu/:id`, and write responses expose numeric `price` and integer `priceVnd`; derive from legacy `price` for both null and stale new values.
- [x] Mixed original v1/v2 compatibility verified by HTTP tests with old-client payloads on a shared temporary DB. v1 may write just `price`, so backfill **must not start yet**. Live rolling/traffic evidence is NOT RUN.

### P2: Batch backfill + dynamic clients

- [ ] Wait for v2/v2; verify via health/ports/processes (not an assumed version).
- [ ] Convert with `Math.round(price * 1000)` or equivalent SQL `CAST(round(price * 1000) AS INTEGER)`; validate safe integer/positive values.
- [ ] Use short `BEGIN IMMEDIATE` / `COMMIT` transactions, bounded ID batches, only filling null or otherwise controlled rows, and re-run without changing correct data.
- [ ] Change client mix from 0 to >0 **within the original traffic process**. Starter `NEW_CLIENTS` is read only on launch; a flag/file reload must be introduced and its changes logged. Do not restart or silently splice logs.

### P3: Read new column; demonstrate the way back

- [ ] Read `price_vnd` as source of truth only after `price_vnd_null=0` and `disagree=0`.
- [ ] Keep both columns updated in v3; v2 must remain safe throughout the rollback experiment.
- [ ] Under the same traffic process, roll v3→v2→v3 one port at a time, run labeled `npm run check` before and after, and capture true output.

### P4: New-only and contract

- [ ] While v3 and v4 coexist, use a reversible database synchronization bridge (e.g. trigger from new column to legacy) so v3 dual-write and v4 new-only do not produce `disagree` while `price` exists.
- [ ] v4 reads/writes `price_vnd` only; legacy API `price` is calculated from the integer. `POST /orders` still returns total in thousands and stores `order_items.unit_price` in thousands.
- [ ] Deploy v4 to **both** instances, then run `004` to remove temporary triggers and drop `price`.
- [ ] `004.down.sql` is a recovery procedure to recreate/backfill legacy data, not permission to restart v3 against the contracted schema.

## Evidence and reproducibility

- `traffic-log.txt`: **one continuous run**, start on v1, include every migration/restart/rollback, end with `RESULT: zero failed requests`; after all v2 instances are live, exercise `NEW_CLIENTS > 0`.
- `check-log.txt`: label every schema/deploy/rollback step and include full `npm run check` output; separately append each migration down/up rehearsal on a disposable database.
- `MIGRATION.md`: replace this plan's proposed commands and status with commands that actually ran, and cite tagged code versions.
- `AI-LOG.md`: log assistance chronologically (tool, prompt, kept/changed/rejected/by hand); never invent work.
- `SELF_ASSESSMENT_REPORT.md`: one row per six rubric criteria, verifiable evidence, point total equal to ZIP filename, and a frank “What I did not manage.”

## One-command CI is intentionally limited

The GitHub Actions workflow `.github/workflows/migration-ci.yml` runs tests and a fresh DB smoke sequence on PR/push. Passing CI says the current checkout can initialize, seed and pass basic checks; it cannot show rolling zero downtime, replay tags, or prove live rollback. Those need the local two-instance run.
