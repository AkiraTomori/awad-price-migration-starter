# S8 approval packet — P5-B stopped after S7

**Current follow-up (2026-11-04 19:07:43 ICT):** the student explicitly approved S8. Migration `--to 004_drop_price` and both-client/order verification completed on the same DB and uninterrupted traffic PID 29850. The original generator ended once: **35,309,724 successful requests, zero error/contract/stale/unavailable**, one start/FINAL/RESULT and 26 observed down/back pairs (ten deliberate rolls plus sixteen transient route failures during the wait). Both v4 instances remain running. [Completed S8 evidence and limitations](P5_S8_RESULT.md). The earlier gate/snapshot text below is historical; do not rerun setup, migration or traffic. No merge, score/ZIP or submission.


**Observed at 2026-11-04 18:10:23 ICT. Migration 004 is NOT executed on the demonstration DB. Approval is NOT GIVEN.**

PR #8 is merged; this branch `feat/p5-b-final-traffic` started at latest main `20b98d97e734678fa9bd6204a3c953464751acc3`. The current user authorized S0–S7 and keeping the original traffic process alive at S8. No final submission/score/ZIP is prepared.

## Specific target and active processes

- Demonstration DB: `/Users/thaiminhhuy/docs/Github/IA/IA2/awad-price-migration-starter/data/p5-final-20261104/app.db`.
- Stable Node.js 22 executable: `/Users/thaiminhhuy/docs/Github/IA/IA2/awad-price-migration-starter/data/p5-final-20261104/runtime/node` (v22.23.4); it is retained for the running demonstration.
- Original traffic PID **29850**, started once at 2026-11-04 17:58:18 ICT. It remains alive, share 0.3, DURATION=0.
- Instance A: PID **32012**, port **3001**, healthy **v4**, exact SHA `51669379446f8f34473a90104ea939284335e9f2`; DB device `16777231`, inode `28975812`.
- Instance B: PID **32117**, port **3002**, healthy **v4**, exact SHA `51669379446f8f34473a90104ea939284335e9f2`; DB device `16777231`, inode `28975812`.

Both actual listener PIDs, commands, source worktree HEAD/clean status, cwd, DB file handles and common device/inode were checked. `lsof` on the DB showed only those two v4 holders after check/backup connections closed. Health alone was not used as identity proof. Schema migrations are 001/002/003; 004 remains pending. Legacy `price` and both 003 triggers remain installed.

## Traffic and consistency

Counter snapshot at elapsed 725.1 seconds: `ok=7847467 error=0 contract=0 stale=0 unavailable=0 rerouted=43`.
One traffic start, 10 real down and 10 back events, **zero final results so far**. This is an in-progress run, not a completed zero-downtime or Contract claim. Counters continue increasing; this packet is a timestamped snapshot.

All checks from S3 onward are plain CONSISTENT, NULL=0, non-integer=0, out-of-range=0 and disagree=0. The last recorded check contained 176461 live menu rows; growth from the original 20000 seed is caused by the unchanged traffic create path.

Before backfill, raw S2-A check exited 1 with 28 disagreements and S2-B exited 1 with 11. These were diagnosed as v1 legacy-only reprices during mixed v1/v2 (follow-up reads naturally vary while traffic writes). New-client share was still 0, both versions still read legacy price, no v3 reader existed and request failure counters stayed zero. The original checker/output/exit codes were preserved, not weakened or labeled plain CONSISTENT. After retiring v1, S3 reconciled NULL/stale values. First backfill: 207 batches, 41078 scanned, 38683 updated; rerun: 211 batches, 41666 scanned, **0 updated**. Every subsequent check passed.

## Verified SQLite-safe backup

- Backup: `/Users/thaiminhhuy/docs/Github/IA/IA2/awad-price-migration-starter/data/p5-final-20261104/s8-precontract-backup-20261104T111005112433Z.db`.
- Verified timestamp (UTC): `2026-11-04T11:10:21.152782+00:00`; size 82882560 bytes.
- File SHA-256: `b772dd4dce74a97bc8d07d63694114102169bd6570cad876910f5f79b18c3183`.
- Intended restore location (not restored/created): `/Users/thaiminhhuy/docs/Github/IA/IA2/awad-price-migration-starter/data/p5-final-20261104/recovery/app-restored.db`.
- SQLite backup API used a pinned source read transaction while v4 traffic continued. Schema and per-table ordered content digests match that same source snapshot exactly. The current live DB is allowed to grow afterward; counts were not compared across different timestamps.
- Independent backup `PRAGMA integrity_check`: **ok**; foreign-key check: **empty**. Backup contains migrations 001–003 and both synchronization triggers.

| Table | Rows in verified source/backup snapshot | Ordered-content SHA-256 |
|---|---:|---|
| menu_items | 172887 | `b7267243574d7d07a920dad8deff70b0113af128d3e8a4d0633d944c17601c41` |
| orders | 1147682 | `44e76543100e0cf731913537c47ec65160f03a83a71bfa70aeaa2e4fc8df7eb0` |
| order_items | 2295364 | `bdde9882e4e899c73aea7ea4d9620d677fc4f3f00e69b57439922558fc156208` |
| schema_migrations | 3 | `7010b87bffbd80ef0704bc08640886160287b20de616bc998b1285c54f1d3932` |

## Actual S0–S7 timeline

| Step/check | Observed A/B | Check exit |
|---|---|---:|
| S0-schema-001 | -/- | 0 |
| S0-seed-20000 | -/- | 0 |
| S0-A-v1 | v1/- | 0 |
| S0-B-v1 | v1/v1 | 0 |
| S0-one-traffic-start-share-0 | v1/v1 | 0 |
| S1-expand | v1/v1 | 0 |
| S2-A-v2/v1 | v2/v1 | 1 |
| S2-B-v2/v2 | v2/v2 | 1 |
| S3-backfill-complete | v2/v2 | 0 |
| S3-idempotent-rerun | v2/v2 | 0 |
| S3-clients-0.3-same-PID | v2/v2 | 0 |
| S4-A-v3/v2 | v3/v2 | 0 |
| S4-B-v3/v3 | v3/v3 | 0 |
| S5-rollback-B-v3/v2 | v3/v2 | 0 |
| S5-rollback-A-v2/v2 | v2/v2 | 0 |
| S5-restore-B-v2/v3 | v2/v3 | 0 |
| S5-restore-A-v3/v3 | v3/v3 | 0 |
| S6-bridge-v3/v3 | v3/v3 | 0 |
| S7-A-v4/v3 | v4/v3 | 0 |
| S7-B-v4/v4 | v4/v4 | 0 |
| S8-GATE-before-backup-NO-004 | v4/v4 | 0 |
| S8-GATE-after-backup-NO-004 | v4/v4 | 0 |
| S8-GATE-before-backup-NO-004 | v4/v4 | 0 |
| S8-GATE-after-backup-NO-004 | v4/v4 | 0 |
| S8-GATE-before-backup-NO-004 | v4/v4 | 0 |
| S8-GATE-after-backup-NO-004 | v4/v4 | 0 |

Explicit migrations on this demonstration DB were only `--to 001_init`, `--to 002_add_price_vnd` and `--to 003_sync_legacy_price`. Each instance rolled alone; v3 rollback followed v3/v3 → v3/v2 → v2/v2 → v2/v3 → v3/v3 with the same traffic PID. No migration down or 004 was run on this DB.

## Resolved controller issue and preserved evidence

The first controller stopped just after spawning traffic because it demanded a start-log line before the generator had written it. The original detached v1/v1 and traffic processes continued. The controller was fixed and reattached to **the same PID 29850**; neither traffic nor counters/logs were reset. The original failure and recovery are retained in execution events. Exit codes of the two original v1 processes were unavailable after reattachment; their termination was observed and recorded as unavailable, not fabricated as exit 0. There is no unresolved execution blocker at S8.

- Full Node 22 suite before creation: **32/32 passed**. Preflight repeated successfully. Additional controller/backup tests: **4/4 passed**, including the startup-readiness regression, nonzero counter rejection, Contract whitelist refusal, and backup consistency under a concurrent writer.
- Existing 21 tracked evidence files and all release tag objects/pins are unchanged. Unrelated `.gitignore` changes are excluded. Application, migration and traffic-generator source are unchanged.
- Live root `traffic-log.txt` and `check-log.txt` are append-only local files. Their unfinished contents are preserved; immutable byte-prefix snapshots are provided for review. No FINAL/RESULT line was fabricated.

## Packet files and next gate

- [Machine-readable current review packet](evidence/p5-b-final-s8-review/s8-packet.json)
- [Fresh verification/backup command events](evidence/p5-b-final-s8-review/events.jsonl)
- [Immutable traffic prefix](evidence/p5-b-final-s8-review/traffic-through-s7.snapshot.txt)
- [Immutable full check prefix](evidence/p5-b-final-s8-review/checks-through-s7.snapshot.txt)
- [Original execution events, including the resolved controller race](evidence/p5-b-execution/events.jsonl)
- [Node 22 and controller test/preflight output](evidence/p5-b-validation.txt)
- [Preserved pre-existing evidence manifest](evidence/p5-b-execution/preserved-evidence.json)

**STOP.** The student must explicitly approve dropping `menu_items.price` on the specific DB above. Passing this packet is not approval. While waiting, keep traffic PID 29850 and the two v4 instances alive. Revalidate current zero counters, process/DB identity, schema and a sufficiently current verified backup before any approved S8 action; the review snapshot will age while writes continue. A new read/backup-only refresh is available with `PYTHONDONTWRITEBYTECODE=1 python3 scripts/p5_b_refresh.py --evidence /absolute/new/review-directory`. It creates new evidence/backup files and does not execute migrations or restart traffic.

After eventual S8 there is no safe code-only v3 rollback: restore the legacy schema/bridge and verify recovery before any v3 restart. Submission/report/ZIP work remains outside this P5-B authorization.
