# P5 final demonstration — prepared operator flow

**Current follow-up (2026-11-04 19:07:43 ICT):** the student explicitly approved S8. Migration `--to 004_drop_price` and both-client/order verification completed on the same DB and uninterrupted traffic PID 29850. The original generator ended once: **35,309,724 successful requests, zero error/contract/stale/unavailable**, one start/FINAL/RESULT and 26 observed down/back pairs (ten deliberate rolls plus sixteen transient route failures during the wait). Both v4 instances remain running. [Completed S8 evidence and limitations](P5_S8_RESULT.md). The earlier gate/snapshot text below is historical; do not rerun setup, migration or traffic. No merge, score/ZIP or submission.


**Executed follow-up (2026-11-04):** the student subsequently authorized P5-B S0–S7. Execution reached S7 and stopped for S8 review with original traffic PID 29850 running, v4/v4 PIDs 32012/32117 and no 004. [Current review packet](P5_S8_REVIEW.md). The recipe below is retained as the preparation reference; actual commands/checks/process identities are in the execution events, not an assertion that every illustrative shell block was run verbatim. Do not rerun setup against the active DB/logs. S8 remains separately approval-gated.

**Historical preparation recipe.** P5-A covered preflight/disposable probes; the student later explicitly authorized P5-B S0–S7. The run is now stopped at S8 for separate approval, with live root logs and no final RESULT. This document does not authorize S8, a final score or a submission ZIP.

P4 is integrated into main's PR #7 ancestry. PR #6 is closed with `merged=false`; that flag is not the integration gate. Verify that the reviewed P4 head `c0d33268bd8b791a1948d2dfda8bc116d9dadc17` is an ancestor of latest main. Preserve all four release pins listed in `scripts/p5-plan.js` and the existing raw evidence under `docs/evidence/`.

## Gate A: commands that are safe before demonstration approval

Use Node.js 22 in PATH. From the repository, run `npm test`, then `npm run p5:plan` and `npm run p5:preflight`. The plan command prints JSON and executes no plan step. Preflight rejects existing final logs/run directories, busy ports, unexpected tags and missing P4 ancestry. It uses a fresh disposable DB, seeds 20,000 rows, starts two independent exact-v1 processes on ephemeral ports, observes their actual open DB handles, checks cross-instance writes/orders, and removes only its own temporary resources. Planned ports are checked but not reserved afterward. Preflight never opens or creates the proposed demonstration DB.

The recorded Gate A run passed 32/32 tests on Node v22.23.4; see [actual commands/results](evidence/p5-a-node22-validation.txt) and [preflight summary](evidence/p5-a-preflight/summary.json). The default evidence directory now exists, so any replay must set `P5_PREFLIGHT_EVIDENCE_DIR` to a new absolute path. This preserves every prior result instead of overwriting it. Ports/absence checks expire as the environment changes; recheck before Gate B.

Default proposed identities, to be reviewed before S0:

- Run directory: `/Users/thaiminhhuy/docs/Github/IA/IA2/awad-price-migration-starter/data/p5-final-20261104`.
- Shared DB: that directory's `app.db`; ports A=3001 and B=3002.
- Dynamic share: that directory's `client-share.json`.
- Final logs: repository-root `traffic-log.txt` and `check-log.txt`, both required absent before a new run.

Changing these choices requires rerunning preflight and reviewing the resulting plan. Do not delete or truncate an existing DB/log to make preflight pass. The actual Gate A output is under `docs/evidence/p5-a-preflight/`, separate from every proposed final path. Its two-PID proof qualifies a disposable fixture, not future demonstration processes. Recheck actual identity during Gate B.

The full test suite includes separate disposable 001–004 down/up proofs. A separately captured replay may use `P4_CONTRACT_EVIDENCE_DIR=/absolute/new/disposable-evidence node scripts/rehearse-contract.js`; this tool allocates its own temporary DB and never uses the demonstration DB. Never rehearse a down on the final DB.

## Gate B: future execution after Gate A approval

Keep one dedicated Bash control shell open through the eventual S8 approval pause. Use the same validated Node 22 runtime for all commands. Run from the reviewed repository checkout; historical tag runners lack `--to`, so use the current runner for migrations. Every command below is **NOT RUN on the demonstration DB** in P5-A.

Initial setup, only after the student approves Gate B scope:

```bash
set -euo pipefail
set -o noclobber
REPO="$(pwd -P)"
RUN_DIR="$REPO/data/p5-final-20261104"
export DB_PATH="$RUN_DIR/app.db"
export P5_RUN_DIR="$RUN_DIR"
export NEW_CLIENTS_FILE="$RUN_DIR/client-share.json"
export TARGETS=http://127.0.0.1:3001,http://127.0.0.1:3002
node -e 'if (process.versions.node.split(".")[0] !== "22") process.exit(1)'
P5_PREFLIGHT_EVIDENCE_DIR="$REPO/docs/evidence/p5-gate-b-recheck-$(date +%Y%m%dT%H%M%S)" npm run p5:preflight
# After successful fresh preflight, create the reviewed run directory once:
mkdir -p "$REPO/data"
mkdir "$RUN_DIR"
mkdir "$RUN_DIR/releases"
for P5_TAG in v1 v2 v3 v4; do
  git worktree add --detach "$RUN_DIR/releases/$P5_TAG" "$P5_TAG"
done
printf '0\n' > "$NEW_CLIENTS_FILE"
P5_LOG_SEQUENCE=0
```

Record the actual checkout SHA and Node version in a control log. Do not redirect generator stdout into its own `LOG` file (that would duplicate raw traffic lines). The traffic generator itself appends to root `traffic-log.txt`.

Use a labeled check after every action in the JSON plan, including each individual roll, backfill rerun and client-share change:

```bash
record_check() {
  {
    printf '\n=== %s · DB_PATH=%s ===\n' "$1" "$DB_PATH"
    npm --prefix "$REPO" run migrate:status
    npm --prefix "$REPO" run check
  } >> "$REPO/check-log.txt" 2>&1
  if [ -n "${P5_TRAFFIC_PID:-}" ]; then kill -0 "$P5_TRAFFIC_PID"; fi
}
```

Before backfill, NULL warnings are expected. After S3, require plain `CONSISTENT`, NULL=0, disagree=0 and valid integer/range counts. Stop on any unexpected inconsistency or nonzero traffic failure counter. Inspect the latest real counter line; do not reset or restart traffic to obtain a clean result.

For each `start_instance` or `roll_one` from the plan, use this same-shell process pattern. Substitute the specific slot/tag/port from that plan; never stop both ports together:

```bash
# Example pattern for starting slot A at v1 (repeat for B at :3002):
(
  cd "$RUN_DIR/releases/v1"
  export PORT=3001
  exec node src/server.js
) > "$RUN_DIR/instance-A-0.log" 2>&1 &
P5_PID_A=$!
P5_TAG_A=v1
```

Use a new instance-log filename for every start; never overwrite earlier logs. Before stopping A, prove B is healthy and correctly identified, and conversely. For a roll, `kill -TERM` only the chosen PID, `wait` for its graceful exit, then start its replacement on the same port. Preserve the original traffic PID and wait for its actual `down` and `back` log lines before the next roll. Do not manually write those lines.

At each start and before every gate, save all of:

1. `git -C "$RUN_DIR/releases/TAG" rev-parse HEAD` matching the frozen tag SHA, and an empty worktree status.
2. Actual `ps -p PID -o pid=,command=` and `lsof -a -p PID -d cwd -Fn` matching that release directory.
3. `lsof -a -p PID -- "$DB_PATH"` for **both** PIDs, plus the canonical DB path/device/inode. This confirms actual open handles, beyond a health assertion.
4. `/health` from the port. v2/v3/v4 must report the expected version; original v1 has only `{ok:true}`, so use its release SHA/cwd/PID proof, not an invented health version.
5. The labeled schema/consistency check and unchanged live traffic PID. Check for additional listeners/writers on these ports/DB; do not terminate unfamiliar processes.

The exact ordered actions are in the generated `plan.json`; do not batch rolls. Core commands at their respective stages:

```bash
# S0, current runner explicitly bounded to 001:
npm run migrate -- --to 001_init
record_check 'S0-schema'
node "$RUN_DIR/releases/v1/scripts/seed.js" 20000
record_check 'S0-seed-20000'
# Start/identify A=v1 and B=v1 separately; check after each.
```

Start the generator directly once, so `$!` is the actual traffic PID:

```bash
LOG="$REPO/traffic-log.txt" NEW_CLIENTS=0 DURATION=0 \
  node "$REPO/scripts/traffic.js" > "$RUN_DIR/traffic-stdout.txt" 2>&1 &
P5_TRAFFIC_PID=$!
record_check 'S0-traffic-start'
# S1:
npm run migrate -- --to 002_add_price_vnd
record_check 'S1-expand'
# S2: roll A then B to v2, identity/check/down/back after EACH roll; share stays 0.
# S3, only on verified v2/v2, no v1 writers:
npm run backfill | tee -a "$RUN_DIR/backfill-first.txt"
record_check 'S3-backfill'
npm run backfill | tee -a "$RUN_DIR/backfill-rerun.txt"
record_check 'S3-rerun-updated-0'
printf '0.3\n' > "$NEW_CLIENTS_FILE.next"
mv "$NEW_CLIENTS_FILE.next" "$NEW_CLIENTS_FILE"
# Wait for the accepted CLIENT_MIX 0 -> 0.3 line from the SAME traffic PID.
record_check 'S3-clients-0.3'
# S4: A=v3, then B=v3, with separate checks.
# S5: B=v2, A=v2, B=v3, A=v3, with separate checks and traffic untouched.
# S6, verified v3/v3:
npm run migrate -- --to 003_sync_legacy_price
record_check 'S6-bridge'
# S7: A=v4, then B=v4, with separate checks; retain bridge 003.
```

If the run starts incorrectly, label it incomplete and preserve it; never splice a restarted generator into a claimed continuous log.

## S8: separate explicit approval, no automatic continuation

At verified v4/v4 **keep traffic running** while preparing a fresh SQLite-safe backup. Use VACUUM INTO or the SQLite backup API, not a raw WAL file copy. Independently check the backup's integrity, schema/migration identity, table counts and contents; record an absolute restore location. Revalidate all writer identities, bridge presence, plain CONSISTENT, zero NULL/disagree, and a fresh zero-failure counter snapshot. Save the backup time and traffic PID.

Present that packet with the exact DB path and ask for the student's explicit approval to drop `menu_items.price`. Do not infer approval from elapsed time, passing tests, merge, or this plan. If evidence becomes stale while waiting, refresh it before acting. If the original traffic process must stop, preserve the unfinished run and report P5 incomplete.

Only after the student approves that specific DB and current packet:

```bash
npm run migrate -- --to 004_drop_price
record_check 'S8-contract'
```

Before ending the same generator, verify both clients' POST/PATCH/GET/list and orders, price absent, both instances v4 and all counters still zero. Keep original order units. Send SIGINT to the actual recorded generator PID once, `wait` for its exit, and retain its final counter/result lines unmodified. Check exactly one traffic start and one final result; preserve every per-roll check. A failed run is evidence of failure, not permission to clear logs.

After S8, v3 cannot restart until controlled schema recovery. Rehearse recovery on disposable DBs only; do not modify the demonstrated final state as a practice rollback. Final self-assessment, PDF-template alignment, StudentID/score-named ZIP including `.git`, extraction verification and submission are later gates, not P5-A results.
