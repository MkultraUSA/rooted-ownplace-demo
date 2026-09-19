# Rooted / OwnPlace OpenCode Plan

Date: 2026-09-19

## Naming

- Project and movement: Rooted
- App/product: OwnPlace
- Users/members: Kinfolk
- Adopters/customers/organizations: Rooted
- Correct human-readable prior concept name: Super Secret Social Network
- Correct slug/folder name: super-secret-social-network
- Do not use the typo "Soical" in new artifacts except when referring to the existing legacy ChatGPT project title.

## Product Thesis

Rooted is a private social system where the client and protocol matter more than the storage provider. OwnPlace should let Kinfolk keep encrypted social data in a place they control: Nextcloud, Google Drive, a local folder, or another storage backend later.

The demo should prove that the social network is not the silo. A content creator bot publishes one story package, and two separate stores receive the same content. OwnPlace then reads those stores and renders the same story from both.

## MVP Goal

Build a local-first demo repo that shows:

1. A creator bot publishes one sample story/content package.
2. The same package is written to two stores:
   - a Nextcloud-like store, initially simulated as a local folder and later backed by WebDAV;
   - a Google Drive-like store, initially simulated as a local folder and later backed by Google Drive API or rclone.
3. OwnPlace web UI reads both stores and displays the story feed.
4. The UI makes it obvious that both backends have the same signed/encrypted content.

## Suggested Stack

- TypeScript monorepo.
- Node.js for the creator bot and storage tooling.
- React + Vite for the OwnPlace web app.
- WebCrypto-compatible crypto wrapper where possible.
- Simple JSON schemas for the first protocol objects.
- Local filesystem adapters first, with clear interfaces for WebDAV and Google Drive adapters.

## Repo Shape

Create a new workspace named `rooted-ownplace-demo` unless an existing repo already exists for this exact project.

Recommended structure:

```text
rooted-ownplace-demo/
  apps/
    ownplace-web/
    creator-bot/
  packages/
    protocol/
    storage/
  demo/
    stores/
      nextcloud-sim/
      google-drive-sim/
    sample-content/
  docs/
    architecture.md
    google-drive-access.md
  README.md
```

## Protocol Draft

Start with simple content objects:

- `kinfolk.json`: local profile metadata for the demo identity.
- `story.json`: title, body, media references, author id, created timestamp.
- `manifest.json`: list of content objects, hashes, protocol version, signing metadata.
- `signature.json`: placeholder-friendly signing envelope; implement real signing if quick, otherwise document the boundary.

For the first pass, prioritize clean object boundaries and testability over perfect production crypto. Do not fake claims in the UI. If encryption/signing is only a demo placeholder, label it plainly in code/docs.

## Storage Interface

Create a shared interface with operations like:

- `listObjects(prefix)`
- `readObject(path)`
- `writeObject(path, bytes)`
- `exists(path)`

Implement:

- `LocalFolderStore` for both simulated stores.
- `WebDavStore` as a scaffold if credentials are not available.
- `GoogleDriveStore` as a scaffold if OAuth is not available.

Do not hardcode secrets, tokens, app passwords, OAuth refresh tokens, or credential-bearing URLs.

## Google Drive Access Rule

If this runs on the Hostinger VPS, set up Google Drive through a normal OAuth flow such as rclone or a Google Drive API client. The user must authorize access in the browser. Do not copy browser cookies or local tokens from another machine.

Prefer a narrow, revocable integration:

- OAuth/rclone remote dedicated to Rooted/OwnPlace.
- A dedicated Drive folder such as `Rooted OwnPlace Demo`.
- Token stored only on the VPS with restrictive file permissions.
- Documentation in `docs/google-drive-access.md` explaining how to revoke and reauthorize.

## Deliverables

1. Scaffold the monorepo.
2. Implement the protocol package with schemas/types and unit tests.
3. Implement the storage package with local folder support and tests.
4. Implement the creator bot that publishes the same sample story into both demo stores.
5. Implement the OwnPlace web app that reads and displays both stores.
6. Add a README with exact demo commands.
7. Add docs explaining the architecture and Google Drive/Nextcloud adapter plan.

## Demo Acceptance Criteria

- One command installs dependencies.
- One command publishes the sample story to both stores.
- One command starts OwnPlace web.
- The web app shows the story from both the Nextcloud-sim and Google Drive-sim stores.
- Tests pass.
- All new naming uses Rooted, OwnPlace, Kinfolk, and Super Secret Social Network correctly.
- No credentials are committed.

## Agent Instructions

Start by checking Context Forge for the Rooted / OwnPlace / Super Secret Social Network notes if the context_forge tool is available. Then build the smallest complete demo that meets the acceptance criteria above.

If blocked by missing Google Drive authorization, continue with the local Google Drive simulation and document the exact authorization step needed. Do not invent credentials and do not weaken the data ownership story to fit a shortcut.
