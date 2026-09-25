import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFolderStore, WebDavStore } from "../src/index.js";

test("LocalFolderStore writes, lists, reads, and checks objects", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-store-"));
  try {
    const store = new LocalFolderStore(root);
    await store.writeObject("nested/story.json", new TextEncoder().encode("hello"));
    assert.deepEqual(await store.listObjects(), ["nested/story.json"]);
    assert.equal(new TextDecoder().decode(await store.readObject("nested/story.json")), "hello");
    assert.equal(await store.exists("nested/story.json"), true);
    assert.equal(await store.exists("missing"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("WebDavStore refuses unsafe paths without network", async () => {
  const store = new WebDavStore({ baseUrl: "https://example.invalid/remote.php/dav/files/u/", username: "u", password: "p" });
  await assert.rejects(() => store.writeObject("../../evil.txt", new TextEncoder().encode("x")), /escapes root|unsafe/);
  await assert.rejects(() => store.readObject("/abs.txt"), /escapes root|unsafe/);
  assert.equal(await store.exists("../../evil.txt").catch(() => false), false);
});

test("WebDavStore requires credentials (never committed)", () => {
  assert.throws(() => new WebDavStore({ baseUrl: "", username: "", password: "" }), /requires baseUrl, username, password/);
});

// Live kevcloud test: runs ONLY when KEVCLOUD_WEBDAV_URL/USER/PASS are set
// (Hostinger one-shot or local dev with app password). Skipped in CI.
test("WebDavStore round-trips against live kevcloud (opt-in)", async (t) => {
  const { KEVCLOUD_WEBDAV_URL: url, KEVCLOUD_WEBDAV_USER: user, KEVCLOUD_WEBDAV_PASS: pass } = process.env;
  if (!url || !user || !pass) {
    t.skip("KEVCLOUD_* not set — live WebDAV test skipped");
    return;
  }
  const store = new WebDavStore({ baseUrl: url, username: user, password: pass });
  const probe = `rooted-probe/${Date.now()}.json`;
  const payload = new TextEncoder().encode(JSON.stringify({ hello: "kinfolk" }));
  await store.writeObject(probe, payload);
  assert.equal(await store.exists(probe), true);
  assert.deepEqual(await store.readObject(probe), payload);
  const listed = await store.listObjects("rooted-probe");
  assert.ok(listed.includes(probe), `expected ${probe} in ${listed.join(",")}`);
});

test("LocalFolderStore deleteObject removes files and tolerates missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-store-del-"));
  try {
    const store = new LocalFolderStore(root);
    await store.writeObject("entitlements.json", new TextEncoder().encode("stale"));
    assert.equal(await store.exists("entitlements.json"), true);
    await store.deleteObject("entitlements.json");
    assert.equal(await store.exists("entitlements.json"), false);
    await store.deleteObject("entitlements.json");
    assert.equal(await store.exists("entitlements.json"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("LocalFolderStore deleteObject rejects unsafe paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-store-del2-"));
  try {
    const store = new LocalFolderStore(root);
    await assert.rejects(() => store.deleteObject("../../evil.txt"), /escapes root|unsafe/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("LocalFolderStore refuses a symlink root even when the final component is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-store-link-"));
  const outside = await mkdtemp(join(tmpdir(), "rooted-store-out-"));
  try {
    const link = join(root, "link");
    await symlink(outside, link);
    const store = new LocalFolderStore(link);
    await assert.rejects(
      () => store.writeObject("nested/new.txt", new TextEncoder().encode("x")),
      /escapes root/,
    );
    assert.throws(() => store.readObject("missing.txt"), /escapes root/);
    await assert.equal(await import("node:fs/promises").then((fs) => fs.access(join(outside, "nested/new.txt")).then(() => true, () => false)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
