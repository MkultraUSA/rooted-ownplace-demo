import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFolderStore } from "@rooted/storage";
import {
  addContact,
  backendsFromEnv,
  buildPackage,
  publishStory,
  readContacts,
  removeContact,
  validateContact,
  validateInput,
} from "../src/index.js";

test("validateInput trims and enforces caps", () => {
  const v = validateInput({ title: "  Hi  ", body: "yo" });
  assert.equal(v.title, "Hi");
  assert.throws(() => validateInput({ title: "", body: "x" }), /required/);
  assert.throws(() => validateInput({ title: "x".repeat(141), body: "ok" }), /too long/);
  assert.throws(() => validateInput({ title: "ok", body: "x".repeat(5001) }), /too long/);
  assert.throws(() => validateInput({ title: "t", body: "b", authorId: "../evil" }), /unsafe/);
  assert.throws(() => validateInput({ title: "t", body: "b", authorId: 42 as unknown as string }), /must be a string/);
  assert.throws(() => validateInput({ title: "t", body: "b", authorName: 42 as unknown as string }), /must be a string/);
});

test("buildPackage produces verifiable manifest", async () => {
  const { hashObject } = await import("@rooted/protocol");
  const pkg = buildPackage({
    title: "T", body: "B", authorId: "k1", authorName: "K One",
    createdAt: "2026-09-20T00:00:00.000Z", storyId: "story-2026-09-20-abcd1234",
  });
  assert.equal(pkg.manifest.packageId, "story-2026-09-20-abcd1234");
  assert.equal(pkg.signature.signedManifestSha256, hashObject(pkg.manifest));
  assert.deepEqual(Object.keys(pkg.files).sort(), ["kinfolk.json", "manifest.json", "signature.json", "story.json"]);
});

test("publishStory syndicates identical timeline copies to both sims", async () => {
  const { mkdtemp: mk } = await import("node:fs/promises");
  const tmp = await mk(join(tmpdir(), "rooted-lib-"));
  try {
    const validated = validateInput({ title: "Lib post", body: "via shared lib" });
    const res = await publishStory(validated, { root: tmp }, {
      createdAt: "2026-09-20T00:00:00.000Z",
      storyId: "story-2026-09-20-libtest1",
    });
    assert.deepEqual(res.backends, ["nextcloud-sim", "google-drive-sim"]);
    assert.deepEqual(res.skipped.sort(), ["google-drive", "kevcloud"]);
    const { readFile } = await import("node:fs/promises");
    for (const f of ["story.json", "manifest.json", "timeline.json"]) {
      const a = await readFile(join(tmp, "nextcloud-sim", ...(f === "timeline.json" ? [f] : ["timeline", res.storyId, f])));
      assert.ok(a.length > 0);
    }
    const idx = JSON.parse(await readFile(join(tmp, "nextcloud-sim", "timeline.json"), "utf8"));
    assert.ok(idx.stories.some((s: { id: string }) => s.id === res.storyId));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("contacts add/list/remove round-trip", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "rooted-contacts-"));
  try {
    const store = new LocalFolderStore(tmp);
    assert.deepEqual((await readContacts(store)).contacts, []);
    const c = validateContact({ id: "kinfolk-jo", displayName: "Jo" });
    await addContact(store, c);
    await addContact(store, c); // idempotent
    assert.equal((await readContacts(store)).contacts.length, 1);
    await removeContact(store, "kinfolk-jo");
    assert.deepEqual((await readContacts(store)).contacts, []);
    assert.throws(() => validateContact({ id: "../x", displayName: "Evil" }), /unsafe/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("backendsFromEnv honors PUBLISH_ROOT and skips clouds by default", () => {
  const saved = { ...process.env };
  delete process.env.KEVCLOUD_WEBDAV_URL;
  delete process.env.GOOGLE_DRIVE_SYNC;
  process.env.PUBLISH_ROOT = "/tmp/x";
  try {
    const b = backendsFromEnv("/repo");
    assert.equal(b.root, "/tmp/x");
    assert.equal(b.kevcloud, undefined);
    assert.equal(b.drive, undefined);
  } finally {
    process.env = saved;
  }
});
