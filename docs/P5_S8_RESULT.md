# P5 final continuous demonstration — S8 completed

Observed completion: **2026-11-04 19:07:43 ICT**. The student explicitly authorized S8 in the current conversation: “Hãy thực hiện S8 và thực hiện thao tác như nãy giờ thực hiện”. The authorization applied to the same demonstration DB previously presented for review. No merge, report score, ZIP or submission was authorized or performed.

## Actual result

One original traffic process, PID **29850**, ran continuously from S0 at 17:58:18 ICT through Contract and post-Contract verification. It was never restarted or reset. After successful checks, SIGINT was sent once to that exact PID. The real log ends:

```text
4165.8s FINAL ok=35309724 error=0 contract=0 stale=0 unavailable=0 rerouted=101
RESULT: zero failed requests
```

Elapsed time: about **69 minutes 26 seconds**. Exactly one start, one FINAL, one RESULT, and **26 observed down/back pairs**: ten during deliberate instance rolls and sixteen additional transient route failures during the long wait. The additional lines show TimeoutError (and one ECONNRESET); their underlying cause was not established. Requests recovered through the unchanged retry/reroute logic. Zero final failed requests does not establish zero transport interruptions or a latency SLO. Rerouting is allowed; it is not a failed-request counter. Because the generator was reattached after the earlier controller exit, its OS exit status cannot be recovered by this process; it is recorded **UNAVAILABLE**, not fabricated as exit 0. Actual FINAL/RESULT and process termination were verified.

## Contract and client evidence

- DB: `/Users/thaiminhhuy/docs/Github/IA/IA2/awad-price-migration-starter/data/p5-final-20261104/app.db`.
- Fresh gate verified listener/cwd/worktree/health/open DB identities: A PID **32012**, port 3001; B PID **32117**, port 3002; immutable **v4**, same device/inode. No other DB holders/writers were present.
- Explicit command: `npm run migrate -- --to 004_drop_price`, exit **0**, output `applied 004_drop_price`. This is the only live 004 application. No live down/recovery was executed.
- Schema after S8: `id, name, price_vnd`; legacy `price` absent; both compatibility triggers removed; ledger includes 001–004.
- Raw `npm run check` exited **0**, plain **CONSISTENT** after Contract and after the HTTP proof. NULL, non-integer and out-of-range counts are 0. `disagree` is no longer applicable or printed when legacy price is absent.
- Both old/new payloads were exercised on **each** instance: POST, PATCH with each payload, GET and list from both ports. For `priceVnd: 45501`, responses still expose `price: 45.501`. Four separately created proof items avoided the generator's fixed/known items.
- Four orders returned total **91.002** for quantity 2; actual `order_items.unit_price` was **45.501**, preserving thousands-of-VND units.
- Both v4 instances remain running on the final contracted DB; the traffic generator has finished. No app rollout or restart was needed for S8.

## Fresh pre-Contract backup

Backup: `/Users/thaiminhhuy/docs/Github/IA/IA2/awad-price-migration-starter/data/p5-final-20261104/s8-precontract-backup-20261104T120426083180Z.db`.

Verified UTC: `2026-11-04T12:06:19.022030+00:00`. SHA-256: `14d86de21c0a91ff7400166dfcfc9d2aaf361f490c89fa8734c8387cc41e5070`.

SQLite backup API from one pinned source read snapshot while traffic continued. Integrity **ok**, FK check empty; schema, ordered row digests and counts of every application table and migration ledger matched the same source snapshot. Exact table evidence is in the [fresh packet](evidence/p5-s8-approved-precontract/s8-packet.json). Intended restore path: `/Users/thaiminhhuy/docs/Github/IA/IA2/awad-price-migration-starter/data/p5-final-20261104/recovery/app-restored.db` (not restored).

This backup predates Contract and subsequent writes. A full backup restore would lose newer writes unless separately reconciled. After 004 there is **no safe code-only rollback to v3**. Controlled schema recovery must restore legacy representation/bridge and be verified before old code starts. Prior disposable down/up/recovery evidence remains unchanged; no recovery rehearsal used this demonstration DB.

## Controller issue and recovery

The S0–S7 check wrapper asserted a `disagree=0` line after 004. The raw checker correctly omitted that inapplicable metric, exited 0 and printed CONSISTENT, but the wrapper raised an assertion. Execution stopped and preserved the actual state; traffic remained the same PID with zero failures. The diagnosed post-Contract continuation verified the new schema and integer validity directly, retained full raw checks, skipped migration dispatch entirely and completed the HTTP/order proof. Both the failed orchestration attempt and continuation are retained in [events](evidence/p5-s8-completion/events.jsonl) and the two exact operator scripts. No assertion in the traffic generator or application checker was changed.

Earlier S2 disagreements and the S0 startup readiness race remain documented in the [historical S8 packet](P5_S8_REVIEW.md); they are not relabeled as passing checks. S3 onward data checks were consistent. Full Node.js 22 suite **32/32** and controller/backup tests **4/4** passed before this S8 operation as recorded in [validation](evidence/p5-b-validation.txt). No new full-suite rerun is claimed for S8; fresh-target preflight is intentionally not rerun on an existing active/final run.

## Review evidence and next gate

- [Actual S8 summary](evidence/p5-s8-completion/summary.json)
- [Raw migration, identities, HTTP and checks](evidence/p5-s8-completion/events.jsonl)
- [Final traffic snapshot](evidence/p5-s8-completion/traffic-final.snapshot.txt)
- [Final check snapshot](evidence/p5-s8-completion/checks-final.snapshot.txt)
- [Root-log sizes and hashes](evidence/p5-s8-completion/final-log-manifest.json)
- [Fresh pre-Contract gate/backup](evidence/p5-s8-approved-precontract/s8-packet.json)
- Root `traffic-log.txt` and `check-log.txt` are preserved as actual final logs.

All release tags and previously tracked evidence files were verified unchanged before documentation updates. Historical raw evidence/packets remain immutable. **Stop for review of completed P5-B.** Final self-assessment, score, ZIP and submission remain separate authorization gates. PR #9 remains unmerged.
