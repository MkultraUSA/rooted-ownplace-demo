import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFolderStore } from "../src/index.ts";

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
