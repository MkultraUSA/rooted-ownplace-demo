# Architecture

The protocol is the center of Rooted. A creator bot creates `kinfolk.json` and `story.json`, then creates a manifest containing the SHA-256 hash of each canonical JSON object. A signature envelope references the manifest hash, but is explicitly marked `demo-placeholder`; it is not a cryptographic signature. No encryption is performed in this demo.

The publisher writes those four objects through the same `ObjectStore` interface to `LocalFolderStore` instances rooted at `demo/stores/nextcloud-sim` and `demo/stores/google-drive-sim`. Since the bytes are created once and written to each store, the two packages are identical.

OwnPlace reads the two folders through Vite's static demo directory and renders them as separate simulated backends. In a deployed app, the browser/client would use a configured adapter or a local sync layer rather than trusting a public static directory.

`WebDavStore` and `GoogleDriveStore` are intentionally scaffolds. They fail loudly until a real, user-authorized implementation is supplied. This prevents the demo from implying that local folders are cloud integrations.
