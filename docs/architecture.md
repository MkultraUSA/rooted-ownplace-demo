# Architecture

The protocol is the center of Rooted. A creator bot creates `kinfolk.json` and `story.json`, then creates a manifest containing the SHA-256 hash of each canonical JSON object. Current packages sign the manifest with an Ed25519 Kinfolk identity; the signature envelope references the manifest hash. No encryption is performed in this demo. Timeline reads authenticate every history package (manifest/signature/content hashes) before display: `timeline.json` is an untrusted cache hint, and display metadata derives solely from verified `timeline/<id>/` packages. Legacy `demo-placeholder` envelopes are rejected, never displayed as authenticated. Followed local porches (M10): a timeline read also pulls each contact with a `local:` address under the stores root (the path must stay inside that root; an escaping symlink is skipped). Each porch is verified on its own, so a tampered package is excluded without failing the rest. `https:` contacts are not fetched in this slice. Entries carry an origin tag.

The publisher writes those four objects through the same `ObjectStore` interface to `LocalFolderStore` instances rooted at `demo/stores/nextcloud-sim` and `demo/stores/google-drive-sim`. Since the bytes are created once and written to each store, the two packages are identical.

OwnPlace reads the two folders through Vite's static demo directory and renders them as separate simulated backends. In a deployed app, the browser/client would use a configured adapter or a local sync layer rather than trusting a public static directory.

`WebDavStore` and `GoogleDriveStore` are intentionally scaffolds. They fail loudly until a real, user-authorized implementation is supplied. This prevents the demo from implying that local folders are cloud integrations.
