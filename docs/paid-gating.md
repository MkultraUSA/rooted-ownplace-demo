# Paid Gating — design note (Substack-style, future work)

Status: DESIGN ONLY. Not in milestone #1. Open syndication stays the rule
until this is explicitly scheduled. See issue #9.

## Goal

Posts restricted to Kinfolk who paid the author via the system. Author
publishes once; only paying readers can read. Non-payers see the index
entry (title/author/timestamp) but not the body.

## Constraints from the current architecture

- Today syndication = everyone: one package, all backends, parity proves
  byte-identity. Paid gating breaks byte-identity by design (different
  readers see different bytes), so `verify-parity` will need a
  per-audience mode, not a single fingerprint.
- `signature.json` is a demo placeholder (HMAC, not Ed25519). Any
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
4. Payment hook: an entitlement oracle (out of band for now) attests
   "kinfolk-X paid author-Y"; the author client includes X's wrapped
   key at next publish. Revocation = rotate group key + republish.
5. Reader flow: OwnPlace fetches package, unwraps with local private
   key, decrypts. Failure = "not entitled" UI, never a raw error.
6. Parity v2: compare index entries + per-reader ciphertext identity,
   not plaintext fingerprints.

## Explicit non-goals for milestone #1

- No per-post targeting flags on `npm run post` / `/api/post`.
- No payment integration, no entitlement oracle, no key server.
- No encryption of any kind beyond the existing demo placeholder.
- This file must not be read as promising a timeline.

## Open questions

- Who runs the payment/entitlement oracle? (Self-hosted? Third party?)
- Group key vs per-reader wrap at scale (100s of paying readers)?
- How do offline readers receive rotations?
- Does Drive/Nextcloud folder layout need per-audience partitioning,
  or does one package with many wrapped keys suffice?
