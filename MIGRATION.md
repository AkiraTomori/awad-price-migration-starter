# IA#2 — Zero-downtime menu price migration

Student: **23127379 — Thái Minh Huy**. Deadline: **2026-11-05 22:00 ICT**.

**Final execution: S0–S8 completed on 2026-11-04.** Migration 004 ran once, after explicit approval and fresh verified v4/v4/backup gates. One original traffic PID 29850 spanned baseline, migrations, backfill, rolling deploy/rollback and Contract, then ended once at 19:07:43 ICT:

```text
4165.8s FINAL ok=35309724 error=0 contract=0 stale=0 unavailable=0 rerouted=101
RESULT: zero failed requests
```

[Final S8 facts](docs/P5_S8_RESULT.md), [root traffic](traffic-log.txt), [labeled checks](check-log.txt), [actual deployment events](docs/evidence/p5-b-execution/events.jsonl), and [actual Contract/HTTP events](docs/evidence/p5-s8-completion/events.jsonl) are retained unchanged. The final saved DB verification is integrity=ok, FK check empty, columns `id,name,price_vnd`, migrations 001–004 and plain CONSISTENT. This finalization does not rerun the demonstration or modify its DB/logs. Earlier pending-S8 packets under docs/evidence are immutable historical snapshots, not current status.

Final validation: Node.js **v22.23.4**, current suite **32/32**, controller/backup **4/4**. Default `npm test` on the preserved workspace also discovers historical release-worktree tests and passed **95/95**. [Actual final verification](docs/evidence/p5-c-canonical-verification/) retains both results and the prior failed fixture attempts are preserved separately. [Student-approved self-assessment](SELF_ASSESSMENT_REPORT.md): **98/100**. P5-C authorizes conditional PR #9 integration and packaging; exact merge/CI/archive outcomes belong to the PR and the independently produced ZIP verification receipt, not a prediction of those future actions. No automated Classwork submission.

## Original and target schema

The starter stores `menu_items.price REAL` in thousands of VND: 45.5 represents 45500 VND. The target stores `menu_items.price_vnd INTEGER` in VND and removes only the legacy **DB** column. HTTP `price` remains in thousands for old clients; `priceVnd` is integer VND. `order_items.unit_price` remains REAL in thousands, and POST /orders totals retain that unit throughout. No order-column migration exists.

## Immutable deployed versions

| Tag | Exact commit | Read source | Write paths | Schema compatibility |
|---|---|---|---|---|
| v1 | `2b889bde433190c17744f30d3900d38ab333a756` | legacy price | legacy only | 001 or expanded 002; old clients only |
| v2 | `dadb816bac9dad5ffcbf098d130d387bbbdd338c` | legacy price | POST/PATCH atomic dual write | 002; mixed v1 only at share0; v3 only after backfill |
| v3 | `ccd19db7c1cf14d2a5df21f38769c73dd96f27b2` | price_vnd | POST/PATCH atomic dual write | qualified 002/003; v4 coexistence needs 003 |
| v4 | `51669379446f8f34473a90104ea939284335e9f2` | price_vnd | new column only | 003 bridge before drop; 004 after drop |

v4 contains 001–003, not 004. Contract files were committed later at `29153bd8eb2ecaf44cf38338f17fd60e4c1d9a3e`. All four tags identify real deployed code and remain unchanged. Main includes P4 through PR #7; PR #6's closed/unmerged metadata is not the integration proof. P5-A merged through PR #8; final evidence/finalization is PR #9.

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

## 3. Implemented migration pairs

| File pair | Up | Down | Gate |
|---|---|---|---|
| Existing `001_init` | Starter schema | Drop starter tables (only on test DB) | Baseline |
| `002_add_price_vnd` | `ALTER TABLE menu_items ADD COLUMN price_vnd INTEGER;` (nullable) | `ALTER TABLE menu_items DROP COLUMN price_vnd;` | Up with v1/v1; down before any dependent code is running |
| `003_sync_legacy_price` | Add guarded AFTER INSERT/UPDATE triggers to mirror `price_vnd → price` during mixed v3/v4 | Drop those triggers | Install before v4; remove only after all instances return to v3 |
| `004_drop_price` | Drop `003` triggers, then `ALTER TABLE menu_items DROP COLUMN price;` in the same schema migration transaction | Recovery: add legacy REAL `price`, reconstruct `price_vnd / 1000.0`, restore bridge if needed | Up only with v4/v4; down is controlled recovery before any v3 deployment |

The sync bridge is included so `npm run check` continues to report consistency while v4 writes only the new column but `price` still exists. Actual 003 trigger/down tests and separate 001–004 recovery rehearsals are recorded in the linked disposable evidence.

## 4. Executed steps and exact undo operations

All forward states below actually occurred on the final run. Undo commands describe **conditional recovery**, not an assertion that every undo ran on the final DB. The required S5 code rollback did run there under the same traffic PID. Schema downs/re-ups ran only on disposable databases. `DB_PATH` means the explicitly reviewed absolute target; `TEST_DB` means a separate disposable file. Never execute these recovery commands against the completed demonstration as a rehearsal.

`roll_one PORT TAG SLOT` and `set_share SHARE` are defined in section 5. Before each roll, verify the other listener/DB identity, then wait for real down/back, health and consistency before changing any other instance. Each individual forward action has a label in root check-log.txt.

| Executed step | Schema after step | Actual A / B | Exact conditional undo command | Earlier safe versions |
|---|---|---|---|---|
| S0: `--to 001_init`, seed exactly20000, start v1/v1 and traffic share0 | legacy price only | v1/v1 | Test only: `DB_PATH="$TEST_DB" npm run migrate:down` with001 last; destroys tables. Preserve final DB. | v1 |
| S1: `--to 002_add_price_vnd` | price + nullable price_vnd | v1/v1 | Before dependent code: `DB_PATH="$DB_PATH" npm run migrate:down` with002 last | v1 |
| S2-A: roll A to v2 | both, incomplete new values | v2/v1 | `roll_one 3001 v1 A` with share0 | v1, v2 |
| S2-B: roll B to v2 | both, incomplete new values | v2/v2 | `roll_one 3002 v1 B; roll_one 3001 v1 A` with share0 | v1, v2 |
| S3: batched backfill, rerun updated0 | both, NULL/disagree0 | v2/v2 | Keep v2 legacy reads. Full retreat after share0: `set_share 0; roll_one 3002 v1 B; roll_one 3001 v1 A; DB_PATH="$DB_PATH" npm run migrate:down` with002 last | v2; v1 only after disabling new clients and with no v3 readers |
| S3 clients: share0→0.3 in same PID | both synchronized | v2/v2 | `set_share 0` then observe accepted transition/drain | v2; v1 only after share0 |
| S4-A: roll A to v3 | both synchronized | v3/v2 | `roll_one 3001 v2 A` | v2,v3 |
| S4-B: roll B to v3 | both synchronized | v3/v3 | `roll_one 3002 v2 B; roll_one 3001 v2 A` | v2,v3 |
| S5 rollback B | both synchronized | v3/v2 | `roll_one 3002 v3 B` | v2,v3 |
| S5 rollback A | both synchronized | v2/v2 | `roll_one 3001 v3 A; roll_one 3002 v3 B` | v2,v3 |
| S5 restore B | both synchronized | v2/v3 | `roll_one 3002 v2 B` | v2,v3 |
| S5 restore A | both synchronized | v3/v3 | `roll_one 3001 v2 A; roll_one 3002 v2 B` | v2,v3 |
| S6: `--to 003_sync_legacy_price` | both + new→old bridge | v3/v3 | `DB_PATH="$DB_PATH" npm run migrate:down` with003 last and no v4 writer | v2,v3; v4 with bridge |
| S7-A: roll A to v4 | both + bridge | v4/v3 | `roll_one 3001 v3 A` | v3,v4; v2 while bridge preserves legacy values |
| S7-B: roll B to v4 | both + bridge | v4/v4 | `roll_one 3002 v3 B; roll_one 3001 v3 A` before any003 down | v3,v4 with bridge |
| S8: verified backup/approval, `--to 004_drop_price` | price_vnd only; bridge removed | v4/v4 | **No code-only rollback.** Controlled schema recovery: `DB_PATH="$DB_PATH" npm run migrate:down` with004 last, then `npm run migrate:status` and `npm run check` under same DB_PATH; verify reconstructed price + bridge BEFORE any v3 restart | v4 only until schema recovered |

**Point of no return for code-only rollback: S8.** The legacy column/bridge is gone; restarting v3 directly would fail. `004.down.sql` reconstructs legacy price from integer VND and restores both triggers; it cannot restore pre-rounding precision. This is controlled schema recovery, not a promise of a zero-downtime one-command rollback. A full pre-Contract backup restore would also discard subsequent writes unless separately reconciled.

Actual final-run commands used the reviewed current migration runner with explicit targets001,002,003,004. Bare `npm run migrate` applies all pending migrations and must never be used for an intermediate staged rollout. Historical v1–v3 runners lack `--to`.

## 5. Reproduction reference — not commands to run on the completed DB

The exact executed controller/events are the evidence. For a future separately approved **fresh** fixture, the prepared flow is [P5_FINAL_OPERATOR.md](docs/P5_FINAL_OPERATOR.md); fresh-run guards deliberately reject completed logs/DBs. Set one absolute shared DB_PATH, create detached worktrees from immutable tags, use Node22, and keep one traffic PID from v1 through004. Never reuse or clear the final evidence to pass preflight.

The conditional undo notation above uses these shell helpers. This reference block was not retroactively executed as the original control shell. `PID_A`, `PID_B`, `REPO`, `RUN_DIR`, `DB_PATH` and `NEW_CLIENTS_FILE` must identify a separately reviewed run. Use verified Node22 in PATH.

```bash
set_share() {
  printf '%s\n' "$1" > "$NEW_CLIENTS_FILE.next"
  mv "$NEW_CLIENTS_FILE.next" "$NEW_CLIENTS_FILE"
  # Wait for accepted CLIENT_MIX in the SAME original traffic log; drain requests.
}
roll_one() {
  local port="$1" tag="$2" slot="$3" old_pid
  # Verify the other instance's health, PID, pinned cwd and shared DB handle first.
  if [ "$slot" = A ]; then old_pid="$PID_A"; else old_pid="$PID_B"; fi
  kill -TERM "$old_pid"
  wait "$old_pid"
  (cd "$RUN_DIR/releases/$tag" && PORT="$port" DB_PATH="$DB_PATH" exec node src/server.js) &
  if [ "$slot" = A ]; then PID_A=$!; else PID_B=$!; fi
  # Wait for actual down/back, verify PID/cwd/SHA/listener/DB handles and health.
  # Append labeled migrate:status and check output; stop before another roll if bad.
}
```

### Actual traffic, rollback and backup

S0 started at 17:58:18 ICT with 20000 seeded rows, v1/v1 and share0. All ten deliberate instance rolls were separate: A2,B2,A3,B3,B2,A2,B3,A3,A4,B4. S5 traversed v3/v3→v3/v2→v2/v2→v2/v3→v3/v3; atomic dual writes and the completed backfill keep v2 legacy reads aligned with v3 new reads. v1 is unsafe once new-column readers/clients depend on synchronized data.

After both v2 writers were verified, S3 backfill used207 batches, scanned41078 rows and updated38683. Rerun scanned41666 and updated0. These counts grew under traffic; they are not a static seed-size claim. Share0→0.3 was accepted in the original PID at traffic-log line28. From S3 onward every data check was plain CONSISTENT. Ten deliberate down/back pairs plus sixteen transient route failures during the wait produced26 pairs total and101 reroutes. All four final request-failure counters are0. Extra TimeoutError/ECONNRESET causes are unestablished; this does not measure a latency SLO or prove no transport interruption.

Before004, actual A/B PIDs32012/32117 both matched pinned v4, ports3001/3002 and physical DB device16777231/inode28975812. Only those DB holders were found. A new SQLite-backup-API copy of one pinned read snapshot passed integrity/FK/schema/ordered-content/count verification while writers continued. [Backup packet](docs/evidence/p5-s8-approved-precontract/s8-packet.json) records the exact absolute paths/counts/restore location. Backup SHA256 `14d86de21c0a91ff7400166dfcfc9d2aaf361f490c89fa8734c8387cc41e5070`, verified12:06:19 UTC. The backup remains local outside the submission ZIP; its verification evidence is included. The student then authorized004 explicitly; it exited0. Both v4 processes continued without restart. Both HTTP payloads/routes/orders passed after drop, then the same generator received one SIGINT and emitted the original final result.

### Observed anomalies retained honestly

- S2-A/S2-B raw check exit1 with28/11 disagreements: v1 legacy-only reprices made filled new values stale. Share stayed0, both readers used legacy, and no request failures occurred. S3 reconciled only after all v1 writers retired. No checker output was weakened or relabeled as passing.
- S0 controller demanded a start-log line too early. Detached processes continued; reattachment used the same PID29850. No restart/reset. Non-child exit status is recorded unavailable rather than fabricated0.
- After004, the wrapper expected disagree=0 although the checker properly omitted an inapplicable metric and exited0 CONSISTENT. Diagnosed continuation skipped migration and finished with the same traffic PID. Raw failure and recovery remain in S8 events.
- Initial P5-C preflight tests assumed an evidence-free real repo, then used mismatched /var and /private/var fixture paths. Failed outputs remain under p5-c-verification and p5-c-final-verification. The final fix creates its own Git fixture and canonicalizes only existing roots with realpathSync; production guards are unchanged. Current32 tests and controller4 now pass.

### Traffic process and new clients

`NEW_CLIENTS` remains the startup share when no file is configured. To change share without restarting, set `NEW_CLIENTS_FILE` to a small file containing a JSON number from 0 to 1. The file takes precedence over `NEW_CLIENTS` and is polled at most once every 250 ms between traffic operations. Every accepted change is timestamped as `CLIENT_MIX old -> new` in the same log. Each positive initial share or transition requires both target `/health` responses to report healthy `v2`, `v3` or `v4`; a zero share does not, so the continuous process can start on v1. Backfill retains its stricter v2/v2 gate. Version acceptance alone does not qualify a mixed pair: v3/v4 still requires bridge 003.

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

Both shells must use the same absolute `NEW_CLIENTS_FILE`. Keep the one traffic process running; the recorded final run finished after S8 with its actual result. All original request branches, assertions, failure counters and final result logic remain intact.

### P2 batched backfill

`scripts/backfill.js` requires an explicit absolute `DB_PATH` and exactly two distinct instance origins in `TARGETS` (default ports 3001 and 3002). Before opening the database, it checks that both report healthy `v2`. Do not run while any v1 writer remains, and do not roll versions during backfill. Historically P2 introduced no v3/v4 code or new schema migration; later phases are complete above.

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

### P4 bridge, release and Contract gates

003 uses guarded AFTER INSERT and AFTER UPDATE OF `price_vnd, price` triggers to maintain `price = price_vnd / 1000.0`. The follow-up legacy UPDATE stops when the values agree, including with `recursive_triggers=ON`; tests exercise ON and OFF. Install only on backfilled/consistent v3/v3. Remove it only after both writers have returned to v3. v4 application SQL, including startup validation and orders, never queries/writes legacy `price`; it validates positive integer VND, uses new-column-only writes and derives legacy HTTP values. Tests trace all prepared SQL and restart the exact v4 tag against the contracted schema.

Use the current runner with the intended shared absolute DB_PATH, **not bare migrate**, for this proposed live staging sequence (NOT RUN here):

```bash
# Initial schema and Expand at their respective earlier gates:
DB_PATH="$DB_PATH" npm run migrate -- --to 001_init
DB_PATH="$DB_PATH" npm run migrate -- --to 002_add_price_vnd
# Only after completed backfill, CONSISTENT, and verified v3/v3:
DB_PATH="$DB_PATH" npm run migrate -- --to 003_sync_legacy_price
DB_PATH="$DB_PATH" npm run migrate:status
DB_PATH="$DB_PATH" npm run check
# Roll one instance at a time to immutable v4, checking after EACH roll.
# STOP: verify v4/v4 processes and DB identity, check CONSISTENT, verify backup,
# and obtain the student's explicit S8 go-ahead before executing the next command:
DB_PATH="$DB_PATH" npm run migrate -- --to 004_drop_price
```

The v4 tag itself contains 001–003 only and is deployable before Contract. 004 drops both bridge triggers before dropping `price` inside the runner's transaction. No order column changes. 004.down adds a nullable REAL legacy column, reconstructs it from integer VND and restores both triggers while 003 remains recorded as applied. This cannot recover historical sub-VND precision; it reconstructs canonical thousands-of-VND values. After S8 there is **no safe code-only v3 rollback**. Keep v4 running, execute controlled schema recovery only with the expected 004 migration last, inspect schema/triggers and plain CONSISTENT, and only then consider one-at-a-time v3 rollback. A verified backup remains a separate recovery option.

Reproducible development-only commands (use new absolute directories; existing evidence is never overwritten):

```bash
V4_REF=v4 P4_EVIDENCE_DIR=/absolute/new/rolling-evidence npm run rehearse:p4
P4_CONTRACT_EVIDENCE_DIR=/absolute/new/contract-evidence node scripts/rehearse-contract.js
```

These tools always allocate their own temporary DBs; they never consume a supplied live DB_PATH. The rolling rehearsal keeps one traffic process through all v3/v4 states. The separate Contract rehearsal checks 001–004 downs/re-ups, menu/order preservation, two tagged v4 listeners, verified VACUUM INTO backups, old/new HTTP after drop, v4 restart and 004 schema recovery. 001.down removes application tables, so schema absence is checked instead of claiming application CONSISTENT there. No active v4 writer is present during 003.down. Seed now supports legacy-only, both-column and new-only schemas; check retains prior assertions and additionally rejects out-of-range VND. The separate final-tree smoke applied all migrations to an empty disposable DB, seeded 20,000 new-column-only rows and printed plain CONSISTENT. It is not live rollout evidence.

### Data and migration-down checks

The completed root check log contains labeled checks after every step and individual roll. The following remains an illustrative recipe for a separate future fixture, not authorization to append to the frozen final log:

```bash
{
  printf '\n=== S3 Backfill complete ===\n'
  DB_PATH="$DB_PATH" npm run migrate:status
  DB_PATH="$DB_PATH" npm run check
} >> check-log.txt 2>&1
```

Before backfill the check may report `CONSISTENT, but ... rows have no price_vnd yet`. After S3 it must be plain `CONSISTENT`. For a separately authorized down rehearsal of **each** migration, initialize a separate throwaway `TEST_DB` at the target version, then log `DB_PATH="$TEST_DB" npm run migrate:down`, a check, an up migration, and a second check. Do **not** naively copy a running SQLite WAL DB file; use a fresh test DB or a proper database backup mechanism.

### Implemented verification coverage

- Both old and new menu payloads on **create and PATCH**, including validation and atomic dual writes.
- Legacy `price` and new `priceVnd` in individual, list and write responses; rounding/precision and mixed-version behavior.
- `/orders` and `order_items.unit_price` remain in **thousands**.
- Resumable, short-batch backfill under concurrent writes and rerun.
- Mixed v1/v2, v2/v3, v3/v4 (with bridge), rollback v3→v2→v3.
- Final contract: old HTTP clients work after database `price` is gone.
- All migrations run forward and `.down.sql` runs on a disposable DB.
- Current app fixtures use new-column data; schema-aware `scripts/seed.js` supports both pre- and post-Contract DBs. Historical P1/P2/P3 tests continue loading exact versioned source.

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

**CI disposition:** the student explicitly requested deleting `.github/workflows/migration-ci.yml` and proceeding without CI. The old startup failure remains preserved in `docs/evidence/p5-c-ci-blocker/result.json`; it is not claimed fixed or passing. Local Node22 current-suite32/32 and controller4/4 evidence remains the verification basis. No repository protection is bypassed. The student approved the self-assessment total **98/100**; this remains a claimed score, not an awarded grade.

### Final evidence locations and scope

All001–004 down/re-up commands actually ran on disposable DBs; see [p5-a-disposable-migrations/contract.txt](docs/evidence/p5-a-disposable-migrations/contract.txt) and [p4-contract/contract.txt](docs/evidence/p4-contract/contract.txt). Their raw output is separate from root check-log.txt; this rubric-format limitation is disclosed in the assessment. Do not splice or regenerate completed logs. Historical packets remain unchanged. Final integrity audit rechecked57 baseline evidence files,160 manifest comparisons, four release pins/pairs and the two root-log hashes without opening the demonstration DB.

Submission packaging uses the final merged Git tree and a real self-contained .git directory. Exclude local data/, Node runtime, backups, node_modules and temporary fixtures; preserve them locally. The extraction verification receipt identifies exact merged commit, archive SHA/size, tag/history/file checks and score98 matching23127379_98.zip. Student review and upload using23127379@student.hcmus.edu.vn before2026-11-05 22:00 ICT remain manual. No grade or CI success is inferred from local tests; available remote checks are inspected separately during integration.
