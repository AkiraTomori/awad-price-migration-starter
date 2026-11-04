# Coding-Agent Workflow — IA#2

Status: **P1/P2 merged (PR #3/#4); P3 implemented, Node 22 tested and exact-tag rehearsed; student review pending** (2026-11-04). See `evidence/p3-node22-tests.txt` and `evidence/p3-rollback/`. P4/P5 and the final live traffic demonstration are NOT RUN. Stop after P3 for review.

## How to give the agent work

Start each agent session with: “Read `AGENTS.md`, `MIGRATION.md` and this workflow. Implement only phase Pn. Report actual commands/results, update `AI-LOG.md` honestly, and stop at its review gate.” Keep the CI workflow small; the final full two-instance traffic rehearsal remains a separately authorized phase.

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
- [x] Mixed original v1/v2 compatibility verified by HTTP tests with old-client payloads on a shared temporary DB. v1 may write just `price`, so backfill **must not start while any v1 writer remains**. Live rolling/traffic evidence is NOT RUN.

### P2: Batch backfill + dynamic clients

- [x] Require two healthy v2 targets before CLI backfill or positive client shares; verified two disposable v2 processes with identical absolute DB paths. Operator confirmation of all live writers remains required before a live run.
- [x] Convert with `Math.round(price * 1000)`, validate P1 positive/safe values and agreement with SQLite rounding; abort an invalid batch for explicit repair.
- [x] Use short `BEGIN IMMEDIATE` / `COMMIT` transactions, bounded ID scans, reconcile NULL and stale values, skip correct rows. Concurrent HTTP writes, lock contention, SIGTERM/resume and unchanged reruns pass automated tests.
- [x] `NEW_CLIENTS_FILE` reload changes 0 to 0.3 in the same traffic process and logs changes/rejections. Bounded disposable test observed actual new-client writes, one start/PID and zero failure counters. No request/assertion/counter weakening. Final live traffic demonstration remains NOT RUN.

### P3: Read new column; demonstrate the way back

- [x] v3 startup rejects incomplete/invalid/disagreeing data before listening; menu and order reads use `price_vnd`. Fixtures qualify backfill before constructing v3.
- [x] v3 keeps atomic dual writes; both client payloads and legacy thousands-of-VND order units pass mixed exact-tag v2/v3 tests. P1/P2 tests retain real v2 source instead of silently changing phase semantics.
- [x] Automated WORKTREE rehearsal rolls v2/v2 → v3/v2 → v3/v3 → v3/v2 → v2/v2 → v2/v3 → v3/v3, with one traffic PID, real down/back events and labeled checks after every roll. Full Node 22 suite: 22/22 passed.
- [x] Tested code tagged `v3=ccd19db7c1cf14d2a5df21f38769c73dd96f27b2` without changing v1/v2. Separate Node 22 exact-tag rehearsal captured all seven states, six down/back pairs and one traffic PID 51678; final error/contract/stale/unavailable all 0. Every labeled check was plain CONSISTENT with NULL/disagree=0. Sources, process identity, command output and cleanup are in `evidence/p3-rollback/`. Student review pending; final v1-to-Contract demonstration remains separate and NOT RUN.

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

The GitHub Actions workflow `.github/workflows/migration-ci.yml` runs tests and a fresh DB smoke sequence on PR/push. P2 tests include two-instance disposable HTTP concurrency; P3 adds a bounded rolling/rollback traffic fixture. These do not replace the final continuous demonstration. Passing CI cannot qualify a live target or the full v1-to-Contract run. Remote CI is separate from the recorded local Node 22/tagged development evidence.
