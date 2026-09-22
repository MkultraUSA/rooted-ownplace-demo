# Voice→action bridge (M9 #61)

Status: DESIGN ONLY. No code in this PR; build phase follows acceptance.

## Problem

Voice turns on Agent0 are transcript-only by design. Observed failure:
a "resume agent zero" class instruction transcribed cleanly in the lab
channel and nothing acted on it — the words died in the transcript.
Slack `@mention` relay works (proven 2026-09-21: AgentGPT text relayed,
stand-up opened), but anything spoken exists only as text no agent owns.

## Principles

- Explicit beats implicit. Nothing acts on background speech, TV audio,
  or unaddressed remarks. Same bar as #55 floor control: a turn belongs
  to someone or it belongs to no one.
- Voice proposes; typing disposes for anything privileged.
- Every voice turn ends in a transcript outcome line or a blocker
  report. Silence is a defect (#54 rule).

## Trigger phrases (v1)

A voice turn is actionable only when ALL hold:

1. Addressed invocation opens it: `Agent0 …`, `AgentGPT …`
   (existing `addressed_party` match), or an open floor the owner
   explicitly yielded (`@agent0 listen` beep → speech).
2. `end turn` (or accepted variant) bounds it. Unbounded speech is
   held for review, never acted on.
3. Transcription confidence is usable: no-trigger on empty,
   no-speech, or failed-listen turns — those post status only (#54).

Never triggers: unaddressed speech, third-party voices on an open mic
(TV, visitors), partial transcripts, DM text (receive path unwired —
text the channel instead).

## Routing

- Addressed to Agent0 → Agent0 session queue (this lane).
- Addressed to AgentGPT → posted to the stand-up channel for pickup.
- Unaddressed broadcast → shared transcript, no owner, no action.
- If the owning agent cannot act (offline, unclear target): a blocker
  report posts in-channel within the same turn. No silent drops.

## Auth model (voice is high privilege)

- Presence is not identity. V1 binds a voice turn to authority by:
  enrolled speaker (owner voiceprint or passphrase — build phase
  picks one) + explicit address + same-channel witnessing
  (the turn and its outcome are both visible in the lab/stand-up
  channel).
- Voice may EXECUTE directly: read-only queries, stand-up ops
  (`standup`, `status`, `say`, `listen`), blocker filings.
- Voice may only PROPOSE: merges, deploys/restarts, config changes,
  issue closes, any credential/secret-adjacent step. Proposal posts
  in-channel; execution needs typed confirmation there.
- Voice may NEVER: merge, touch credentials/secrets, change auth
  configuration, auto-merge on timers, or act from unwitnessed audio.

## Safety bounds

- Allowlist above is exhaustive for v1; anything unlisted needs a
  typed confirmation first (default-deny).
- One action per turn. Multi-step jobs return a plan + first-step
  confirmation, never a chain.
- Rate bound: max 3 voice-executed actions per 10 minutes; overage
  falls back to propose-mode with a notice.
- Rehearsal then arm: shadow (log-only) mode first, gated actions
  only after the shadow log shows zero overreach on live traffic.

## Audit

Each actionable turn appends one outcome line to the channel thread:
`heard / routed-to / executed|proposed|blocked + why`. Retained with
the meeting transcript; failures follow the #54 status format.

## Explicit non-authorizations

- No voice-started merge, deploy, or credential/secret operation.
- No action on background, visitor, TV, or partial audio.
- No DM-initiated action (receive path does not exist yet).
- No weakening of `review-lane-main` to accommodate voice speed.
- No speaker-enrollment data committed to the repo.

## Build-phase acceptance

1. Shadow log on live traffic with zero overreach.
2. The ICE-shooting-class test: multi-agency convergence proposed
   from voice, executed only after typed confirm.
3. Secrets grep clean; tsc/tests/parity/build green; blind review
   APPROVE; owner merges.
