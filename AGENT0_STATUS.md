# Agent0 Status

Date: 2026-09-19

## Changed

- Built the smallest runnable Rooted / OwnPlace TypeScript demo in this workspace.
- Added protocol types, canonical JSON, deterministic SHA-256 hashes, and explicit demo-only signing metadata.
- Added `LocalFolderStore` and provider adapter scaffolds.
- Added the creator bot, which publishes the same Kinfolk story package to `nextcloud-sim` and `google-drive-sim`.
- Added the Vite/React OwnPlace UI, tests, README, architecture docs, and Google Drive authorization notes.
- Added the root Vite production `build` script.

## Run

```sh
npm install
npm run publish
npm run web
npm test
npm run build
```

Open the URL printed by Vite, normally `http://localhost:5173`.

## Passed

- Agent0 OpenCode smoke test: `OK`.
- Hostinger OpenCode smoke test: `OK`.
- `npm test`: 4 tests passed.
- `npm run publish`: passed and wrote both simulated stores.
- `npm run build`: passed.
- Recursive diff and SHA-256 comparison: all four package files match between both stores.
- Live Vite smoke test: UI and both story JSON endpoints served successfully.
- `rclone lsd rooted_drive:`: `Rooted OwnPlace Demo` is visible.

## Blocked / Deferred

- No real Nextcloud WebDAV or Google Drive API integration is enabled yet. The demo uses local-folder simulations by design.
- Real provider authorization requires a user-authorized OAuth/rclone flow and restrictive token storage, as documented in `docs/google-drive-access.md`.
- Signing and encryption are not claimed: only SHA-256 hashing is real in this demo.

## Next Actions

- If desired, authorize a dedicated `rooted_drive` OAuth/rclone remote and implement the Google Drive adapter behind the existing storage interface.
- Add WebDAV credentials through a separate, user-authorized configuration and implement the WebDAV adapter.
