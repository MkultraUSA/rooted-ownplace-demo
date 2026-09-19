# Rooted / OwnPlace Demo

This is the smallest runnable Rooted proof: a creator bot publishes one Kinfolk story package to two independent local-folder simulations, and OwnPlace renders both copies. The storage provider is replaceable; the protocol package is shared.

## Run

Requires Node.js 18+.

```sh
npm install
npm run publish
npm run web
npm test
```

Open the URL printed by Vite (normally `http://localhost:5173`). The publish command writes `demo/stores/nextcloud-sim` and `demo/stores/google-drive-sim` identically.

Signing and encryption are deliberately not faked: the demo uses real deterministic SHA-256 content hashes, plus metadata that clearly marks signing/encryption as a future boundary.

## Layout

- `packages/protocol`: Kinfolk, story, manifest, signature types and canonical hashing.
- `packages/storage`: `ObjectStore` and `LocalFolderStore`, with WebDAV and Google Drive scaffolds.
- `apps/creator-bot`: sample package publisher.
- `apps/client-sims`: headless Kinfolk clients that verify both stores (hashes, signature, cross-backend match).
- `apps/ownplace-web`: Vite/React reader for both simulations.
- `docs/architecture.md`: data flow and adapter boundary.
- `docs/google-drive-access.md`: safe future authorization procedure.
