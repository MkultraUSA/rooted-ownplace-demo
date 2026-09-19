import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const postEntry = resolve(repoRoot, "apps/creator-bot/src/post.ts");

async function runPost(tmp: string, args: string[], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, PUBLISH_ROOT: tmp, ...extraEnv };
  // Hermetic: ambient cloud credentials must not leak into the child or skew
  // assertions (CI runners may export KEVCLOUD_* / GOOGLE_DRIVE_SYNC).
  delete env.KEVCLOUD_WEBDAV_URL;
  delete env.KEVCLOUD_WEBDAV_USER;
  delete env.KEVCLOUD_WEBDAV_PASS;
  delete env.GOOGLE_DRIVE_SYNC;
  return run(process.execPath, ["--import", "tsx", postEntry, ...args], {
    cwd: repoRoot,
    env: env as NodeJS.ProcessEnv,
  });
}

async function readJson(tmp: string, backend: string, ...parts: string[]) {
  return JSON.parse(await readFile(join(tmp, backend, ...parts), "utf8"));
}

test("post publishes identical timeline story to both sims", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "rooted-post-"));
  try {
    const { stdout } = await runPost(tmp, ["--title", "Hello timeline", "--body", "First syndicated post"]);
    const id = (stdout.match(/story=\S+/) ?? [""])[0].replace("story=", "").trim();
    assert.ok(id.startsWith("story-"), `expected story id in output, got: ${stdout.slice(-200)}`);
    for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
      for (const f of ["kinfolk.json", "story.json", "manifest.json", "signature.json"]) {
        const a = await readFile(join(tmp, "nextcloud-sim", "timeline", id, f));
        const b = await readFile(join(tmp, backend, "timeline", id, f));
        assert.deepStrictEqual(a, b, `${backend}/${f} differs`);
      }
      const index = await readJson(tmp, backend, "timeline.json");
      assert.ok(index.stories.some((s: { id: string }) => s.id === id), `${backend} index missing ${id}`);
      // flat latest copy matches timeline copy
      for (const f of ["story.json", "manifest.json"]) {
        const flat = await readFile(join(tmp, backend, f));
        const tl = await readFile(join(tmp, backend, "timeline", id, f));
        assert.deepStrictEqual(flat, tl, `${backend} flat ${f} != timeline copy`);
      }
    }
    const story = await readJson(tmp, "nextcloud-sim", "timeline", id, "story.json");
    assert.equal(story.title, "Hello timeline");
    assert.equal(story.body, "First syndicated post");
    assert.equal(story.authorId, "kinfolk-alex");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("post accumulates timeline across two posts", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "rooted-post-"));
  try {
    await runPost(tmp, ["--title", "One", "--body", "first"]);
    await runPost(tmp, ["--title", "Two", "--body", "second"]);
    const index = await readJson(tmp, "nextcloud-sim", "timeline.json");
    assert.equal(index.stories.length, 2);
    assert.equal(index.stories[0].title, "Two"); // newest first
    assert.equal(index.stories[1].title, "One");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("post rejects missing/oversize input without writing", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "rooted-post-"));
  try {
    await assert.rejects(() => runPost(tmp, ["--title", "", "--body", "x"]));
    await assert.rejects(() => runPost(tmp, ["--title", "T"]));
    await assert.rejects(() => runPost(tmp, ["--title", "--body", "x"])); // flag-swallowing guard
    await assert.rejects(() => runPost(tmp, ["--title", "x".repeat(141), "--body", "ok"]));
    await assert.rejects(() => runPost(tmp, ["--title", "ok", "--body", "x".repeat(5001)]));
    const { access } = await import("node:fs/promises");
    for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
      const missing = await access(join(tmp, backend)).then(() => false, () => true);
      assert.equal(missing, true, `nothing should be written on validation failure (${backend})`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("post rebuilds corrupt timeline index from on-disk history", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "rooted-post-"));
  const { writeFile } = await import("node:fs/promises");
  try {
    await runPost(tmp, ["--title", "Keep me", "--body", "history survives"]);
    await writeFile(join(tmp, "nextcloud-sim", "timeline.json"), "{corrupt-index");
    const { stdout } = await runPost(tmp, ["--title", "Second", "--body", "after corruption"]);
    assert.match(stdout, /rebuilt nextcloud-sim index from 1 on-disk story/);
    const index = JSON.parse(await readFile(join(tmp, "nextcloud-sim", "timeline.json"), "utf8"));
    assert.equal(index.stories.length, 2);
    const titles = index.stories.map((s: { title: string }) => s.title).sort();
    assert.deepStrictEqual(titles, ["Keep me", "Second"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
