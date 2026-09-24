import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFolderStore } from "@rooted/storage";
import {
  publishStory,
  readFollowedTimelines,
  readVerifiedHistoryStory,
  tryOpenStory,
} from "../src/index.js";

function x25519Pair() {
  const pair = generateKeyPairSync("x25519");
  return {
    priv: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    pub: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

// M10 demo: kinfolk-alex posts on his porch; kinfolk-bob follows alex's
// porch from hers; a fake creator drops a video post for both kinfolk.
test("follow broadcast: porch post plus creator video reach both kinfolk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rooted-follow-"));
  const savedIds = process.env.OWNPLACE_IDENTITY_DIR;
  process.env.OWNPLACE_IDENTITY_DIR = join(dir, "ids");
  try {
    const alex = x25519Pair();
    const bob = x25519Pair();
    const stranger = x25519Pair();
    const rootA = join(dir, "porch-alex");
    const rootB = join(dir, "porch-bob");
    const storeA = new LocalFolderStore(join(rootA, "nextcloud-sim"));
    const storeB = new LocalFolderStore(join(rootB, "nextcloud-sim"));

    // 1. Alex posts a public text story on his own porch.
    await publishStory(
      { title: "Porch news", body: "hello from alex", authorId: "kinfolk-alex", authorName: "Alex" },
      { root: rootA },
      { createdAt: "2026-09-24T00:00:00.000Z", storyId: "story-alex-1" },
    );

    // 2. Fake creator posts a video for both kinfolk (sealed to subscribers).
    const video = "https://example.com/creator-video.mp4";
    await publishStory(
      {
        title: "New video", body: "watch this", media: [video],
        authorId: "creator-rumble", authorName: "Rumble Creator",
      },
      { root: rootA },
      {
        createdAt: "2026-09-24T00:01:00.000Z", storyId: "story-creator-1",
        entitleReaders: [
          { readerId: "kinfolk-alex", readerPublicKey: alex.pub },
          { readerId: "kinfolk-bob", readerPublicKey: bob.pub },
        ],
      },
    );

    // 3. Bob follows Alex's porch: her timeline carries both, with origins.
    const now = "2026-09-24T00:02:00.000Z";
    const merged = await readFollowedTimelines(
      [
        { label: "bob-porch", store: storeB },
        { label: "alex-porch", store: storeA },
      ],
      now,
    );
    assert.equal(merged.stories.length, 2);
    const ids = merged.stories.map((s) => s.id).sort();
    assert.deepEqual(ids, ["story-alex-1", "story-creator-1"]);
    assert.ok(merged.stories.every((s) => s.origin === "alex-porch"));
    assert.ok(merged.skipped.every((s) => s.porch === "alex-porch" || s.porch === "bob-porch"));

    // 4. Both kinfolk open the creator video; a stranger sees metadata only.
    const sealed = await readVerifiedHistoryStory(storeA, "story-creator-1");
    assert.equal(sealed.body, "");
    assert.deepEqual(sealed.media, []);
    for (const [who, pair] of [["kinfolk-alex", alex], ["kinfolk-bob", bob]] as const) {
      const opened = tryOpenStory(sealed, pair.priv, who);
      assert.equal(opened.status, "opened");
      if (opened.status === "opened") {
        assert.equal(opened.body, "watch this");
        assert.deepEqual(opened.media, [video]);
      }
    }
    assert.equal(tryOpenStory(sealed, stranger.priv, "stranger-x").status, "not-entitled");

    // 5. A tampered package on the followed porch loses only itself.
    const junkDir = join(rootA, "nextcloud-sim/timeline/junk-nopackage");
    await mkdir(junkDir, { recursive: true });
    await writeFile(join(junkDir, "story.json"), "{not json");
    const again = await readFollowedTimelines(
      [
        { label: "bob-porch", store: storeB },
        { label: "alex-porch", store: storeA },
      ],
      now,
    );
    assert.equal(again.stories.length, 2);
    assert.ok(again.skipped.some((s) => s.porch === "alex-porch" && s.id === "junk-nopackage"));
  } finally {
    if (savedIds === undefined) delete process.env.OWNPLACE_IDENTITY_DIR;
    else process.env.OWNPLACE_IDENTITY_DIR = savedIds;
    await rm(dir, { recursive: true, force: true });
  }
});

test("follow merge: bad labels rejected, empty merge empty, id squats keep first porch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rooted-follow-edge-"));
  const savedIds = process.env.OWNPLACE_IDENTITY_DIR;
  process.env.OWNPLACE_IDENTITY_DIR = join(dir, "ids");
  try {
    const rootA = join(dir, "porch-a");
    const rootB = join(dir, "porch-b");
    const storeA = new LocalFolderStore(join(rootA, "nextcloud-sim"));
    const storeB = new LocalFolderStore(join(rootB, "nextcloud-sim"));
    const now = "2026-09-24T00:03:00.000Z";
    assert.deepEqual(await readFollowedTimelines([], now), { stories: [], skipped: [] });
    await assert.rejects(
      readFollowedTimelines([{ label: "../evil", store: storeA }], now),
      /bad porch label/,
    );
    await assert.rejects(
      readFollowedTimelines([{ label: "<img src=x>", store: storeA }], now),
      /bad porch label/,
    );
    // Same id on two porches: first-listed porch wins, deterministically.
    for (const [root, title] of [[rootA, "A version"], [rootB, "B version"]] as const) {
      await publishStory(
        { title, body: "dup", authorId: "kinfolk-x", authorName: "X" },
        { root },
        { createdAt: "2026-09-24T00:00:00.000Z", storyId: "story-dup-1" },
      );
    }
    const aFirst = await readFollowedTimelines(
      [
        { label: "porch-a", store: storeA },
        { label: "porch-b", store: storeB },
      ],
      now,
    );
    assert.equal(aFirst.stories.length, 1);
    assert.equal(aFirst.stories[0].title, "A version");
    assert.equal(aFirst.stories[0].origin, "porch-a");
    const bFirst = await readFollowedTimelines(
      [
        { label: "porch-b", store: storeB },
        { label: "porch-a", store: storeA },
      ],
      now,
    );
    assert.equal(bFirst.stories[0].title, "B version");
    assert.equal(bFirst.stories[0].origin, "porch-b");
  } finally {
    if (savedIds === undefined) delete process.env.OWNPLACE_IDENTITY_DIR;
    else process.env.OWNPLACE_IDENTITY_DIR = savedIds;
    await rm(dir, { recursive: true, force: true });
  }
});
