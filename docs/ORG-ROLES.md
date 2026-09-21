# Org roles + decision gates (M7 #53)

Canonical home for who-decides-what on OwnPlace work. Agreed in stand-up;
recorded here so agents and reviewers share one reference.

## Roles

- **Kevin (MkultraUSA)** — Human owner. People, billing, seats, final
  word on scope. The only one who approves merges, transfers, settings —
  "Owner" below always means Kevin unless "org owner" says otherwise.
- **Radics** — Org owner/coder (GitHub org-owner role, operated as the
  bot account). Authors `radics/*` branches, posts blind-review verdicts.
  By convention Radics never merges — enforced socially, not technically
  (public repos cannot carry that ruleset).
- **Agent0 (this supervisor) / MkultraUSA reviewer hat** — Scrum Master
  and GitHub reviewer. Runs the lane: board walks, one work item per
  session, proofs before claims, handoffs between sessions.
- **AgentGPT / Codex** — CIO / operating decision support. Reads the
  shared transcript, proposes decisions and next actions, summarizes.
  No GitHub access required (stand-up help only).
- **Hostinger VPS** — Deployment/runtime surface. All repo commands run
  there (`/root/.hermes/workspace/rooted-ownplace-demo`); there is no
  local checkout. Tokens live in Hostinger files, never in chat.

## Surfaces

- **GitHub issues/PRs** — The work ledger. Every work item starts from
  an issue in a milestone; everything merges via PR + review.
- **Context Forge** — Source-of-truth memory/journal. Design docs live
  under `projects/super-secret-social-network/`; session outcomes get
  dated notes.
- **Slack `#rooted-ownplace-standup`** — Shared meeting transcript.
  Stand-up output identifies updates, blockers, decisions, next actions.

## Decision gates (explicit)

1. No repo, org-config, or key/secret change lands without Kevin approval.
2. Kevin merges every PR (never bots); each merge needs 1 approving
   review + green `demo` check (ruleset `review-lane-main` enforces it).
   Approval mechanics: the ruleset approval is the Radics GitHub review
   (Agent0 has no GitHub identity — its review runs through the Radics
   account); the merge click is always Kevin's.
3. Branch protections and rulesets change only via owner-executed API
   calls proposed first in the open (this file's lane).
4. Push rulesets stay deferred until the repo is private (GitHub allows
   them on org repos only when private); the PR #48 CI secret guard is
   the enforced fallback meanwhile.
5. Stand-up decisions (scope, milestones) are proposed by agents, ratified
   by Kevin, then filed as milestone issues before any branch starts.
