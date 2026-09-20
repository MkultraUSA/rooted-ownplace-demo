// Shared timeline library: story package construction, index read/rebuild,
// and syndication to every configured backend. Used by the CLI (`post.ts`)
// and the web write API (`apps/ownplace-web/src/server.ts`) so both write
// through the SAME lane. No per-post targeting; paid gating is future work.

import { randomBytes } from "node:crypto";
import {
  createManifest,
  hashObject,
  loadOrCreateIdentity,
  signManifest,
  verifyManifestSignature,
  objectBytes,
  type Kinfolk,
  type Story,
} from "@rooted/protocol";
import { LocalFolderStore, WebDavStore, type ObjectStore } from "@rooted/storage";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface TimelineEntry {
  id: string;
  title: string;
  authorId: string;
  createdAt: string;
  verified?: boolean;
}
export interface TimelineIndex {
  protocol: "rooted/v0.1";
  kind: "timeline";
  updatedAt: string;
  stories: TimelineEntry[];
  skipped?: { id: string; reason: string }[];
}

export interface Contact {
  id: string;
  displayName: string;
  addedAt: string;
}
export interface ContactList {
  protocol: "rooted/v0.1";
  kind: "contacts";
  updatedAt: string;
  contacts: Contact[];
}

export interface StoryInput {
  title: string;
  body: string;
  authorId?: string;
  authorName?: string;
  createdAt?: string;
}

export interface PublishResult {
  storyId: string;
  authorId: string;
  backends: string[];
  skipped: string[];
}

export const TITLE_MAX = 140;
export const BODY_MAX = 5000;

export function validateInput(input: StoryInput): { title: string; body: string; authorId: string; authorName: string } {
  const { title, body } = input;
  if (typeof title !== "string" || !title.trim() || typeof body !== "string" || !body.trim()) {
    throw new Error("title and body are required and must be non-empty");
  }
  const cleanTitle = title.trim();
  const cleanBody = body.trim();
  if (cleanTitle.length > TITLE_MAX) throw new Error(`title too long: max ${TITLE_MAX} characters`);
  if (cleanBody.length > BODY_MAX) throw new Error(`body too long: max ${BODY_MAX} characters`);
  if (input.authorId !== undefined && typeof input.authorId !== "string") throw new Error("author-id must be a string");
  if (input.authorName !== undefined && typeof input.authorName !== "string") throw new Error("author-name must be a string");
  const rawAuthorId = typeof input.authorId === "string" ? input.authorId : "kinfolk-alex";
  const rawAuthorName = typeof input.authorName === "string" ? input.authorName : "Alex Rowan";
  const authorId = rawAuthorId.trim();
  const authorName = rawAuthorName.trim();
  if (!authorId || !authorName) throw new Error("author-id and author-name must be non-empty");
  if (authorId.includes("/") || authorId.includes("\\") || authorId.includes("..")) {
    throw new Error("author-id contains unsafe characters");
  }
  return { title: cleanTitle, body: cleanBody, authorId, authorName };
}

export function isEntry(s: unknown): s is TimelineEntry {
  if (typeof s !== "object" || s === null) return false;
  const e = s as Record<string, unknown>;
  return (
    typeof e.id === "string" && e.id.length > 0 &&
    typeof e.title === "string" &&
    typeof e.authorId === "string" && e.authorId.length > 0 &&
    typeof e.createdAt === "string" && !Number.isNaN(Date.parse(e.createdAt))
  );
}

export function sortTimeline(stories: TimelineEntry[]): void {
  stories.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function isSafeHistoryId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id);
}

const HISTORY_FILES = ["kinfolk.json", "story.json", "manifest.json", "signature.json"] as const;

function collectHistoryProblems(parsed: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const manifest = parsed["manifest.json"] as
    | { objects?: unknown; signing?: unknown; packageId?: unknown }
    | undefined;
  const signature = parsed["signature.json"] as { signedManifestSha256?: unknown } | undefined;
  if (manifest && Array.isArray(manifest.objects)) {
    const names = (manifest.objects as { path?: unknown }[]).map((o) => o?.path);
    for (const required of ["kinfolk.json", "story.json"]) {
      if (names.filter((name) => name === required).length !== 1) {
        problems.push(`manifest must list ${required} exactly once`);
      }
    }
    for (const obj of manifest.objects as { path?: unknown; sha256?: unknown }[]) {
      if (typeof obj?.path !== "string" || typeof obj?.sha256 !== "string") {
        problems.push("manifest has malformed object entry");
        continue;
      }
      const content = parsed[obj.path];
      if (content === undefined) {
        problems.push(`manifest lists ${obj.path} but it is missing`);
        continue;
      }
      if (hashObject(content) !== obj.sha256) problems.push(`hash mismatch: ${obj.path}`);
    }
  } else if (parsed["manifest.json"] !== undefined) {
    problems.push("manifest is malformed: objects is not an array");
  }
  if (manifest && signature) {
    if (typeof signature.signedManifestSha256 !== "string") {
      problems.push("signature is malformed: signedManifestSha256 is not a string");
    } else if (signature.signedManifestSha256 !== hashObject(manifest)) {
      problems.push("signature does not match manifest");
    } else if ((manifest as { signing?: string }).signing !== "ed25519") {
      // Legacy demo-placeholder envelopes are readable files, never trust.
      problems.push("package is not Ed25519 signed");
    } else if (!verifyManifestSignature(manifest, signature, parsed["kinfolk.json"])) {
      problems.push("Ed25519 signature verification failed");
    }
  }
  const kinfolk = parsed["kinfolk.json"] as { id?: unknown } | undefined;
  const story = parsed["story.json"] as { authorId?: unknown } | undefined;
  if (kinfolk && story && (typeof kinfolk.id !== "string" || story.authorId !== kinfolk.id)) {
    problems.push("story author does not match Kinfolk identity");
  }
  if (!manifest || !signature || !kinfolk || !story) problems.push("incomplete package");
  return problems;
}

export interface VerifiedHistoryPackage {
  kinfolk: Kinfolk;
  story: Story;
  manifest: Record<string, unknown> & { packageId: string };
  signature: Record<string, unknown>;
}

// Verify one historical story package before display. Rejects missing or
// tampered signatures and legacy demo-placeholder downgrades.
export async function fetchVerifiedHistoryPackage(store: ObjectStore, id: string): Promise<VerifiedHistoryPackage> {
  if (!isSafeHistoryId(id)) throw new Error(`${id}: unsafe story id`);
  const parsed: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const f of HISTORY_FILES) {
    let text: string;
    try {
      text = new TextDecoder().decode(await store.readObject(`timeline/${id}/${f}`));
    } catch (e) {
      problems.push(`missing unreadable file: ${f} (${(e as Error).message})`);
      continue;
    }
    try {
      parsed[f] = JSON.parse(text);
    } catch {
      problems.push(`invalid JSON: ${f}`);
    }
  }
  problems.push(...collectHistoryProblems(parsed));
  if (problems.length) throw new Error(`${id}: ${problems.join("; ")}`);
  return {
    kinfolk: parsed["kinfolk.json"] as Kinfolk,
    story: parsed["story.json"] as Story,
    manifest: parsed["manifest.json"] as VerifiedHistoryPackage["manifest"],
    signature: parsed["signature.json"] as Record<string, unknown>,
  };
}

export async function readVerifiedHistoryStory(store: ObjectStore, id: string): Promise<Story> {
  return (await fetchVerifiedHistoryPackage(store, id)).story;
}

export async function rebuildIndex(store: ObjectStore, label: string): Promise<TimelineEntry[]> {
  return (await readAuthenticatedTimeline(store, label, new Date().toISOString())).index.stories;
}

// Authenticated timeline read: timeline.json is an untrusted cache hint and
// is never used for display. Entries derive solely from verified history
// packages; tampered, unsigned, or legacy-placeholder entries are skipped.
export async function readAuthenticatedTimeline(
  store: ObjectStore, label: string, now: string
): Promise<{ index: TimelineIndex; skipped: { id: string; reason: string }[] }> {
  const entries: TimelineEntry[] = [];
  const skipped: { id: string; reason: string }[] = [];
  let paths: string[] = [];
  try {
    paths = await store.listObjects("timeline/");
  } catch {
    return { index: { protocol: "rooted/v0.1", kind: "timeline", updatedAt: now, stories: entries, skipped }, skipped };
  }
  const ids = [...new Set(
    paths.map((p) => p.split("/")[1]).filter((id) => typeof id === "string" && id.length > 0)
  )];
  for (const id of ids) {
    try {
      const pkg = await fetchVerifiedHistoryPackage(store, id);
      const story = pkg.story as Partial<Story>;
      if (typeof story?.id === "string" && typeof story?.title === "string" &&
          typeof story?.authorId === "string" && typeof story?.createdAt === "string" &&
          !Number.isNaN(Date.parse(story.createdAt))) {
        entries.push({ id: story.id, title: story.title, authorId: story.authorId, createdAt: story.createdAt, verified: true });
      } else {
        skipped.push({ id, reason: "verified package has malformed story fields" });
      }
    } catch (e) {
      // Unverified history entry: skip, never fail the whole read.
      skipped.push({ id, reason: (e as Error).message });
    }
  }
  sortTimeline(entries);
  if (skipped.length > 0) {
    console.log(`rebuilt ${label} index from ${entries.length} verified on-disk ${entries.length === 1 ? "story" : "stories"} (${skipped.length} unverified skipped)`);
  } else if (entries.length > 0) {
    console.log(`rebuilt ${label} index from ${entries.length} on-disk ${entries.length === 1 ? "story" : "stories"}`);
  }
  return { index: { protocol: "rooted/v0.1", kind: "timeline", updatedAt: now, stories: entries, skipped }, skipped };
}

export async function readIndex(store: ObjectStore, label: string, now: string): Promise<TimelineIndex> {
  // Authenticated: derive display metadata from verified history packages
  // rather than trusting unsigned timeline.json values.
  return (await readAuthenticatedTimeline(store, label, now)).index;
}

export function buildPackage(input: { title: string; body: string; authorId: string; authorName: string; createdAt: string; storyId: string }) {
  const identity = loadOrCreateIdentity(input.authorId);
  const kinfolk: Kinfolk = { id: input.authorId, displayName: input.authorName, publicKey: identity.publicKey };
  const story: Story = {
    id: input.storyId,
    title: input.title,
    body: input.body,
    media: [],
    authorId: kinfolk.id,
    createdAt: input.createdAt,
  };
  const manifest = createManifest(input.storyId, [
    { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
    { path: "story.json", contentType: "application/json", value: story },
  ], "ed25519");
  const signature = signManifest(manifest, identity.privateKey);
  const files: Record<string, Uint8Array> = {
    "kinfolk.json": objectBytes(kinfolk),
    "story.json": objectBytes(story),
    "manifest.json": objectBytes(manifest),
    "signature.json": objectBytes(signature),
  };
  return { kinfolk, story, manifest, signature, files };
}

export function makeStoryId(now: string): string {
  return `story-${now.slice(0, 10)}-${randomBytes(4).toString("hex")}`;
}

async function publishToTimeline(
  label: string,
  store: ObjectStore,
  storyId: string,
  story: Story,
  files: Record<string, Uint8Array>,
  now: string
): Promise<void> {
  const index = await readIndex(store, label, now);
  if (!index.stories.some((s) => s.id === storyId)) {
    index.stories.push({ id: storyId, title: story.title, authorId: story.authorId, createdAt: now, verified: true });
  }
  sortTimeline(index.stories);
  index.updatedAt = now;
  const indexBytes = new TextEncoder().encode(`${JSON.stringify(index)}\n`);
  // History first, then flat latest copy, then the index last: a crash can
  // only leave the index behind the data, never ahead of it.
  for (const [name, bytes] of Object.entries(files)) {
    await store.writeObject(`timeline/${storyId}/${name}`, bytes);
  }
  for (const [name, bytes] of Object.entries(files)) {
    await store.writeObject(name, bytes);
  }
  await store.writeObject("timeline.json", indexBytes);
  console.log(`posted ${storyId} to ${label} (timeline + latest)`);
}

export interface BackendSet {
  root: string;
  kevcloud?: { baseUrl: string; username: string; password: string };
  drive?: { remote: string; folder: string };
}

export function backendsFromEnv(repoRoot: string): BackendSet {
  const root = process.env.PUBLISH_ROOT
    ? resolve(process.env.PUBLISH_ROOT)
    : resolve(repoRoot, "demo/stores");
  const out: BackendSet = { root };
  if (process.env.KEVCLOUD_WEBDAV_URL && process.env.KEVCLOUD_WEBDAV_USER && process.env.KEVCLOUD_WEBDAV_PASS) {
    out.kevcloud = {
      baseUrl: process.env.KEVCLOUD_WEBDAV_URL,
      username: process.env.KEVCLOUD_WEBDAV_USER,
      password: process.env.KEVCLOUD_WEBDAV_PASS,
    };
  }
  if (process.env.GOOGLE_DRIVE_SYNC === "1") {
    out.drive = {
      remote: process.env.GOOGLE_DRIVE_REMOTE ?? "rooted_drive:",
      folder: process.env.GOOGLE_DRIVE_FOLDER ?? "Rooted OwnPlace Demo",
    };
  }
  return out;
}

/** Syndicate one validated story to every configured backend. */
export async function publishStory(
  validated: { title: string; body: string; authorId: string; authorName: string },
  backends: BackendSet,
  opts: { createdAt?: string; storyId?: string } = {}
): Promise<PublishResult> {
  const now = opts.createdAt ?? new Date().toISOString();
  const storyId = opts.storyId ?? makeStoryId(now);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(storyId)) throw new Error("unsafe story id");
  const { files, story } = buildPackage({ ...validated, createdAt: now, storyId });
  const published: string[] = [];
  const skipped: string[] = [];

  for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
    const dir = resolve(backends.root, backend);
    await mkdir(dir, { recursive: true });
    await publishToTimeline(backend, new LocalFolderStore(dir), storyId, story, files, now);
    published.push(backend);
  }

  if (backends.kevcloud) {
    await publishToTimeline(
      "kevcloud (WebDAV)",
      new WebDavStore({ ...backends.kevcloud }),
      storyId, story, files, now
    );
    published.push("kevcloud");
  } else {
    skipped.push("kevcloud");
    console.log("skip kevcloud: KEVCLOUD_WEBDAV_URL/USER/PASS not set");
  }

  if (backends.drive) {
    const src = resolve(backends.root, "google-drive-sim") + "/";
    await run("rclone", ["copy", src, `${backends.drive.remote}${backends.drive.folder}/`, "--timeout", "30s"],
      { timeout: 90000 });
    console.log(`posted ${storyId} to google-drive (rclone ${backends.drive.remote}${backends.drive.folder}/)`);
    published.push("google-drive");
  } else {
    skipped.push("google-drive");
    console.log("skip google-drive: GOOGLE_DRIVE_SYNC!=1");
  }

  return { storyId, authorId: validated.authorId, backends: published, skipped };
}

// --- Contacts (syndication address book) ---

export function validateContact(input: { id?: unknown; displayName?: unknown }): Contact {
  if (typeof input?.id !== "string" || !input.id.trim()) throw new Error("contact id is required");
  if (typeof input?.displayName !== "string" || !input.displayName.trim()) {
    throw new Error("contact displayName is required");
  }
  const id = input.id.trim();
  if (id.includes("/") || id.includes("\\") || id.includes("..") || id.length > 120) {
    throw new Error("contact id contains unsafe characters");
  }
  if (input.displayName.trim().length > 120) throw new Error("contact displayName too long");
  return { id, displayName: input.displayName.trim(), addedAt: new Date().toISOString() };
}

export async function readContacts(store: ObjectStore): Promise<ContactList> {
  try {
    const raw = new TextDecoder().decode(await store.readObject("contacts.json"));
    const parsed = JSON.parse(raw) as Partial<ContactList>;
    if (parsed && Array.isArray(parsed.contacts)) {
      const contacts = parsed.contacts.filter(
        (c): c is Contact =>
          typeof c?.id === "string" && typeof c?.displayName === "string"
      );
      return {
        protocol: "rooted/v0.1",
        kind: "contacts",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        contacts,
      };
    }
  } catch {
    // missing/unreadable: empty list
  }
  return { protocol: "rooted/v0.1", kind: "contacts", updatedAt: new Date().toISOString(), contacts: [] };
}

export async function addContact(store: ObjectStore, contact: Contact): Promise<ContactList> {
  const list = await readContacts(store);
  if (!list.contacts.some((c) => c.id === contact.id)) list.contacts.push(contact);
  list.contacts.sort((a, b) => a.displayName.localeCompare(b.displayName));
  list.updatedAt = new Date().toISOString();
  await store.writeObject("contacts.json", new TextEncoder().encode(`${JSON.stringify(list)}\n`));
  return list;
}

export async function removeContact(store: ObjectStore, id: string): Promise<ContactList> {
  const list = await readContacts(store);
  list.contacts = list.contacts.filter((c) => c.id !== id);
  list.updatedAt = new Date().toISOString();
  await store.writeObject("contacts.json", new TextEncoder().encode(`${JSON.stringify(list)}\n`));
  return list;
}

export function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}
