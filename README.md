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

Write API auth: set `OWNPLACE_WRITE_TOKEN`; on HTTPS deploys also set `COOKIE_SECURE=1` so session cookies require TLS.

Public URL (operator): the server binds `127.0.0.1:8091`. Expose it via
Tailscale serve (`tailscale serve --bg --https=<port> http://127.0.0.1:8091`)
or an nginx `location /ownplace/` proxy with `proxy_set_header X-Forwarded-Proto $scheme`.
Reads stay public; writes still require the operator token/session.
`GET /api/health` returns `{ok:true}` for uptime checks.
Behind TLS the session cookie is marked Secure automatically
(or force with `COOKIE_SECURE=1`).

New packages use persistent Ed25519 Kinfolk identities. The publisher stores private keys in `~/.local/share/ownplace/identities/` (override with `OWNPLACE_IDENTITY_DIR`); back them up securely. `kinfolk.json` publishes the public key, and the headless Kinfolk client verifies the latest package manifest signature and content hashes. Historical timeline reads in the web app are not yet authenticated. A newly fetched public key is self-asserted: pin or verify it out of band before trusting an identity across time. Legacy demo-placeholder packages remain accessible as files, but the verifying client rejects them; republish to obtain a signed package. Content is not encrypted.

## Layout

- `packages/protocol`: Kinfolk, story, manifest, signature types and canonical hashing.
- `packages/storage`: `ObjectStore` and `LocalFolderStore`, with WebDAV and Google Drive scaffolds.
- `apps/creator-bot`: sample package publisher.
- `apps/client-sims`: headless Kinfolk clients that verify both stores (hashes, signature, cross-backend match).
- `apps/ownplace-web`: Vite/React reader for both simulations.
- `docs/architecture.md`: data flow and adapter boundary.
- `docs/google-drive-access.md`: safe future authorization procedure.
