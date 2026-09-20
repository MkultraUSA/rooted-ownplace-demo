# System Design: Agentic Scrum Lane (overnight research synthesis)

Companion to the `scrum-master` skill v2 (lives outside this repo, on the
Agent0 workstation at `~/.config/opencode/skills/scrum-master/SKILL.md` —
section references like §0/§3.6 below point there, not to files here).
What we run today, what research says to change, and what to adopt in
which order. Sources: Scrum Guide 2020,
Cohn/Mountain Goat, Scrum.org, Agile Alliance, Atlassian; Anthropic
(Building Effective Agents, Multi-Agent Research, Long-Running Harnesses,
Managed Agents, Code Migration, AI-Native SDLC, Code Review), Claude Code
docs (best practices, subagents, hooks, memory, GitHub Actions), OpenAI
Codex, Google Jules, GitHub (rulesets, CODEOWNERS, GITHUB_TOKEN, OAuth
scopes).

## 1. What we already do right (keep)

- Blind review in fresh context (matches Anthropic reviewer guidance).
- Ruleset gating + dismiss-stale + CODEOWNERS (matches GitHub best practice).
- Branch-per-task, bot-never-touches-workflows (forced by OAuth scope, but correct anyway).
- Evidence-over-assertion (parity fingerprints, fresh-clone proofs).
- Human gate at merge, never auto-merge (matches Anthropic/Jules/Codex consensus).
- Review-log + findings labels (our version of approval-signal logging).

## 2. Highest-value adoptions (in order)

1. **Session-start checklist as code** (Anthropic harness pattern): inbox →
   board walk (oldest PR first) → `git log` → tests green → then new work.
   Partly in skill §0; make it a literal script that prints the board.
2. **Reviewer severity tiers + nit cap** (Anthropic Code Review): Important /
   Nit / Pre-existing, max ~5 nits, re-review converges to Important-only.
   Cuts review latency on fixup rounds. (Now in skill §3.6.)
3. **Progress/state file in repo** (Anthropic `feature_list.json`): a
   machine-readable `lane-state.json` (milestone, open PRs, blockers) that
   any session reconstructs from — no reliance on chat memory.
4. **Stop-hook verification gate** (Claude Code hooks): a local pre-push
   check that refuses `git push` with failing tests — deterministic,
   not prompt-based. Catches what tired agents skip.
5. **Push rulesets for secrets** (GitHub): block `*.pem`, `.env*`,
   `*token*` repo-wide — structural backup for the grep rule.
6. **Merge queue** when PR volume rises (busy-branch validation without
   babysitting). Not yet needed at our volume.
7. **Session ≠ context discipline** (Managed Agents): durable session log
   outside any single agent run; never compact away the board state.
8. **Shadow-mode new reviewers + red-team inserts** (Anthropic SDLC):
   when changing reviewer prompts, run old+new in parallel once and
   compare before switching.

## 3. Deliberately NOT adopting

- Velocity/points for agents (Goodhart's law; report outcomes).
- Auto-approve on timers (Jules anti-pattern; explicit gate only).
- Combining author+reviewer context (shared blind spots).
- `GITHUB_TOKEN` for agent pushes that need CI (doesn't trigger runs;
   keep the askpass/PAT path).
- Sprint-0-style mega-setup PRs; hardening sprints (strengthen DoD instead).

## 4. Mapping to skill v2 sections (skill lives on Agent0, not in repo)

NOTE: session-checklist-as-code, reviewer tiers, and the other
adoptions above are proposals until each lands as its own PR.

Session checklist → §0; DEEP/INVEST/Ready/Done → §2; lifecycle+tiers → §3;
judge-first verification → §4; impediments → §5; async events → §6;
metrics → §7; Telegram → §8; closeout → §9; review-log → §10.
