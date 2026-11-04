# IA#2 — Zero-downtime menu price migration

**Status: P1/P2/P3 merged (PR #3/#4/#5); P3 tested on Node 22 and rehearsed from exact v2/v3 tags on a disposable DB. P4 is prepared on a separate agent branch but NOT IMPLEMENTED. P5 and final continuous v1-to-Contract demonstration are NOT RUN.**

P1 evidence: [docs/evidence/p1-validation.txt](docs/evidence/p1-validation.txt) records 10 passing tests and the actual 002 down/re-up CLI rehearsal on a fresh disposable database. Mixed original v1/v2 HTTP tests share one absolute temporary DB path; v2 reads only legacy `price` and derives both response fields from it, including after a v1 reprice leaves `price_vnd` stale. Health reports `version: v2`; `v1` remains the original starter SHA. The existing `v2` tag points to merged P1 commit `dadb816bac9dad5ffcbf098d130d387bbbdd338c`; P2 does not move this tag. P1 left existing seed rows NULL without backfill.

P2 evidence: [docs/evidence/p2-node22-validation.txt](docs/evidence/p2-node22-validation.txt) records 18/18 passing tests on Node v22.23.4 and a disposable 20,000-row CLI rehearsal with two verified v2 instances sharing one absolute DB path. Starting with 10,000 NULL rows and 5,000 disagreeing rows, backfill updated 15,000 rows in 100 batches of 200. Both subsequent checks reported `price_vnd_null=0`, `disagree=0`, and plain `CONSISTENT`; the second backfill updated 0 rows. A separate bounded automated traffic test switched 0 to 0.3 in one PID, observed new-client writes, and finished with `error=0 contract=0 stale=0 unavailable=0`. This is not evidence of the final continuous v1-to-contract demonstration. The live runbook below remains proposed.

P3 evidence: [Node 22 suite](docs/evidence/p3-node22-tests.txt) passed 22/22. The [tagged rehearsal command](docs/evidence/p3-rollback/command.txt) ran on Node v22.23.4 with immutable `v2=dadb816bac9dad5ffcbf098d130d387bbbdd338c` and new `v3=ccd19db7c1cf14d2a5df21f38769c73dd96f27b2`. One absolute temporary SQLite DB was backfilled before v3 started. [Checks](docs/evidence/p3-rollback/checks.txt) show plain `CONSISTENT`, NULL=0 and disagree=0 after backfill and every instance roll. The [traffic log](docs/evidence/p3-rollback/traffic.txt) has one start at share 0.3, six real down/back pairs, and `FINAL ok=59401 error=0 contract=0 stale=0 unavailable=0 rerouted=24`. [Process/source evidence](docs/evidence/p3-rollback/rehearsal.txt) records the same traffic PID 51678 across `v2/v2 → v3/v2 → v3/v3 → v3/v2 → v2/v2 → v2/v3 → v3/v3`, exact source hashes, each health version and cleanup. This short 300-row starting fixture is a development rehearsal, not capacity qualification or the final continuous demonstration. v1/v2 tags were unchanged; v3 remains pinned to the tested code commit while later commits add documentation/evidence.

Individual assignment (CSC13114), deadline **2026-11-05 22:00 ICT**. Original starter commit for immutable `v1`: `2b889bde433190c17744f30d3900d38ab333a756`. Convert `menu_items.price REAL` (thousands of VND, 45.5) to `menu_items.price_vnd INTEGER` (VND, 45500), then drop the old **database** column. The **HTTP** field `price` must remain usable by old clients. `order_items.unit_price` and `POST /orders` totals retain their old thousands-of-VND units.

Read `AGENTS.md` and `docs/AGENT_WORKFLOW.md` before implementing. These are proposed steps; replace plans with actual observed commands and evidence at the end.

## 1. Invariants

1. Both Node instances (`:3001`, `:3002`) always use the same **absolute `DB_PATH`**; roll only one port at a time.
2. Legacy request/response `price` stays numeric on menu GET/list/POST/PATCH. From v2 onward support integer `priceVnd` for new clients; responses expose both. `Math.round(price * 1000)` must agree with `priceVnd`. Validate positive, finite and safe inputs.
3. Both write paths (`POST /menu` and `PATCH /menu/:id`) must update both representations **atomically** in dual-write versions. Keep order item unit price and order totals unchanged.
4. Do not start backfill until all v1 writers are gone. Do not read `price_vnd` until `price_vnd_null=0`, `disagree=0`, and `npm run check` prints plain `CONSISTENT`.
5. Keep one traffic process running from v1 until after the final migration; no `error`, `contract`, `stale`, or `unavailable`. `rerouted` is allowed. Enable new clients only after both instances offer `priceVnd`.
6. Every new schema migration needs `.up.sql`/`.down.sql`, and each down must be **executed and logged on a disposable DB**. The live demo DB must not be destroyed by a down test.
7. Do not drop `price` until **both** instances run v4, which has no SQL reads or writes involving the legacy column.

## 2. Version contracts

### P1 price conversion and minimum VND

On both create and reprice, v2 preserves an accepted legacy `price` unchanged in thousands of VND and writes `price_vnd = Math.round(price * 1000)`. Menu responses continue reading legacy `price` and derive `priceVnd` using that same conversion. For example, `price: 45.1234` remains `45.1234`, with `priceVnd: 45123`; `price: 1.2345` produces `1235` VND. Rounding follows JavaScript `Math.round` on the actual binary floating-point value, rather than exact decimal arithmetic. Order unit prices and totals retain their legacy thousands-of-VND behavior.

The smallest accepted new-client value is `priceVnd: 1` (one VND), stored with legacy `price: 0.001`. Legacy inputs must be finite, positive, at most `100000`, and round to at least one VND: `price: 0.0005` rounds to `1` and is accepted, while `price: 0.0001` rounds to `0` and returns HTTP 400. This intentionally rejects positive sub-VND legacy inputs that round to zero, which v1 previously accepted. A legacy value that rounds upward is preserved in `price`; it is not normalized to `priceVnd / 1000`.

New-client `priceVnd` must be a positive safe integer, at most `100000000` VND, and is converted to legacy `price` by division by 1000. If both fields are supplied, each must be valid and `priceVnd` must equal `Math.round(price * 1000)`; conflicting pairs return HTTP 400. The existing unit and HTTP integration tests cover these rules. This conversion is per-request dual write only; P1 does not backfill existing rows.

| Code tag | DB source for reads | Inserts/reprices | HTTP contract | Safe coexistence |
|---|---|---|---|---|
| **v1** original | `price` | `price` only | Old clients | v2 with new-client traffic off |
| **v2** expand-aware | `price` | Both fields atomically | Both payloads and response fields; derive missing `priceVnd` from `price` before backfill | v1; v3 after backfill |
| **v3** switch reads | `price_vnd` | Both fields atomically | Both clients; derive legacy `price` from integer VND | v2; v4 with sync bridge |
| **v4** new-only | `price_vnd` | `price_vnd` only | Both clients; keep old `price` in JSON, orders unchanged | v3 with sync bridge; v4 after drop |

### P3 read source, rollout gate and rounding

v3 menu GET/list/POST/PATCH responses read only `price_vnd`, return it as `priceVnd`, and derive legacy `price = price_vnd / 1000`. Orders use the same new source converted to thousands for `order_items.unit_price` and totals. Their units and schema do not change. Both create and reprice remain one-statement dual writes; v3 normalizes the legacy stored price to `priceVnd / 1000`, keeping v2 rollback responses aligned with v3 writes. Input validation and the one-VND minimum remain the P1 rules.

Before listening, v3 rejects a DB with NULL, non-integer, out-of-range or disagreeing new prices, or NULL legacy prices. This gate runs on each v3 startup; the operator must also obtain plain `CONSISTENT` after backfill and verify all writers are v2 before the first v3 roll. There is no fallback to legacy reads. No v1 writer may return during mixed v2/v3 operation. Startup qualification does not prevent later unauthorized writes; both running instances must continue atomic dual writes.

Sub-VND legacy precision is rounded when v3 reads it. For example, a v2 write of `price: 45.1234` can still return `45.1234` from v2, while v3 returns `45.123` from `price_vnd: 45123`; both expose the same integer VND. A v3 write stores/returns `45.123` on both versions. Consequently sub-VND inputs can produce rounding differences in mixed-version legacy responses and order totals, although units remain thousands. The traffic generator uses exactly representable half-thousand prices; the zero-failure rehearsal does not establish unchanged sub-VND precision across versions. Tests explicitly cover the rounding behavior.

**Tag policy:** `v1` must point to original SHA, **not** a new planning commit. Tag `v2`/`v3`/`v4` at tested deployable code commits. Commit Contract migration `004` **after** tagging v4; v4 must be deployable while `price` still exists.

## 3. Migration files to implement

| File pair | Up | Down | Gate |
|---|---|---|---|
| Existing `001_init` | Starter schema | Drop starter tables (only on test DB) | Baseline |
| `002_add_price_vnd` | `ALTER TABLE menu_items ADD COLUMN price_vnd INTEGER;` (nullable) | `ALTER TABLE menu_items DROP COLUMN price_vnd;` | Up with v1/v1; down before any dependent code is running |
| `003_sync_legacy_price` | Add guarded AFTER INSERT/UPDATE triggers to mirror `price_vnd → price` during mixed v3/v4 | Drop those triggers | Install before v4; remove only after all instances return to v3 |
| `004_drop_price` | Drop `003` triggers, then `ALTER TABLE menu_items DROP COLUMN price;` in the same schema migration transaction | Recovery: add legacy REAL `price`, reconstruct `price_vnd / 1000.0`, restore bridge if needed | Up only with v4/v4; down is controlled recovery before any v3 deployment |

The sync bridge is included so `npm run check` continues to report consistency while v4 writes only the new column but `price` still exists. The agent must prove that the SQLite trigger statements and their downs work with the actual schema and tests.

## 4. Required step matrix and undo commands

The command `roll_one PORT TAG SLOT` is defined in section 5. Commands shown are **proposed**, not evidence that they ran.

| Step | Schema **after** step | Running instances A / B | Exact undo operation / command | Earlier versions safe on that schema |
|---|---|---|---|---|
| **S0 Baseline**: run `001`, seed 20,000 rows, start traffic | Only `price` | v1 / v1 | Recreate disposable test DB; only test `001.down` with `DB_PATH="$TEST_DB" npm run migrate:down` | v1 |
| **S1 Expand**: apply `002` | `price` + nullable `price_vnd` | v1 / v1 | `DB_PATH="$DB_PATH" npm run migrate:down` while `002` is last applied and **before any v2 deploy** | v1 |
| **S2 v2 rollout**: A then B | Both, old rows may have NULL new values | v2 / v1 → v2 / v2 | With NEW_CLIENTS=0: `roll_one 3002 v1 B` then `roll_one 3001 v1 A` | v1 for old clients; v2 |
| **S3 Backfill**: run batched script; enable new clients in same traffic process | Both; 0 NULL and 0 disagree | v2 / v2 | Code can keep reading `price`; to return to v1, disable new clients first, roll both to v1, and only then apply `002.down` | v2; v1 only without new clients or v3 readers |
| **S4 v3 rollout**: A then B, read new column | Both synchronized | v3 / v2 → v3 / v3 | `roll_one 3002 v2 B` then `roll_one 3001 v2 A`; check CONSISTENT | v2, v3 (not v1) |
| **S5 Required live rollback**: v3→v2→v3, one instance at a time | Both synchronized | v3/v3 → v3/v2 → v2/v2 → v2/v3 → v3/v3 | `roll_one 3002 v2 B`; `roll_one 3001 v2 A`; `roll_one 3001 v3 A`; `roll_one 3002 v3 B` | v2, v3 |
| **S6 Bridge**: apply `003` before v4 | Both + new→old triggers | v3 / v3 | `DB_PATH="$DB_PATH" npm run migrate:down` while v3/v3 and `003` is last | v2, v3, v4 |
| **S7 v4 rollout**: A then B | Both + bridge; consistent | v4 / v3 → v4 / v4 | `roll_one 3002 v3 B` then `roll_one 3001 v3 A`; only after v3/v3 may `003.down` run | v3, v4; v2 only while bridge guarantees legacy reads |
| **S8 Contract**: backup, check v4/v4, apply `004` | Only `price_vnd` | v4 / v4 | **No safe code-only rollback**. Recover schema **first** via `DB_PATH="$DB_PATH" npm run migrate:down` with `004` last, verify old column and CONSISTENT, only then consider v3 | v4 only until controlled recovery |

**Operational point of no return: S8, dropping the legacy column.** Earlier code cannot simply restart against the contracted schema. A `004.down.sql` may reconstruct legacy prices, but that is a separately verified **schema recovery**, not a one-command zero-downtime code rollback. State this distinction in the final report.

**Migration runner trap:** the starter's `npm run migrate` applies **all pending `*.up.sql` in its checkout**. Running it from the final tree at S1 could drop `price` too early. Apply from a release worktree containing only the migrations released at that stage, or implement a tested explicit target-version option before the real run.

## 5. Operator runbook (to verify and adapt)

Use one controlling Bash shell so process IDs are tracked. The following worktrees cannot be created until their corresponding tags exist.

```bash
git rev-parse v1^{}  # must already be 2b889bde433190c17744f30d3900d38ab333a756; do not retag
git worktree add ../ia2-v1 v1
git worktree add ../ia2-v2 v2
git worktree add ../ia2-v3 v3
git worktree add ../ia2-v4 v4

export DB_PATH="$PWD/data/app.db"
DB_PATH="$DB_PATH" npm run migrate
DB_PATH="$DB_PATH" npm run seed
npm test

(cd ../ia2-v1 && PORT=3001 DB_PATH="$DB_PATH" npm start) &
PID_A=$!
(cd ../ia2-v1 && PORT=3002 DB_PATH="$DB_PATH" npm start) &
PID_B=$!
```

Graceful rolling helper (only in that same shell, after recording `PID_A`/`PID_B`):

```bash
roll_one() {
  local port="$1" tag="$2" slot="$3" old_pid
  if [ "$slot" = A ]; then old_pid="$PID_A"; else old_pid="$PID_B"; fi
  kill -TERM "$old_pid"
  wait "$old_pid"
  (cd "../ia2-$tag" && PORT="$port" DB_PATH="$DB_PATH" npm start) &
  if [ "$slot" = A ]; then PID_A=$!; else PID_B=$!; fi
}
```

After each roll, wait for that port's `/health` response and **verify its actual version** before touching the other port. Commands in S5 explicitly require the rollback **while the same traffic process is still running**.

### Traffic process and new clients

`NEW_CLIENTS` remains the startup share when no file is configured. To change share without restarting, set `NEW_CLIENTS_FILE` to a small file containing a JSON number from 0 to 1. The file takes precedence over `NEW_CLIENTS` and is polled at most once every 250 ms between traffic operations. Every accepted change is timestamped as `CLIENT_MIX old -> new` in the same log. Each positive initial share or transition requires both target `/health` responses to report healthy `v2` or `v3`; a zero share does not, so the continuous process can start on v1. Backfill retains its stricter v2/v2 gate.

Invalid/missing startup files fail startup. Invalid, missing, or rejected runtime updates are logged and retain the last accepted share; they do not reset counters. Replace the file atomically on the same filesystem. Before a later return to v1, set zero, observe the accepted log entry and allow in-flight requests to drain. Keep both instances on v2 while backfilling and initially enabling new clients; after qualification, mixed v2/v3 and v3/v3 can serve them. Health checks cannot prove that all writers have been identified or that both servers use the intended DB; the operator must confirm their process/version and identical absolute `DB_PATH`.

Proposed operator commands (NOT executed against the live demonstration DB):

```bash
export TARGETS=http://localhost:3001,http://localhost:3002
export NEW_CLIENTS_FILE="$PWD/data/client-share.json"
printf '0\n' > "$NEW_CLIENTS_FILE"
NEW_CLIENTS=0 npm run traffic
```

In a separate controlling shell, only after both instances are verified v2 and backfill/check have completed:

```bash
printf '0.3\n' > "$NEW_CLIENTS_FILE.next"
mv "$NEW_CLIENTS_FILE.next" "$NEW_CLIENTS_FILE"
```

Both shells must use the same absolute `NEW_CLIENTS_FILE`. Keep the one traffic process running; the eventual final run must finish after S8 with its actual result. All original request branches, assertions, failure counters and final result logic remain intact.

### P2 batched backfill

`scripts/backfill.js` requires an explicit absolute `DB_PATH` and exactly two distinct instance origins in `TARGETS` (default ports 3001 and 3002). Before opening the database, it checks that both report healthy `v2`. Do not run while any v1 writer remains, and do not roll versions during backfill. No v3/v4 code or new schema migration is included in P2.

Each batch uses `BEGIN IMMEDIATE`, reads at most `BATCH_SIZE` rows in ID order and reconciles both NULL and disagreeing `price_vnd` values from the current legacy `price`. It validates the P1 conversion and updates only the new column, never legacy prices or order units. Selection and writes share the same write lock, so an acknowledged concurrent v2 update cannot be replaced using a previously read value. Correct rows are scanned but never updated. Defaults are 200 rows (allowed 1–1000) and 10 ms between commits (`BATCH_DELAY_MS`, allowed 0–60000); logging, delay and callbacks occur outside the transaction.

The scan restarts from the beginning on rerun; correct rows are skipped, so no checkpoint file is needed. SIGINT/SIGTERM stop between committed batches (exit 130/143). A crash or failed batch rolls back that transaction while earlier commits remain. Invalid historical prices (including legacy NULL or values rounding to zero), unsafe conversions, or JavaScript/SQLite rounding disagreement fail the batch with its item ID for explicit repair. Lock contention waits using the existing 5-second SQLite busy timeout; a timeout fails safely and can be retried. Run `check` after completion; `COMPLETE` is a scan summary, not a substitute for the consistency check.

Proposed commands after operator confirmation of v2/v2, using the same absolute DB path as both processes:

```bash
DB_PATH="$DB_PATH" BATCH_SIZE=200 BATCH_DELAY_MS=10 npm run backfill
DB_PATH="$DB_PATH" npm run migrate:status
DB_PATH="$DB_PATH" npm run check
DB_PATH="$DB_PATH" npm run backfill
DB_PATH="$DB_PATH" npm run check
```

The second run must report `updated:0`; check must show zero NULLs/disagreements and plain `CONSISTENT`. Reconciliation of stale values uses legacy price as authority; it is not a code rollback. Returning to v1 can make new values stale again, so reconcile again only after restoring v2/v2. Existing backups and the P1 schema/code rollback gates still apply.

### P3 disposable development rehearsal

`npm run rehearse:p3` is a development-only harness. It creates a fresh temporary DB, extracts exact v2/v3 application source from their tags into temporary release directories, logs commit/file fingerprints, starts v2 instances one at a time on ephemeral ports, backfills, and requires plain `CONSISTENT` before v3. It never uses a supplied live `DB_PATH`. The default `V3_REF` is `v3`; automated tests use a fingerprinted WORKTREE snapshot to validate changes before tagging. Existing v1/v2 tags are asserted against their pinned commits and never moved.

One traffic process with `NEW_CLIENTS=0.3` spans all states:

`v2/v2 → v3/v2 → v3/v3 → v3/v2 → v2/v2 → v2/v3 → v3/v3`.

Only one instance stops at a time. The harness waits for actual traffic `down`/`back` events and the replacement's health/version before proceeding. It executes labeled `npm run migrate:status` and `npm run check` after backfill, at baseline, and after every roll (including before/after rollback), and asserts zero failure counters with a single traffic start/PID. No schema down is run for code rollback. No new schema migration is part of P3; existing 002 down/re-up remains a separate automated disposable test.

Proposed replay command, with an unused output directory (existing evidence is never overwritten):

```bash
V3_REF=v3 P3_EVIDENCE_DIR=/absolute/new/evidence-directory npm run rehearse:p3
```

Review `rehearsal.txt` (commands, process identity, source fingerprints and checks), `checks.txt` (labeled schema/consistency output), and `traffic.txt` (unaltered traffic output). The temporary instances/DB are cleaned up afterward. This bounded rehearsal starts at v2 and does not qualify the final continuous v1-to-Contract demonstration or a live target.

### Data and migration-down checks

Append `npm run check` after **every step** and after **each individual instance roll**, with visible labels:

```bash
{
  printf '\n=== S3 Backfill complete ===\n'
  DB_PATH="$DB_PATH" npm run migrate:status
  DB_PATH="$DB_PATH" npm run check
} >> check-log.txt 2>&1
```

Before backfill the check may report `CONSISTENT, but ... rows have no price_vnd yet`. After S3 it must be plain `CONSISTENT`. For **each** migration, initialize a separate throwaway `TEST_DB` at the target version, then log `DB_PATH="$TEST_DB" npm run migrate:down`, a check, an up migration, and a second check. Do **not** naively copy a running SQLite WAL DB file; use a fresh test DB or a proper database backup mechanism.

### Tests the coding agent must add

- Both old and new menu payloads on **create and PATCH**, including validation and atomic dual writes.
- Legacy `price` and new `priceVnd` in individual, list and write responses; rounding/precision and mixed-version behavior.
- `/orders` and `order_items.unit_price` remain in **thousands**.
- Resumable, short-batch backfill under concurrent writes and rerun.
- Mixed v1/v2, v2/v3, v3/v4 (with bridge), rollback v3→v2→v3.
- Final contract: old HTTP clients work after database `price` is gone.
- All migrations run forward and `.down.sql` runs on a disposable DB.
- Update starter `test/app.test.js` fixture and `scripts/seed.js` to support the final schema (both currently insert into legacy `price`).

## 6. Evidence and submission map

| Rubric criterion | Max | Required evidence |
|---|---:|---|
| Plan | 20 | Actual S0–S8 state/commands/compatibility in this English file, matching Git tags |
| Expand and dual write | 20 | `002` files, v2 code/tests for POST and PATCH, actual `migrate:down` logs |
| Backfill | 15 | `scripts/backfill.js`, short transactions, restart safety, immediate plain CONSISTENT |
| Zero failed requests | 20 | **One continuous** `traffic-log.txt`, down/back lines, NEW_CLIENTS > 0 after v2, final zero failed |
| The way back | 15 | Real v3→v2→v3 rollback **under traffic**, consistent before/after |
| Contract | 10 | v4 has no legacy-column SQL; `004` runs after v4/v4; old response `price` survives drop |

Deliverables at ZIP root (including repository's `.git`): tags `v1`...`v4`, all `.up/.down.sql`, batch backfill script, updated `MIGRATION.md`, `traffic-log.txt`, `check-log.txt`, English `AI-LOG.md` and English `SELF_ASSESSMENT_REPORT.md`. The report must have **one scored row per criterion**, evidence, a realistic total, “What I did not manage” and “What I would do differently.” Name the ZIP `<StudentID>_<total>.zip` and submit from `<StudentID>@student.hcmus.edu.vn`. GitHub's normal “Download ZIP” omits `.git` and is **not** suitable.

**CI caveat:** `.github/workflows/migration-ci.yml` performs automated tests (including bounded disposable P2 concurrency and P3 rolling fixtures) and disposable-DB smoke checks. Passing it does not prove the final continuous live traffic run or live-target rollback. P3's tagged development rehearsal is separate evidence; the final v1-to-Contract run remains NOT RUN.
