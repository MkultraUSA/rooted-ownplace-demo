// Timeline post: builds a story package from CLI args and syndicates the
// SAME package to every configured backend (syndication = everyone).
// No per-post targeting in this milestone; paid gating is a future NOTE.
//
// Usage:
//   npm run post -- --title "Hello" --body "First post"
//   npm run post -- --title "Hello" --body "First post" --author-id kinfolk-alex --author-name "Alex Rowan"
//   PUBLISH_ROOT=/tmp/x npm run post -- --title T --body B   (isolated, for tests)
//
// Layout per backend root:
//   timeline/<storyId>/{kinfolk,story,manifest,signature}.json  (history)
//   timeline.json  (index: { stories: [{id,title,authorId,createdAt}] })
//   {kinfolk,story,manifest,signature}.json  (flat copy of latest; keeps
//     verify-feed / verify-parity / web legacy readers working)

import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
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

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const title = arg("title");
const body = arg("body");
if (!title || !title.trim() || !body || !body.trim()) {
  console.error(
    'usage: npm run post -- --title "TITLE" --body "BODY" [--author-id ID] [--author-name NAME]'
  );
  process.exit(2);
}
if (title.length > 140) {
  console.error("title too long: max 140 characters");
  process.exit(2);
}
if (body.length > 5000) {
  console.error("body too long: max 5000 characters");
  process.exit(2);
}
const authorId = arg("author-id") ?? "kinfolk-alex";
const authorName = arg("author-name") ?? "Alex Rowan";
if (!authorId.trim() || !authorName.trim()) {
  console.error("author-id and author-name must be non-empty");
  process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = process.env.PUBLISH_ROOT
  ? resolve(process.env.PUBLISH_ROOT)
  : resolve(repoRoot, "demo/stores");

const now = new Date().toISOString();
const storyId = `story-${now.slice(0, 10)}-${randomBytes(4).toString("hex")}`;
const kinfolk: Kinfolk = { id: authorId, displayName: authorName };
const story: Story = {
  id: storyId,
  title: title.trim(),
  body: body.trim(),
  media: [],
  authorId: kinfolk.id,
  createdAt: now,
};
const manifest = createManifest(storyId, [
  { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
  { path: "story.json", contentType: "application/json", value: story },
]);
const signature: Signature = {
  algorithm: "demo-placeholder",
  signedManifestSha256: hashObject(manifest),
  note: "Demo boundary only: this is not a cryptographic signature and content is not encrypted.",
};

const files: Record<string, Uint8Array> = {
  "kinfolk.json": objectBytes(kinfolk),
  "story.json": objectBytes(story),
  "manifest.json": objectBytes(manifest),
  "signature.json": objectBytes(signature),
};

interface TimelineEntry {
  id: string;
  title: string;
  authorId: string;
  createdAt: string;
}
interface TimelineIndex {
  protocol: "rooted/v0.1";
  kind: "timeline";
  updatedAt: string;
  stories: TimelineEntry[];
}

async function readIndex(store: ObjectStore): Promise<TimelineIndex> {
  try {
    const raw = new TextDecoder().decode(await store.readObject("timeline.json"));
    const parsed = JSON.parse(raw) as Partial<TimelineIndex>;
    if (parsed && Array.isArray(parsed.stories)) {
      return {
        protocol: "rooted/v0.1",
        kind: "timeline",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : now,
        stories: parsed.stories.filter(
          (s): s is TimelineEntry =>
            typeof s?.id === "string" && typeof s?.title === "string"
        ),
      };
    }
  } catch {
    // missing or corrupt index: rebuild from scratch (single entry below)
  }
  return { protocol: "rooted/v0.1", kind: "timeline", updatedAt: now, stories: [] };
}

async function publishToTimeline(label: string, store: ObjectStore): Promise<void> {
  const index = await readIndex(store);
  if (!index.stories.some((s) => s.id === storyId)) {
    index.stories.push({ id: storyId, title: story.title, authorId: story.authorId, createdAt: now });
  }
  index.stories.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  index.updatedAt = now;
  const indexBytes = new TextEncoder().encode(`${JSON.stringify(index)}\n`);
  // History first, then index, then flat latest copy.
  for (const [name, bytes] of Object.entries(files)) {
    await store.writeObject(`timeline/${storyId}/${name}`, bytes);
  }
  await store.writeObject("timeline.json", indexBytes);
  for (const [name, bytes] of Object.entries(files)) {
    await store.writeObject(name, bytes);
  }
  console.log(`posted ${storyId} to ${label} (timeline + latest)`);
}

const published: string[] = [];

// 1+2. Local sims (always; timeline accumulates, flat root = latest).
for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
  const dir = resolve(root, backend);
  await mkdir(dir, { recursive: true });
  await publishToTimeline(backend, new LocalFolderStore(dir));
  published.push(backend);
}

// 3. Real kevcloud Nextcloud over WebDAV (opt-in via env).
if (process.env.KEVCLOUD_WEBDAV_URL && process.env.KEVCLOUD_WEBDAV_USER && process.env.KEVCLOUD_WEBDAV_PASS) {
  await publishToTimeline(
    "kevcloud (WebDAV)",
    new WebDavStore({
      baseUrl: process.env.KEVCLOUD_WEBDAV_URL,
      username: process.env.KEVCLOUD_WEBDAV_USER,
      password: process.env.KEVCLOUD_WEBDAV_PASS,
    })
  );
  published.push("kevcloud");
} else {
  console.log("skip kevcloud: KEVCLOUD_WEBDAV_URL/USER/PASS not set");
}

// 4. Real Google Drive via rclone (opt-in, Hostinger): whole sim dir,
//    so timeline history syncs, not just latest.
if (process.env.GOOGLE_DRIVE_SYNC === "1") {
  const remote = process.env.GOOGLE_DRIVE_REMOTE ?? "rooted_drive:";
  const folder = process.env.GOOGLE_DRIVE_FOLDER ?? "Rooted OwnPlace Demo";
  const src = resolve(root, "google-drive-sim") + "/";
  await run("rclone", ["copy", src, `${remote}${folder}/`, "--timeout", "30s"]);
  console.log(`posted ${storyId} to google-drive (rclone ${remote}${folder}/)`);
  published.push("google-drive");
} else {
  console.log("skip google-drive: GOOGLE_DRIVE_SYNC!=1");
}

console.log(`done: ${published.join(", ")} story=${storyId} author=${authorId}`);
