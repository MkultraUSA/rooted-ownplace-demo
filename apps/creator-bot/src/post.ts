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

import { mkdir } from "node:fs/promises";
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
  if (idx < 0) return undefined;
  const value = process.argv[idx + 1];
  // A missing value (end of args or another --flag) must not be swallowed:
  // `--title --body x` must fail, not post a story titled "--body".
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

const title = arg("title");
const body = arg("body");
if (!title || !title.trim() || !body || !body.trim()) {
  console.error(
    'usage: npm run post -- --title "TITLE" --body "BODY" [--author-id ID] [--author-name NAME]'
  );
  process.exit(2);
}
const cleanTitle = title.trim();
const cleanBody = body.trim();
if (cleanTitle.length > 140) {
  console.error("title too long: max 140 characters");
  process.exit(2);
}
if (cleanBody.length > 5000) {
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
  title: cleanTitle,
  body: cleanBody,
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

function isEntry(s: unknown): s is TimelineEntry {
  if (typeof s !== "object" || s === null) return false;
  const e = s as Record<string, unknown>;
  return (
    typeof e.id === "string" && e.id.length > 0 &&
    typeof e.title === "string" &&
    typeof e.authorId === "string" && e.authorId.length > 0 &&
    typeof e.createdAt === "string" && !Number.isNaN(Date.parse(e.createdAt))
  );
}

// Rebuild the index from on-disk history: list timeline/<id>/story.json
// objects via the store interface (works for local + WebDAV alike).
async function rebuildIndex(store: ObjectStore, label: string): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];
  let paths: string[] = [];
  try {
    paths = await store.listObjects("timeline/");
  } catch {
    return entries;
  }
  const ids = [...new Set(
    paths.map((p) => p.split("/")[1]).filter((id) => typeof id === "string" && id.length > 0)
  )];
  for (const id of ids) {
    try {
      const story = JSON.parse(
        new TextDecoder().decode(await store.readObject(`timeline/${id}/story.json`))
      ) as Partial<Story>;
      if (typeof story?.id === "string" && typeof story?.title === "string" &&
          typeof story?.authorId === "string" && typeof story?.createdAt === "string") {
        entries.push({ id: story.id, title: story.title, authorId: story.authorId, createdAt: story.createdAt });
      }
    } catch {
      // unreadable history entry: skip, never fail the whole rebuild
    }
  }
  if (entries.length > 0) console.log(`rebuilt ${label} index from ${entries.length} on-disk ${entries.length === 1 ? "story" : "stories"}`);
  return entries;
}

function sortTimeline(stories: TimelineEntry[]): void {
  stories.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function readIndex(store: ObjectStore, label: string): Promise<TimelineIndex> {
  try {
    const raw = new TextDecoder().decode(await store.readObject("timeline.json"));
    const parsed = JSON.parse(raw) as Partial<TimelineIndex>;
    if (parsed && Array.isArray(parsed.stories)) {
      return {
        protocol: "rooted/v0.1",
        kind: "timeline",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : now,
        stories: parsed.stories.filter(isEntry),
      };
    }
  } catch {
    // missing or unreadable index: fall through to rebuild
  }
  // Missing/corrupt index must not orphan on-disk history: rebuild it.
  const rebuilt = await rebuildIndex(store, label);
  return { protocol: "rooted/v0.1", kind: "timeline", updatedAt: now, stories: rebuilt };
}

async function publishToTimeline(label: string, store: ObjectStore): Promise<void> {
  const index = await readIndex(store, label);
  if (!index.stories.some((s) => s.id === storyId)) {
    index.stories.push({ id: storyId, title: story.title, authorId: story.authorId, createdAt: now });
  }
  sortTimeline(index.stories);
  index.updatedAt = now;
  const indexBytes = new TextEncoder().encode(`${JSON.stringify(index)}\n`);
  // History first, then flat latest copy, then the index last: a crash can
  // only leave the index behind the data, never ahead of it (legacy readers
  // use the flat copy, so they stay consistent).
  for (const [name, bytes] of Object.entries(files)) {
    await store.writeObject(`timeline/${storyId}/${name}`, bytes);
  }
  for (const [name, bytes] of Object.entries(files)) {
    await store.writeObject(name, bytes);
  }
  await store.writeObject("timeline.json", indexBytes);
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
  await run("rclone", ["copy", src, `${remote}${folder}/`, "--timeout", "30s"],
    { timeout: 90000 }); // execFile-level guard: never hang the CLI on a stuck remote
  console.log(`posted ${storyId} to google-drive (rclone ${remote}${folder}/)`);
  published.push("google-drive");
} else {
  console.log("skip google-drive: GOOGLE_DRIVE_SYNC!=1");
}

console.log(`done: ${published.join(", ")} story=${storyId} author=${authorId}`);
