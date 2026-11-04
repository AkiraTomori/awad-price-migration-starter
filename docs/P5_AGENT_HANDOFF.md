# P5 Coding-Agent handoff — Final continuous demonstration and submission

**P5-C finalization follow-up:** the student authorized final verification, assessment, conditional PR #9 integration and ZIP packaging. Current Node22 source tests pass 32/32 and controller/backup tests 4/4; proposed assessment 98/100. [Final migration/status reference](../MIGRATION.md), [assessment](../SELF_ASSESSMENT_REPORT.md), and final integration/ZIP receipts supersede historical pending approval or submission-preparation statements below. S0–S8 logs and DB are frozen; no replay, migration or traffic restart is authorized. Upload remains manual.


**Current follow-up (2026-11-04 19:07:43 ICT):** the student explicitly approved S8. Migration `--to 004_drop_price` and both-client/order verification completed on the same DB and uninterrupted traffic PID 29850. The original generator ended once: **35,309,724 successful requests, zero error/contract/stale/unavailable**, one start/FINAL/RESULT and 26 observed down/back pairs (ten deliberate rolls plus sixteen transient route failures during the wait). Both v4 instances remain running. [Completed S8 evidence and limitations](P5_S8_RESULT.md). The earlier gate/snapshot text below is historical; do not rerun setup, migration or traffic. No merge, score/ZIP or submission.


**P5-B execution follow-up (2026-11-04):** PR #8 is merged at `20b98d97e734678fa9bd6204a3c953464751acc3`. The student authorized S0–S7 only on `feat/p5-b-final-traffic`. Those stages have run on the identified final DB with one original traffic PID 29850; current v4 instances are 32012/32117. See [the complete S8 review packet](P5_S8_REVIEW.md). Legacy price/bridge remain and 004 is pending. Explicit S8 approval is NOT GIVEN. Keep the same traffic/instances alive while waiting; do not restart initialization or treat the historical Gate A snapshot below as current live state.

**Verified status (2026-11-04):** P4 head `c0d33268bd8b791a1948d2dfda8bc116d9dadc17` is an ancestor of current `main` at merged PR #7 commit `3733dbde2336f3de1d35eb85408ceaa2d2fc8f2f`. PR #6 is closed with `merged=false`; do not require or claim that its merged flag is true. P4 code integration is established by ancestry and PR #7, as requested by the student. See [actual GitHub/source provenance](evidence/p5-a-provenance.json). The original planning branch started from the reviewed P4 head while the merge API was pending; this execution branch is now `feat/p5-final-execution` from latest main.

**Historical P5-A / Gate A record:** preflight tools, a non-executing S0–S8 plan and [operator flow](P5_FINAL_OPERATOR.md) were completed, with [32/32 Node 22 tests](evidence/p5-a-node22-validation.txt) and no demonstration at that point. The student later authorized P5-B S0–S7 after PR #8 merged, as recorded in the follow-up above. Do not apply the old NOT RUN/absence state to the current demonstration. S8, post-S8 completion, score/ZIP and submission still require further authorization and remain unexecuted.

**Task scope:** P5 only. Read `AGENTS.md`, `MIGRATION.md`, `docs/AGENT_WORKFLOW.md`, `docs/P4_AGENT_HANDOFF.md`, and this file. Never move release tags `v1`–`v4`. Use Node.js 22 and a fresh, explicitly identified demonstration DB, separate from every development/disposable rehearsal. No fabricated logs or automatic score claims.

## Gate A — Preflight and dry-run plan

1. Check tag SHAs: `v1=2b889bde433190c17744f30d3900d38ab333a756`, `v2=dadb816bac9dad5ffcbf098d130d387bbbdd338c`, `v3=ccd19db7c1cf14d2a5df21f38769c73dd96f27b2`, `v4=51669379446f8f34473a90104ea939284335e9f2`. Verify v4 does **not** contain 004.
2. Run full tests on Node 22. Verify port availability, absolute `DB_PATH`, migrations and test data. Confirm two independent instance processes really point at that same DB. Health/version alone does **not** prove DB identity or absence of extra writers.
3. Read and adapt the S0–S8 operator matrix in `MIGRATION.md`. The current runner supports `npm run migrate -- --to NNN_name` and bare `npm run migrate` **would run 004 too early**. Never use a bare up migration on the demonstration DB.
4. Preserve original starter traffic request/assertion/failure-counter semantics. Use one `NEW_CLIENTS_FILE` for dynamic shares in one traffic PID. Preflight zero share before v2; target positive share (e.g. 0.3) only with two qualified v2 writers and completed backfill.
5. Rehearse every migration down/up on **separate disposable DBs**; never drop tables or restore schemas as a practice step on the continuous demo DB.

## Gate B — One uninterrupted v1 → Contract traffic process

Record actual commands, timing, instance PIDs/versions, schema and check outputs; do not edit raw logs or restart the traffic process to reset counters.

| Stage | Required action | Safety gate |
|---|---|---|
| S0 | Create initial `001` schema, seed **20,000** rows, start v1/v1 and then **one** traffic process at new-client share 0 | Both instances healthy, same DB |
| S1 | Apply `002` with `--to 002_add_price_vnd` while v1/v1 | New column nullable, legacy live |
| S2 | Roll A then B to v2, separately | Traffic stays up; new clients still off |
| S3 | Run batch backfill, verify NULL=0/disagree=0 and plain `CONSISTENT`; only then change share to 0.3 in same traffic PID | No v1 writer remains |
| S4 | Roll A then B to v3 | Mixed v2/v3 consistent |
| S5 | Roll v3/v3 → v3/v2 → v2/v2 → v2/v3 → v3/v3, one instance at a time | Down/back events under **same** traffic PID, all four failure counters 0 |
| S6 | Apply `003` with `--to 003_sync_legacy_price` on verified v3/v3 | Bridge installed before v4 |
| S7 | Roll A then B to immutable v4 | Both instances verified v4/v4, still `CONSISTENT` |
| S8 | **STOP for student approval**, verify current backup and shared DB, then `--to 004_drop_price` **only if approved** | Operational point of no return: no code-only v3 rollback |
| Post-S8 | Verify old/new HTTP clients, orders, schema without `price`, two v4 instances, no failed requests; end traffic once | Save final raw counters and all checks |

For **every step and each individual instance roll**, append a readable label plus full `npm run migrate:status` and `npm run check` output to `check-log.txt`. Record migrations' actual up/down test commands on disposable DBs. Keep `traffic-log.txt` as one unmodified continuous generator output, with exactly one start and one final result after S8.

## S8 explicit approval gate

Before asking for permission to run `004`, present evidence that:

- [ ] Both instance **PIDs** report v4, and both processes point to the intended **same absolute DB_PATH**.
- [ ] There are no remaining legacy writers, and 003 bridge is still installed.
- [ ] `npm run check` shows plain `CONSISTENT`, 0 NULL, 0 disagreement, and traffic failure counters remain 0.
- [ ] A current SQLite-safe backup (e.g. `VACUUM INTO`) has been created and independently verified with `PRAGMA integrity_check`, counts and intended restore location.
- [ ] The student explicitly approves dropping `menu_items.price` on the **specific demonstration DB**.

**Without that authorization, stop at S7 and report P5 incomplete. Never claim a final successful Contract.** If traffic must remain continuous while waiting for authorization, keep the same process running and preserve PID/logs. A `004.down` after S8 is controlled schema recovery, not a safe immediate code rollback; perform recovery tests on separate DBs, not the demonstrated final state.

## Deliverables and evidence review

- Root `traffic-log.txt`: real uninterrupted S0→post-S8 output; one PID, zero `error`, `contract`, `stale`, `unavailable`, `RESULT: zero failed requests`.
- Root `check-log.txt`: clearly labeled checks after **every** action/roll, plus separate disposable down/up tests with true observed outputs.
- English `MIGRATION.md`: S0–S8 actual command/state/undo matrix, backup, operational point of no return and limits. Replace `NOT RUN` only where actually executed.
- English `AI-LOG.md`: chronological bullet list of tool/task, kept/changed/rejected, commands and human decisions; no invented claims.
- English `SELF_ASSESSMENT_REPORT.md`: **one row per rubric criterion**, scored maximums Plan 20, Expand/Dual Write 20, Backfill 15, Zero Failed Requests 20, Way Back 15, Contract 10; precise evidence path and honest total. Include “What I did not manage” and “What I would do differently.” Follow the supplied PDF template.
- Final ZIP named `<StudentID>_<total>.zip` with the **repository including `.git`**, tags `v1`–`v4`, all up/down SQL pairs, backfill, logs, Markdown reports and evidence. GitHub “Download ZIP” does **not** include `.git`. Validate archive listing and the Git history/tags after extraction, without deleting user work.
- Student must submit by **2026-11-05 22:00 ICT** using their `<StudentID>@student.hcmus.edu.vn` account. Do **not** submit or send mail without an explicit request.

## Historical P5-A handoff prompt (superseded by P5-B authorization above)

> Read the project instructions and this handoff. Work on `feat/p5-final-execution`, created from latest main. Verify P4 integration by main ancestry and PR #7 (PR #6 remains closed/unmerged), and preserve all release tags/evidence. Complete only P5-A: Node 22 preflight/tests, disposable DB identity/down-up proofs and a reproducible non-executing final operator plan. Do not create or mutate the demonstration DB or start its traffic before Gate A review. Stop with actual evidence. Gate B execution and final reports/ZIP are separate tasks; any live S8 additionally needs verified conditions and explicit student approval for that specific DB.
