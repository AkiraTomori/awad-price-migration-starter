# P4 Coding-Agent handoff — Bridge → v4 → Contract rehearsal

**Status (2026-11-04):** PR #5 (P3) is merged into `main` at `308c92db6ff7aa3b958519d102467119ee8869e5`. Work on **`feat/p4-bridge-v4-contract`**, which was created from that merged `main`. Existing `v1`, `v2`, `v3` tags are immutable; `v3` is `ccd19db7c1cf14d2a5df21f38769c73dd96f27b2`.

This is a coding task brief, **not evidence of execution**. The deadline for the entire assignment is 2026-11-05 at 22:00 ICT.

**Implementation follow-up (2026-11-04):** P4 is implemented on this branch and awaits student review. v4 code is tagged `51669379446f8f34473a90104ea939284335e9f2`; 004 was added later at `29153bd8eb2ecaf44cf38338f17fd60e4c1d9a3e`. See [28/28 Node 22 verification](evidence/p4-node22-validation.txt), [tagged rolling evidence](evidence/p4-rollback/rehearsal.txt) and [disposable schema/HTTP recovery proof](evidence/p4-contract/contract.txt). This follow-up records execution; the original brief below remains the scope/review contract. No live S8 or final continuous demonstration was executed.

## Copy-paste task for Coding-Agent

> Read `AGENTS.md`, `MIGRATION.md`, `docs/AGENT_WORKFLOW.md`, and this file first. Implement **P4 only** on `feat/p4-bridge-v4-contract`. Add automated tests and honest evidence, update the English project documentation and `AI-LOG.md`, and open a PR for review. Stop without merging, applying migrations to a live database, executing the final v1→Contract demonstration, or submitting the assignment. Never change the `v1`/`v2`/`v3` tags. Run the entire test suite under Node.js 22.

## Required engineering sequence

### P4.1 — Reversible bridge (migration 003)

- Add `migrations/003_sync_legacy_price.up.sql` and `migrations/003_sync_legacy_price.down.sql`.
- The bridge keeps `price = price_vnd / 1000.0` while v4 writes only `price_vnd` and v3 still dual writes. Account for both **INSERT** and **UPDATE**, and verify actual SQLite trigger behavior and any recursion implications.
- On a disposable DB, prove `003.up → 003.down → 003.up`. No failed requests or inconsistent DB rows when v3/v4 coexist.
- Install 003 only when data is already backfilled and both running writers are v3.

### P4.2 — v4 code, rolling and rollback

- v4 SQL selects, inserts and updates **`price_vnd` only**, with no SQL reference to `menu_items.price`. Do not accidentally depend on legacy `price` in the v4 startup gate or its post-Contract check.
- Keep both public JSON fields: `priceVnd` (integer VND) and `price = priceVnd / 1000` (thousands of VND). Accept both old/new menu payloads for create and PATCH.
- `POST /orders` totals and `order_items.unit_price` continue in thousands of VND.
- Test both ports on one absolute DB path: `v3/v3 → v4/v3 → v4/v4 → v4/v3 → v3/v3 → v3/v4 → v4/v4`, with traffic running continuously **for that disposable rehearsal**. Check `CONSISTENT` after each roll and zero `error`, `contract`, `stale`, `unavailable` counters. Keep request assertions unchanged.
- Tag the fully tested deployable **v4 code commit before introducing 004**. Make `v4` immutable and ensure the tag checkout itself can run safely against a pre-Contract DB.

### P4.3 — Contract (migration 004), disposable verification only

- Add `migrations/004_drop_price.up.sql` and `migrations/004_drop_price.down.sql` in a later commit than the v4 tag.
- Up: remove the temporary 003 triggers before dropping legacy `price`. Only valid when both running instances are v4.
- Down: controlled **schema recovery**, reconstruct legacy `price` from `price_vnd` and restore the bridge if needed. This is **not** a safe one-step/code-only rollback to v3.
- Execute `004.up → 004.down → 004.up` and validate preserved menu/order rows, schema, old-client HTTP responses, and consistency on a **disposable** database.
- The existing migration runner applies **all pending** `*.up.sql` files. Prove that the final runbook stages 003 and 004 rather than accidentally applying 004 early.
- Update seed fixtures, `scripts/check.js`, tests, and traffic readiness as necessary so they operate on both pre- and post-Contract schemas without changing the starter's request semantics.

## Review gate — STOP here

Do **not** apply `004.up` to any live demonstration DB, perform final traffic run, merge the P4 PR, or submit a ZIP until a student explicitly approves. **S8 (the database drop of `price`) is the named operational point of no return.** After S8, v3 cannot restart until a controlled schema recovery has completed.

The P4 PR must present:

1. Precise v4 tag and implementation/contract commit SHAs; unchanged v1–v3 tags.
2. Full Node 22 test results and reproducible disposable `003/004` up/down SQL evidence.
3. One bounded **v3/v4** rolling/rollback traffic PID, four zero failure counters, and labeled `CONSISTENT` checks.
4. Validation that legacy HTTP clients still work after 004, with unchanged order units.
5. Risks, limitations and explicit distinction from P5's **one continuous v1→Contract** traffic log and per-step check log.

## After P4 approval: P5 (separate task)

Stage the final clean, continuous `v1 → 002 → v2 → backfill → v3 → v2 → v3 → 003 → v4 → 004` demonstration with a single traffic process, checks after every step, and down/up rehearsals on disposable DBs. Prepare `traffic-log.txt`, `check-log.txt`, `SELF_ASSESSMENT_REPORT.md` (English), updated `MIGRATION.md`/`AI-LOG.md`, all migration pairs, immutable tags, and a ZIP **including `.git`**. Never invent evidence.
