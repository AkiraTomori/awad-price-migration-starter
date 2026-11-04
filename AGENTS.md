# Coding-Agent Instructions — CSC13114 IA#2

This repository is an individual assignment for a zero-downtime price-column migration. Follow [MIGRATION.md](MIGRATION.md) as the proposed rollout design and [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) for phase-level work. Read [docs/CONCEPTS.md](docs/CONCEPTS.md) for the concepts behind each phase.

## Hard constraints

- Preserve a `v1` tag pointing to the **original starter commit**, `2b889bde433190c17744f30d3900d38ab333a756`. Do not retag `v1` to this planning PR or a modified baseline.
- Code tags `v2`, `v3`, `v4` must identify real deployable application versions. Tags are evidence; never move them after a recorded traffic run.
- Keep HTTP `price` (thousands of VND) for old clients across every route. Accept and return `priceVnd` (integer VND) for new clients from v2 onward.
- `order_items.unit_price` and `POST /orders` total remain in their original thousands-of-VND unit. Do not migrate the order-item column.
- Never drop `menu_items.price` before **both** instances run a version that neither queries nor writes that column.
- Never deploy two new instances simultaneously. Use a single absolute `DB_PATH` pointing to the shared SQLite file and restart one instance at a time.
- Every new schema migration requires a matching `.up.sql` and `.down.sql`. Prove each down migration on a disposable database; **never** use a destructive down against the live demonstration DB.
- Preserve integrity of the starter traffic checks. Do not omit requests, weaken assertions, reset counters, or fabricate `traffic-log.txt` / `check-log.txt`.
- Do not represent planned commands as executed evidence. If a check was not actually run, label it `NOT RUN`.
- An agent may implement code and tests, but the student reviews it and is responsible for running, explaining, and submitting it.

## Small autonomous tasks, in order

1. **P1 — Expand + v2:** add nullable `price_vnd` migration; implement both create and re-price write paths, support both client payloads, return both response fields; add unit and integration tests.
2. **P2 — Backfill + traffic switch:** write short-transaction, batch-based, idempotent backfill. Implement a runtime, logged new-client traffic-share switch without restarting the single traffic process. Verify `CONSISTENT` after backfill.
3. **P3 — v3 + rollback test:** move reads to `price_vnd` but keep dual writes; test mixed v2/v3; perform and log rolling v3 → v2 → v3 under traffic, checking consistency before and after.
4. **P4 — v4 + contract:** implement new-column-only code while preserving old HTTP outputs and order totals; install a reversible compatibility synchronization bridge before mixed v3/v4; contract `price` only after all instances run v4.
5. **P5 — evidence and submission:** capture a complete continuous traffic run, each step's labeled checks, each migration-down rehearsal; finish `MIGRATION.md`, `AI-LOG.md`, `SELF_ASSESSMENT_REPORT.md`, and the repository ZIP containing `.git`.

## Required verification at every phase

- `npm test`, plus tests for new write/read paths and old/new payloads as applicable.
- `npm run migrate:status` and `npm run check` against the correct shared database.
- An additional `migrate:down` and re-up test on a disposable copy for each schema migration; record actual commands/output.
- Inspect zero-failure counters (`error`, `contract`, `stale`, `unavailable`) and visible rolling `down`/`back` lines.
- Verify the active Git tag/worktree and schema match the compatibility matrix in `MIGRATION.md`.

## Stop conditions / review gates

- Stop on failed tests, unexpected `INCONSISTENT`, missing rollback path, missing evidence, or a nonzero traffic-failure counter; diagnose before proceeding.
- Before destructive contract, confirm both running instance versions and a verified backup. Request the student's explicit go-ahead for that phase.
- Do not automatically merge a PR, push deployment, submit the assignment, or claim a score. Present a phase summary with changed files, executed commands, evidence, and outstanding risks.

GitHub Actions in this repository only runs lightweight CI smoke checks; it is **not** an autonomous AI-agent executor and **not** proof of zero downtime.
