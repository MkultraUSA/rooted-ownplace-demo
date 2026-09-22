# Voice→action bridge (M9 #61)

Status: DESIGN ONLY. No code in this PR; build phase follows acceptance.

## Problem

Voice turns on Agent0 are transcript-only by design. Observed failure:
a "resume agent zero" class instruction transcribed cleanly in the lab
channel and nothing acted on it — the words died in the transcript.
Slack `@mention` relay was demonstrated in the 2026-09-21 lab session
(stand-up opener posted, ts 1790043994); transcript retention is the
channel's own history. The bridge adds outcome lines, not a new store.

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
2. The first utterance still carries the address — including after an
   open-floor beep. Address-free speech (TV, visitors, background) is
   held for review, never acted on.
3. `end turn` (or accepted variant) bounds it. End-turn variants and
   usable-confidence are exactly those accepted under #55 (strip
   parity; empty/failed turns post status only, never act). Partial =
   any turn without a bounded end (no variant, no safety timeout);
   partial turns are held, never executed.
4. Dual address in one turn (`Agent0 … AgentGPT …`) → clarify turn:
   no action, the agent asks which of them is meant.

Never triggers: unaddressed speech, third-party voices, partial
transcripts, DM text (receive path unwired — use the channel).

## Routing

- Addressed to Agent0 → Agent0 session queue (this lane).
- Addressed to AgentGPT → posted to the stand-up channel for pickup.
- Unaddressed broadcast → shared transcript, no owner, no action.
- If the owning agent cannot act (offline, unclear target): a blocker
  report posts in-channel within the same turn. No silent drops.

## Auth model (voice is high privilege)

- Presence is not identity. V1 binds a voice turn to authority by:
  enrolled speaker + explicit address + same-channel witnessing
  (deterrence and audit — not an independent identity check).
- Execute-tier additionally requires a fresh per-turn challenge:
  after the beep the agent speaks a short nonce word the speaker
  must repeat in-turn. Recorded owner audio cannot answer a fresh
  nonce. Propose-tier needs no challenge.
- Enrollment material lives owner-side only (never the repo, never
  chat); revocation is a typed owner command acknowledged in-channel.
- Voice may EXECUTE directly, least-privilege bounded: read-only
  queries against named safe surfaces (status, board readouts,
  transcript search — never secret-bearing stores); `say` capped at
  600 chars (existing speak cap); `standup` / `status` / `listen`,
  which are idempotent and side-effect-free by construction.
- Voice may only PROPOSE: merges, deploys/restarts, config changes,
  issue closes, any credential/secret-adjacent step. Proposing means
  drafting the request text in-channel; the completing action is
  always typed there, never spoken.
- Voice may NEVER complete: merges, deploys, closes, credential or
  secret operations, auth configuration changes, timer-based
  auto-merges, or actions from unwitnessed audio.

## Safety bounds

- The execute list above is exhaustive for v1; anything unlisted
  needs typed confirmation first (default-deny).
- One action per turn. Multi-step jobs return a plan + first-step
  confirmation, never a chain.
- Rate bound: max 3 voice-executed actions per channel per
  10 minutes, all speakers combined; overage falls back to
  propose-mode with a notice.
- Rehearsal then arm: shadow (log-only) mode first over at least 50
  live turns, adjudicated by the owner against the execute list.
  Overreach = any executed action outside the list, any action from
  an unaddressed/partial turn, or any unwitnessed action. Zero
  overreach before gated actions arm.

## Audit

Each actionable turn appends one outcome line to the channel thread:
`heard / routed-to / executed|proposed|blocked + why`. Retained with
the meeting transcript; failures follow the #54 status format.

## Explicit non-authorizations

- No voice-completed merge, deploy, close, credential, secret, or
  auth-config operation.
- No action on background, visitor, TV, or partial audio.
- No DM-initiated action (receive path does not exist yet).
- No weakening of `review-lane-main` to accommodate voice speed.
- No speaker-enrollment data committed to the repo.

## Build-phase acceptance

1. Shadow log (50+ turns, owner-adjudicated) with zero overreach.
2. Tabletop replay of an ICE-shooting-class fixture (multi-agency
   convergence incl. air assets): voice proposes the assembly,
   typed confirm completes it; scored against the overreach
   definition — a recorded-fixture exercise, not a live re-run.
3. Secrets grep clean; tsc/tests/parity/build green; blind review
   APPROVE; owner merges.
