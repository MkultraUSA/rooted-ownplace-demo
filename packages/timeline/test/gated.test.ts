import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFolderStore } from "@rooted/storage";
import {
  buildPackage,
  fetchVerifiedHistoryPackage,
  publishStory,
  readIndex,
  tryOpenStory,
} from "../src/index.js";
import { createManifest, hashObject, isSealedBody, objectBytes, signManifest } from "@rooted/protocol";

function x25519Pair() {
  const pair = generateKeyPairSync("x25519");
  return {
    priv: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    pub: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function ed25519Pair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    priv: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    pub: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

async function withIdDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "rooted-gated-"));
  const saved = process.env.OWNPLACE_IDENTITY_DIR;
  process.env.OWNPLACE_IDENTITY_DIR = join(dir, "ids");
  try {
    await fn(dir);
  } finally {
    if (saved === undefined) delete process.env.OWNPLACE_IDENTITY_DIR;
    else process.env.OWNPLACE_IDENTITY_DIR = saved;
    await rm(dir, { recursive: true, force: true });
  }
}

test("gated build seals the body and binds the envelope to the manifest", async () => {
  await withIdDir(async () => {
    const reader = x25519Pair();
    const pkg = buildPackage(
      {
        title: "Paid post", body: "paywalled words", authorId: "kinfolk-alex",
        authorName: "Alex", createdAt: "2026-09-20T00:00:00.000Z", storyId: "story-gated-1",
      },
      { entitle: { readerId: "reader-bob", readerPublicKey: reader.pub } },
    );
    assert.equal(pkg.story.body, "");
    assert.equal(isSealedBody(pkg.story.restricted), true);
    assert.equal(tryOpenStory(pkg.story, reader.priv, "reader-bob").status, "opened");
    assert.equal(
      tryOpenStory(pkg.story, reader.priv, "reader-bob").status === "opened" &&
        (tryOpenStory(pkg.story, reader.priv, "reader-bob") as { body: string }).body,
      "paywalled words",
    );
    // Manifest hash covers the sealed story: swapping the envelope breaks it.
    const hacked = { ...pkg.story, restricted: { ...(pkg.story.restricted as object), ciphertext: "AAAA" } };
    assert.notEqual(hashObject(hacked), pkg.manifest.objects.find((o) => o.path === "story.json")?.sha256);
  });
});

test("gated publish lands identical bytes on both sims; title stays public", async () => {
  await withIdDir(async (dir) => {
    const reader = x25519Pair();
    const stranger = x25519Pair();
    const root = join(dir, "stores");
    const res = await publishStory(
      { title: "Paid post", body: "paywalled words", authorId: "kinfolk-alex", authorName: "Alex" },
      { root },
      {
        createdAt: "2026-09-20T00:00:00.000Z",
        storyId: "story-gated-2",
        entitle: { readerId: "reader-bob", readerPublicKey: reader.pub },
      },
    );
    assert.ok(res.backends.includes("nextcloud-sim"));
    assert.ok(res.backends.includes("google-drive-sim"));
    const a = await readFile(join(root, "nextcloud-sim/timeline/story-gated-2/story.json"), "utf8");
    const b = await readFile(join(root, "google-drive-sim/timeline/story-gated-2/story.json"), "utf8");
    assert.equal(a, b);
    for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
      const store = new LocalFolderStore(join(root, backend));
      const story = (await fetchVerifiedHistoryPackage(store, "story-gated-2")).story;
      assert.equal(story.body, "");
      assert.equal(tryOpenStory(story, reader.priv, "reader-bob").status, "opened");
      assert.equal(tryOpenStory(story, stranger.priv, "stranger-x").status, "not-entitled");
      assert.equal(tryOpenStory(story).status, "restricted");
      const index = await readIndex(store, backend, "2026-09-20T00:00:01.000Z");
      const entry = index.stories.find((s) => s.id === "story-gated-2");
      assert.equal(entry?.title, "Paid post");
    }
  });
});

test("verify path rejects plaintext leaks and malformed envelopes", async () => {
  await withIdDir(async (dir) => {
    const reader = x25519Pair();
    const author = ed25519Pair();
    const root = join(dir, "stores");
    async function writePkg(id: string, story: unknown): Promise<void> {
      const kinfolk = { id: "kinfolk-x", displayName: "X", publicKey: author.pub };
      const manifest = createManifest(
        id,
        [
          { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
          { path: "story.json", contentType: "application/json", value: story },
        ],
        "ed25519",
      );
      const signature = signManifest(manifest, author.priv);
      const store = new LocalFolderStore(join(root, "nextcloud-sim"));
      await store.writeObject(`timeline/${id}/kinfolk.json`, objectBytes(kinfolk));
      await store.writeObject(`timeline/${id}/story.json`, objectBytes(story));
      await store.writeObject(`timeline/${id}/manifest.json`, objectBytes(manifest));
      await store.writeObject(`timeline/${id}/signature.json`, objectBytes(signature));
    }
    const { sealBody } = await import("@rooted/protocol");
    const env = sealBody("secret", reader.pub, "reader-bob");
    await writePkg("story-leak", {
      id: "story-leak", title: "t", body: "LEAK", media: [],
      authorId: "kinfolk-x", createdAt: "2026-09-20T00:00:00.000Z", restricted: env,
    });
    await writePkg("story-badenv", {
      id: "story-badenv", title: "t", body: "", media: [],
      authorId: "kinfolk-x", createdAt: "2026-09-20T00:00:00.000Z", restricted: {},
    });
    const store = new LocalFolderStore(join(root, "nextcloud-sim"));
    await assert.rejects(fetchVerifiedHistoryPackage(store, "story-leak"), /plaintext body/);
    await assert.rejects(fetchVerifiedHistoryPackage(store, "story-badenv"), /malformed/);
  });
});

test("public posts are unchanged by the gating slice", async () => {
  await withIdDir(async (dir) => {
    const pkg = buildPackage({
      title: "Free post", body: "everyone reads", authorId: "kinfolk-alex",
      authorName: "Alex", createdAt: "2026-09-20T00:00:00.000Z", storyId: "story-free-1",
    });
    assert.equal(pkg.story.body, "everyone reads");
    assert.equal("restricted" in pkg.story, false);
    assert.equal(tryOpenStory(pkg.story).status, "public");
  });
});
