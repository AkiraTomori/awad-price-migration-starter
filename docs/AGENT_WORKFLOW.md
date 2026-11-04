# Coding-Agent Workflow — IA#2

Status: **P4 integrated in main via PR #7 ancestry; PR #6 closed/unmerged. P5-A complete, pending Gate A review** (2026-11-04). See `evidence/p5-a-node22-validation.txt` and `evidence/p5-a-preflight/`. Final S0–S8, live Contract, score/ZIP and submission are NOT RUN. Stop at Gate A; do not merge automatically or start the demonstration.

## How to give the agent work

Start each agent session with: “Read `AGENTS.md`, `MIGRATION.md` and this workflow. Implement only phase Pn. Report actual commands/results, update `AI-LOG.md` honestly, and stop at its review gate.” Keep the CI workflow small; the final full two-instance traffic rehearsal remains a separately authorized phase.

| Phase | Agent-owned tasks | Done when | Review gate |
|---|---|---|---|
| P0 — baseline | Inspect starter, pin original v1 SHA; run test/migrate/seed in an isolated DB; prepare version worktrees and traffic-run instructions | Baseline passes; v1 resolves to original source | Confirm setup and no unintended data changes |
| P1 — expand/v2 | Add `002_add_price_vnd.up/down.sql`; implement legacy-read/dual-write API, old/new payload validation and response fields; add tests | v1+v2 compatibility tests pass; create and PATCH update both columns | Student reviews queries, validation, migration-down output |
| P2 — backfill | Implement `scripts/backfill.js` using bounded batches and transactions, resumable without changing completed rows; add runtime traffic-share toggle | Backfill under live writes, twice, yields `CONSISTENT` and 0 nulls; traffic remains one process | Student verifies that no v1 writer remains and enables new clients |
| P3 — switch reads | Implement/tag v3; roll v2→v3 one instance at a time; roll v3→v2→v3 while traffic continues | Mixed-version writes stay consistent; zero failed requests; consistency before/after rollback | Student reviews logged `down`/`back` events |
| P4 — contract | Add reversible bridge `003`; implement/tag new-only v4; roll v3→v4; add `004_drop_price.up/down.sql` only after v4 is everywhere | Old and new clients work after drop; no references to `price` in v4 SQL; no traffic failures | **Explicit student approval** for drop/point of no return |
| P5-A — preparation | Verify main ancestry/tags, Node 22 suite, isolated DB/PID/down-up proofs; prepare non-executing operator plan | Actual preflight evidence, preserved history/raw logs and clearly identified proposed target | **Gate A review before S0 or final traffic starts** |
| P5-B — execution | One continuous v1-to-Contract traffic run, checks after each action/roll | Actual S0–post-S8 output with zero failure counters | **Separate explicit S8 approval** after verified v4/v4, shared DB, consistency and backup |
| P5-C — submission preparation | English self-assessment and evidence-backed score, ZIP including `.git`, extraction verification | Reviewable final artifacts with correct StudentID/score | Student reviews and submits; no automatic merge/submission |

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
- [x] Tested code tagged `v3=ccd19db7c1cf14d2a5df21f38769c73dd96f27b2` without changing v1/v2. Separate Node 22 exact-tag rehearsal captured all seven states, six down/back pairs and one traffic PID 51678; final error/contract/stale/unavailable all 0. Every labeled check was plain CONSISTENT with NULL/disagree=0. Sources, process identity, command output and cleanup are in `evidence/p3-rollback/`. P3 PR #5 was reviewed and merged on 2026-11-04; final v1-to-Contract demonstration remains separate and NOT RUN.

### P4: New-only and contract

- [x] 003 bridge covers INSERT/UPDATE and is reversible; recursion ON/OFF tests pass. 003 up/down/re-up and data preservation proven on disposable DBs.
- [x] v4 SQL uses only `price_vnd`, including startup validation; SQL trace and actual restart after Contract prove legacy independence. Both HTTP fields/payloads and original order-price units pass tests.
- [x] v4 tagged at `51669379446f8f34473a90104ea939284335e9f2` before 004 existed; Contract introduced later at `29153bd8eb2ecaf44cf38338f17fd60e4c1d9a3e`. v1–v3 unchanged. Full final Node 22 suite: 28/28.
- [x] Exact-tag disposable rolling/rollback: v3/v3 → v4/v3 → v4/v4 → v4/v3 → v3/v3 → v3/v4 → v4/v4, traffic PID 72935, six down/back pairs, all four failure counters 0; labeled checks after every roll are plain CONSISTENT.
- [x] On a separate disposable DB only, verify two tagged v4 listeners and backups, then execute 004 up/down/up. Menu/order data, old/new HTTP, seed/check and restored bridge pass. v3 initialization fails before schema recovery and succeeds afterward. No code-only rollback claim.
- [ ] **Live S8 gate remains closed:** student review of P4, verified live v4/v4 and shared DB identity, current verified backup and explicit student go-ahead are required before dropping live `price`. Final demonstration/P5 needs a separate task. No live Contract has been executed.

## Evidence and reproducibility

### P5-A completed / execution gates pending

- [x] Branch `feat/p5-final-execution` starts at latest main `3733dbd`; PR #7 is merged and P4 head `c0d3326` is in ancestry. PR #6 remains closed/unmerged; provenance corrected without changing historical AI-log entries.
- [x] v1–v4 pins unchanged; v4 contains no 004. 32/32 tests pass on Node v22.23.4; disposable 001–004 down/re-up evidence captured separately.
- [x] Gate A checked ports 3001/3002 and proved two exact-v1 PIDs share a disposable DB via file handles/inode and cross-instance operations. All 14 previous evidence files remain byte-identical.
- [x] `npm run p5:plan` is non-executing. `npm run p5:preflight` rejects existing final paths/busy ports and never creates the planned demonstration DB. Operator flow and all per-roll/check/S8 requirements prepared in `P5_FINAL_OPERATOR.md`.
- [ ] Student reviews Gate A plan and actual target choices before S0. The proposed DB, final traffic PID and root logs are absent; S0–S8 NOT RUN.
- [ ] Later S8 requires fresh proof of actual v4/v4 PIDs, same intended DB/no legacy writers, bridge installed, zero failure counters, plain CONSISTENT and a verified current backup, then explicit student approval for that DB. Passing Gate A is not approval.

### Final evidence requirements (not produced by Gate A)

- `traffic-log.txt`: **one continuous run**, start on v1, include every migration/restart/rollback, end with `RESULT: zero failed requests`; after all v2 instances are live, exercise `NEW_CLIENTS > 0`.
- `check-log.txt`: label every schema/deploy/rollback step and include full `npm run check` output; separately append each migration down/up rehearsal on a disposable database.
- `MIGRATION.md`: replace this plan's proposed commands and status with commands that actually ran, and cite tagged code versions.
- `AI-LOG.md`: log assistance chronologically (tool, prompt, kept/changed/rejected/by hand); never invent work.
- `SELF_ASSESSMENT_REPORT.md`: one row per six rubric criteria, verifiable evidence, point total equal to ZIP filename, and a frank “What I did not manage.”

## One-command CI is intentionally limited

The GitHub Actions workflow `.github/workflows/migration-ci.yml` runs tests and a fresh DB smoke sequence on PR/push. P2/P3/P4 tests include disposable concurrency, rolling rollback and Contract/recovery fixtures. They do not replace the final continuous demonstration or approve live S8. Remote CI is separate from the recorded local Node 22/tagged evidence; passing it cannot qualify a live target or P5.
