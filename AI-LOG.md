# AI usage log — CSC13114 IA#2

This file records assistant involvement honestly and chronologically. It is not a transcript. Executed disposable tests are distinguished from the unexecuted live demonstration.

## 2026-11-04 — planning and agent handoff

- **Tool:** ChatGPT (OpenAI), using the GitHub connector.
- **Asked for:** a detailed implementation plan, a small coding-agent work process, short migration theory notes, and a lightweight CI workflow in a planning pull request.
- **Kept:** the proposed expand/dual-write/backfill/switch-read/rollback/contract stages, task gates, and initial CI/test checklist.
- **Changed:** no application implementation has been changed in this planning PR; the student should review and adjust the plan before executing it.
- **Rejected:** automatic destructive migration, premature contract, invented traffic/check evidence, or a CI-success claim of zero downtime.
- **By hand:** application changes, migration execution, traffic rehearsal, and self-assessment remain to be performed and verified by the student.

## 2026-11-04 — P1 expand and dual write (review pending)

- **Tool:** Codex (OpenAI), local shell and file edits; GitHub connector for the implementation pull request.
- **Asked for:** implement only P1, preserve v1 compatibility, prove migration 002 down on a separate database, update this log and open a separate implementation PR. Stop for student review.
- **Kept:** nullable `price_vnd INTEGER` in migration 002, legacy `price` reads, single-statement dual writes on both POST and PATCH, both request formats and both response fields. `/orders` totals and `order_items.unit_price` remain in thousands of VND.
- **Changed:** menu responses always derive `priceVnd` from legacy `price`, including when a v1 writer has left a non-null new value stale. Added consistent-pair validation when both fields are supplied, positive/safe integer conversion, and retained the starter ceiling (100,000 thousands / 100,000,000 VND). Positive legacy values rounding to zero VND are rejected. Added package version 2.0.0 and health `version: v2`.
- **Executed:** baseline `npm test` (4/4), then P1 `npm test` (10/10), on Node v26.6.0. Tests exercise original v1 source at `2b889bde433190c17744f30d3900d38ab333a756` and v2 through HTTP against two connections to one absolute temporary SQLite path. They verify both write paths, response shapes, null/stale new-column reads, order units, validation, atomic-statement guards, and 002 up/down/re-up preserving legacy menu/order data. `v1^{}` was checked against the original SHA.
- **Executed CLI rehearsal:** on a fresh disposable database, `npm run migrate`, `npm run seed` (20,000 rows), `npm run migrate:status`, `npm run check`, `npm run migrate:down` (002 only), status/check, then migrate/status/check again; every command exited 0. Full output and the exact temporary path are in `docs/evidence/p1-validation.txt`. Expanded checks reported 20,000 null new values, 0 non-integers, 0 disagreements and the expected pre-backfill `CONSISTENT, but ...` warning. After down the same 20,000 legacy rows remained and check printed `CONSISTENT`. The temporary DB was removed after rehearsal.
- **Rejected / out of scope:** P2–P5, backfill, traffic-switch changes, v3/v4, contract, live deployment, live migration, final traffic demonstration and submission. Traffic counters and rolling down/back evidence: **NOT RUN**. Remote CI: **NOT RUN locally**; see the PR checks for their separate result. No zero-downtime claim is made.
- **By hand / review gate:** student review of SQL, validation and down evidence remains pending. Do not send new clients to v1. v1 writes can still leave null or stale `price_vnd`; do not backfill or switch reads in this phase. Migration down is unsafe with dependent v2 code running. No v2 release tag was created before review. Existing unrelated `.gitignore` work is excluded from the P1 commit.

## Future entries

For each implementation phase, add the date, tool, prompt/task, kept, changed, rejected, and by-hand work. Only describe commands and results that actually happened.
