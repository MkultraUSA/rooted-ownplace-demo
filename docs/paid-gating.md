# Paid Gating — design note (Substack-style, future work)

Status: DESIGN ONLY. M5 decided the oracle operator (#44); everything else
below stays undecided. Open syndication stays the rule until gating is
explicitly scheduled. See issue #9.

## Goal

Posts restricted to Kinfolk who paid the author via the system. Author
publishes once; only paying readers can read. Non-payers see the index
entry (title/author/timestamp) but not the body.

## Constraints from the current architecture

- Today syndication = everyone: one package, all backends, parity proves
  byte-identity. Paid gating breaks byte-identity by design (different
  readers see different bytes), so `verify-parity` will need a
  per-audience mode, not a single fingerprint. (Decided #46: single
  fingerprint while syndication is uniform; per-audience rule specified
  below, built only when gated content exists.)
- `signature.json` is a demo placeholder (demo-placeholder hash reference, not a signature — no HMAC, no Ed25519). Any
  entitlement claim must wait for real signatures — otherwise "paid"
  is unenforceable theater. Do NOT ship gating on placeholder crypto.
- Backends are dumb stores (WebDAV folders, Drive folders, rclone).
  They cannot enforce access. Enforcement must be cryptographic
  (encrypt to entitled keys), never ACL-by-folder-convention.

## Sketch (not a spec)

1. Identity first: Kinfolk get real keypairs; `kinfolk.json` carries a
   public key. No gating without this.
2. Per-post content key: author generates a random data key per story,
   encrypts the body with it (e.g. XChaCha20-Poly1305).
3. Key distribution: data key wrapped per entitled reader public key
   (or a single group key rotated on membership change). Wrapped keys
   live in `manifest.json` or a sidecar `entitlements.json`.
4. Payment hook: the author-self-hosted oracle (decided, see below)
   attests "kinfolk-X paid author-Y"; the author client includes X's
   wrapped key at next publish. Revocation = rotate group key + republish.
5. Reader flow: OwnPlace fetches package, unwraps with local private
   key, decrypts. Failure = "not entitled" UI, never a raw error.
6. Parity v2: compare index entries + per-reader ciphertext identity,
   not plaintext fingerprints. (Adopted as the per-audience rule, see
   Decision #46 — specified, not yet implemented.)

## Explicit non-goals for milestone #1

- No per-post targeting flags on `npm run post` / `/api/post`.
- No payment integration, no entitlement oracle, no key server.
- No encryption of any kind beyond the existing demo placeholder.
- This file must not be read as promising a timeline.

## Decision (M5 #44): entitlement oracle operator

Operator: author-self-hosted. The author's own Kinfolk client is the
oracle — no third party, no key server, no fund custody. Payment itself
stays fully out of band (whatever rails author and reader already use,
or in person); the oracle only records the attestation. Rationale: the
stores are dumb and enforcement is cryptographic, so no operator beyond
the author needs trust or infrastructure.

Attestation artifact (format decided, enforcement deferred): a record of
{readerId, readerPublicKey, authorId, scope, attestedAt} held by the
author client. Consumption is already implemented: attested pairs feed
the existing `--entitle-reader(s)` flow at next publish (M3 sidecar),
so the path works end to end in demo today (demo-grade only, not enforceable).

Revocation: rotate the data/group key + republish (unchanged).

Explicitly NOT authorized by this decision: payment rail integration,
escrow or custody of funds, third-party oracle operators, key servers,
backend ACL changes, and — per the placeholder-crypto constraint above —
shipping anything enforceable. Until real signatures land, attestations
are demo-grade; this decision does not green-light gating in production.

## Decision (M5 #46): per-audience parity mode

Rule: single fingerprint while every backend serves byte-identical
packages — that is today's `verify-parity` (flat package hash plus
timeline id/order comparison), unchanged. Per-audience mode takes over
only when audience-restricted (gated) stories exist, since different
readers then legitimately see different bytes and a single fingerprint
is expected to fail.

Per-audience comparison rule (specified, not implemented):
(a) public index entries (`timeline.json` ids and order) must match
across backends — metadata stays uniform; (b) within one audience,
byte-identity is required across backends holding that audience's copy
(same reader's wrapped package must hash identically everywhere);
(c) never compare plaintext across audiences — ciphertext inequality
across audiences is expected, never a mismatch.

Trigger: building parity v2 is owned by the gating schedule (issue #9).
Until the first gated story is published, single-fingerprint mode is
the whole rule. Note the current code already leans this way:
`compareTimelines` compares ids/order only, so index comparison needs
no change when per-audience mode arrives.

Explicitly NOT authorized by this decision: any change to
`verify-parity.ts` behavior, new flags or modes, and any per-audience
partitioning of store layout (that stays an open question below).

## Open questions

- [Decided #44] Oracle operator: author-self-hosted (see above).
- Group key vs per-reader wrap at scale (100s of paying readers)?
- How do offline readers receive rotations?
- Does Drive/Nextcloud folder layout need per-audience partitioning,
  or does one package with many wrapped keys suffice?
