# Google Drive Access Plan

The repository contains no Google credentials, tokens, cookies, or credential-bearing URLs. `GoogleDriveStore` is a scaffold only.

For a future integration, authorize a dedicated Rooted / OwnPlace OAuth client or an `rclone` remote in the browser as the account owner. Use a dedicated Drive folder such as `Rooted OwnPlace Demo`, request the narrowest available scope, and store the resulting token only on the target machine with restrictive filesystem permissions. Never copy browser cookies or local token files from another machine.

To revoke access, remove the OAuth app from the Google account's third-party access page or delete the dedicated `rclone` remote/token, then remove the local token. Reauthorize through the normal browser flow when needed. The same `ObjectStore` contract means the web app and protocol do not need to change when the adapter is real.

Nextcloud follows the same boundary: use a dedicated WebDAV endpoint and an app password supplied at runtime, never committed to this repository. Until those integrations are configured, the local simulations are the supported demo path.
