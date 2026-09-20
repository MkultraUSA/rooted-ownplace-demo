# Agent0 Status: Rooted / OwnPlace demo

Date: 2026-09-20 (post PR #39). Host: srv1611290, workspace /root/.hermes/workspace/rooted-ownplace-demo. Repo: MkultraUSA/rooted-ownplace-demo (public).

## What changed (post-PR5 → post-#39)

- Web: composer + contacts + shared timeline lib (#13), session login gate for composer (#14), mobile single-column UI (#15), auth hardening follow-ups (#21, closes #18), public URL + `GET /api/health` (#22, closes #19). Web live via systemd on 127.0.0.1:8091, exposed via Tailscale serve / nginx proxy.
- Identity + trust: persistent Ed25519 Kinfolk keypairs, signed manifests, verifying client + parity path (#23, closes #20). Legacy placeholder packages rejected by verifiers.
- Timeline auth: historical reads verify manifest/signature/content hashes per package; display derives from verified history only (#26, closes #24; #25 closed superseded).
- Paid gating: slice 1 seals story bodies for one entitled reader (AES-256-GCM data key wrapped via X25519, envelope in story.json; #30, closes #29); slice 2 seals once for N readers via per-reader wrapped keys (#32, closes #31). Titles stay public; parity unaffected (same bytes to all backends).
- Docs: REVIEW-LOG ledger (#12), paid-gating design note (#16, re #9), agentic scrum lane synthesis (#17), M2 retro docs catch-up (#33, closes #27).
- Paid gating slice 3: signed entitlements.json sidecar (readerIds only, in manifest + Ed25519) + CLI multi-reader batch (#35, closes #34).
- M4: entitled-vs-wrapped cross-check fail-closed in build+verify (#38, closes #36); stale flat-copy lifecycle clears stale flat sidecar on public publish, history untouched (#39, closes #37).

## How to run

```sh
npm install
npm run publish          # sims always; kevcloud/Drive opt-in
npm run post -- --title T --body B
npm run parity            # sim backends match
npm run verify
npm test
npx tsc --noEmit
npm run build
```

Web: systemd serves dist on 127.0.0.1:8091. Writes require operator token (`OWNPLACE_WRITE_TOKEN`, session cookie; `COOKIE_SECURE=1` on HTTPS). Identities live in the operator data dir (override with `OWNPLACE_IDENTITY_DIR`) — back up private keys.

## What passed (at #39)

- `npx tsc --noEmit` exit 0. `npm test`: 59 pass, 1 skip (opt-in live WebDAV). `npm run parity`: OK (nextcloud-sim, google-drive-sim). `npm run build` exit 0. Fresh-clone proofs green at slice-3 and M4.
- Review lane: PRs #1–39, `review-findings-N` labels, 70 findings across 19 labelled PRs (plus 6 unlabelled, see REVIEW-LOG), ruleset `review-lane-main` (PR + 1 approval + green `demo` check).

## Deferred (explicit non-goals)

- Payment/entitlement oracle, per-audience parity, key server. Drive adapter still via rclone.

## Next

- M4 done. Only open issue is #9 (future paid-gating note).
- Keep lane: `radics/*` code-only (never `.github/workflows/`), blind review per PR, never commit `demo/stores/*/` or operator secrets.

No credentials in repo; operator secrets stay in VPS env only.
