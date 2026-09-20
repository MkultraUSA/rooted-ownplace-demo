# Review Log — blind-review findings per PR

Every PR gets an independent blind review (fresh agent, no author context).
This table is the bug-fix log: findings caught → fix commit → re-review.
PRs also carry `review-findings-N` labels (filterable, countable).

| PR | Title | Findings | Verdicts | Fix commit | Closes |
|----|-------|----------|----------|------------|--------|
| #1 | CODEOWNERS: MkultraUSA reviews all changes | 0 | — (no review pass) | — | — |
| #2 | CI lane: client simulators + verify + workflow | 9 | CHANGES_REQUESTED → superseded by #3 | — | — |
| #3 | CI lane (fixes branch) | 0 new | APPROVED | `a0af844` + workflow via API | — |
| #4 | Real WebDavStore + kevcloud opt-in live test | 11 advisory | APPROVE (COMMENT) | — (follow-ups queued) | — |
| #5 | Cloud publish + 4-way parity + persistent web | 5 | CHANGES_REQUESTED → APPROVED | `12c0de8` | — |
| #6 | Docs: update AGENT0_STATUS to post-PR5 reality | 0 | APPROVED (docs-only) | — | — |
| #10 | Post CLI: timeline syndication to everyone | 11 | COMMENT → APPROVED | `e2957bc` | #7 |
| #11 | Timeline UI + parity timeline-index check | 10 | CHANGES_REQUESTED → APPROVED | `9181dad` | #8 |
| #12 | Docs: REVIEW-LOG bug-fix ledger | unknown — no label (docs-only) | APPROVED (Radics, docs-only) | — | — |
| #13 | Web composer + contacts + shared timeline lib | unknown — no label | APPROVED (Radics) | `e442880` | — |
| #14 | Web auth: session login gate for composer | unknown — no label | APPROVED (Radics) | `7fd792e` | — |
| #15 | Mobile UI: viewport, tap targets, single-column CSS | unknown — no label | APPROVED (Radics) | — | — |
| #16 | Docs: paid-gating design note (issue #9) | unknown — no label (docs-only) | APPROVED (Radics, docs-only) | `5256280` | #9 (note, not close) |
| #17 | Docs: agentic scrum lane design (research synthesis) | unknown — no label (docs-only) | APPROVED (Radics, docs-only) | `5466d6a` | — |
| #21 | Web auth hardening follow-ups | 4 | APPROVED (Radics) | — | #18 |
| #22 | Public URL for OwnPlace web | 0 | APPROVED (Radics) | — | #19 |
| #23 | Add Kinfolk Ed25519 identity and package verification | 3 | APPROVED (Radics) | — (fixed on branch) | #20 |
| #25 | Authenticate historical timeline reads | 2 | — (closed, superseded by #26) | — | #24 (via #26) |
| #26 | Authenticate historical timeline reads | 2 | COMMENTED → APPROVED (MkultraUSA) | `374a380` | #24 |
| #30 | Paid gating slice 1: single-reader sealed story bodies | 6 | APPROVED (Radics) | — | #29 |
| #32 | Paid gating slice 2: multi-reader wrapped keys | 2 | APPROVED (Radics) | — | #31 |

Totals: **65 findings caught across 15 PRs with `review-findings-N` labels (13 merged + #2 closed-superseded + #25 closed-superseded), plus 6 unlabelled PRs (#12–17, unknown counts — see rows)**, all addressed or queued.
Themes: import side effects, path traversal, raw throws vs collected
problems, weak cross-backend checks, destructive tests, crash ordering,
missing error states, unvalidated input; plus session/auth hardening,
signed-package verification, history authentication, sealed-body envelopes.

Convention: Radics pushes `radics/*` (code only, never `.github/workflows/`);
blind review posts verdict; MkultraUSA merges. Ruleset `review-lane-main`
enforces PR + 1 approval + green `demo` check on `main`.
