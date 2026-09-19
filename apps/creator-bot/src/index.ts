// Cloud publisher: writes the SAME story package to all configured backends:
//   1. demo/stores/nextcloud-sim  (LocalFolderStore)
//   2. demo/stores/google-drive-sim (LocalFolderStore)
//   3. kevcloud Nextcloud (WebDavStore) — only when KEVCLOUD_* env is set
//   4. Google Drive via rclone (execFile, rooted_drive:) — only when
//      GOOGLE_DRIVE_SYNC=1 and rclone remote exists (Hostinger).
// Credentials: env only, never committed. Skipped backends are reported,
// never faked — verify-parity checks only backends that published.

import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createManifest,
  hashObject,
  objectBytes,
  type Kinfolk,
  type Story,
  type Signature,
} from "@rooted/protocol";
import { LocalFolderStore, WebDavStore, type ObjectStore } from "@rooted/storage";

const run = promisify(execFile);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = process.env.PUBLISH_ROOT
  ? resolve(process.env.PUBLISH_ROOT)
  : resolve(repoRoot, "demo/stores");

const kinfolk: Kinfolk = {
  id: "kinfolk-alex",
  displayName: "Alex Rowan",
  bio: "Building a more rooted internet.",
};
const story: Story = {
  id: "story-first-light",
  title: "First light at the workshop",
  body: "A small place can hold a big beginning. Today we opened the doors, shared a meal, and made room for one another.",
  media: [],
  authorId: kinfolk.id,
  createdAt: "2026-09-19T09:00:00.000Z",
};
const packageId = "rooted-demo-first-light";
const content = [
  { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
  { path: "story.json", contentType: "application/json", value: story },
];
const manifest = createManifest(packageId, content);
const signature: Signature = {
  algorithm: "demo-placeholder",
  signedManifestSha256: hashObject(manifest),
  note: "Demo boundary only: this is not a cryptographic signature and content is not encrypted.",
};

const files: Record<string, Uint8Array> = {};
for (const object of content) files[object.path] = objectBytes(object.value);
files["manifest.json"] = objectBytes(manifest);
files["signature.json"] = objectBytes(signature);

async function publishTo(label: string, store: ObjectStore): Promise<void> {
  for (const [name, bytes] of Object.entries(files)) {
    await store.writeObject(name, bytes);
  }
  console.log(`published ${packageId} to ${label}`);
}

const published: string[] = [];

// 1+2. Local sims (always; rm+mkdir keeps them byte-identical).
for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
  const dir = resolve(root, backend);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await publishTo(backend, new LocalFolderStore(dir));
  published.push(backend);
}

// 3. Real kevcloud Nextcloud over WebDAV (opt-in via env).
if (process.env.KEVCLOUD_WEBDAV_URL && process.env.KEVCLOUD_WEBDAV_USER && process.env.KEVCLOUD_WEBDAV_PASS) {
  const store = new WebDavStore({
    baseUrl: process.env.KEVCLOUD_WEBDAV_URL,
    username: process.env.KEVCLOUD_WEBDAV_USER,
    password: process.env.KEVCLOUD_WEBDAV_PASS,
  });
  await publishTo("kevcloud (WebDAV)", store);
  published.push("kevcloud");
} else {
  console.log("skip kevcloud: KEVCLOUD_WEBDAV_URL/USER/PASS not set");
}

// 4. Real Google Drive via rclone (opt-in, Hostinger).
if (process.env.GOOGLE_DRIVE_SYNC === "1") {
  const remote = process.env.GOOGLE_DRIVE_REMOTE ?? "rooted_drive:";
  const folder = process.env.GOOGLE_DRIVE_FOLDER ?? "Rooted OwnPlace Demo";
  const src = resolve(root, "google-drive-sim") + "/";
  await run("rclone", ["copy", src, `${remote}${folder}/`, "--timeout", "30s"]);
  console.log(`published ${packageId} to google-drive (rclone ${remote}${folder}/)`);
  published.push("google-drive");
} else {
  console.log("skip google-drive: GOOGLE_DRIVE_SYNC!=1");
}

console.log(`done: ${published.join(", ")}`);
