# Agent0 Status: Rooted / OwnPlace demo

Date: 2026-09-19 (updated post PR #5). Host: srv1611290, workspace /root/.hermes/workspace/rooted-ownplace-demo. Repo: MkultraUSA/rooted-ownplace-demo (public).

## What works now

- TypeScript monorepo: protocol (canonical JSON, SHA-256, demo-placeholder signing), storage (LocalFolderStore + real WebDavStore + Drive scaffold), creator-bot, client-sims, OwnPlace web (React+Vite).
- `npm run publish`: sims always; kevcloud WebDAV when KEVCLOUD_* set; Drive via rclone when GOOGLE_DRIVE_SYNC=1. Skips reported, never faked.
- `npm run parity`: 4-way fingerprint match across nextcloud-sim, google-drive-sim, kevcloud, google-drive. Proven live: identical fingerprint on all 4.
- `npm run verify`: sim-only cross-check. `npm test`: 13 pass + 1 skip (opt-in live kevcloud test). `tsc --noEmit` clean. `npm run build` clean.
- ownplace-web.service (systemd): serves dist on 127.0.0.1:8091, enabled, Restart=always.
- Live backends: kevcloud `Rooted-OwnPlace-Demo/` (Nextcloud 33.0.9, WebDAV 207/201), Drive `Rooted OwnPlace Demo` (rclone rooted_drive:, scope drive.file).

## Review lane (proven over PRs #1-5)

- Radics pushes `radics/*` branches (code only — never `.github/workflows/`, house rule; Radics token lacks `workflow` scope, MkultraUSA owns CI config).
- Independent blind review per PR (REQUEST-CHANGES twice, all findings fixed, re-review APPROVED).
- Ruleset `review-lane-main`: PR + 1 approving review + green `demo` check + no force-push/deletion on main.
- CI (`.github/workflows/ci.yml`): npm ci, tsc, test, publish, verify, diff -r, build on Node 20.
- Telegram (@nukOmarchybot) pings MkultraUSA (id 5167192433) on PR-ready/merge-verified.

## Credentials

None in repo. Drive token: /root/.config/rclone/rclone.conf (600, VPS only). kevcloud app password: local Agent0 rclone.conf only, passed via SSH env for one-shot publishes. Telegram token: chat + Hostinger env only.

## Naming

Rooted (project), OwnPlace (app), Kinfolk (users), Super Secret Social Network (prior concept). No "Soical" typo.

## Next

- WebDAV hardening follow-ups (prefix-slice, decode-once, probe cleanup).
- Public URL for OwnPlace web (nginx location or Tailscale serve).
- Real remote-merge from Telegram (currently verify-only).
