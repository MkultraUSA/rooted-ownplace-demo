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
const publishEntry = "apps/creator-bot/src/index.ts";
const postEntry = "apps/creator-bot/src/post.ts";

function cleanEnv(tmp: string): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env, PUBLISH_ROOT: tmp };
  // Hermetic: ambient cloud credentials must not leak into the child or skew
  // assertions (CI runners may export KEVCLOUD_* / GOOGLE_DRIVE_SYNC).
  delete env.KEVCLOUD_WEBDAV_URL;
  delete env.KEVCLOUD_WEBDAV_USER;
  delete env.KEVCLOUD_WEBDAV_PASS;
  delete env.GOOGLE_DRIVE_SYNC;
  return env as NodeJS.ProcessEnv;
}

test("publisher writes identical packages to both simulated backends", async () => {
  // Run in an isolated temp checkout overlay: copy repo minus stores/node_modules
  // is overkill — instead run publisher with PUBLISH_ROOT override into temp dir.
  const tmp = await mkdtemp(join(tmpdir(), "rooted-publish-"));
  try {
    await run(process.execPath, ["--import", "tsx", publishEntry], {
      cwd: repoRoot,
      env: cleanEnv(tmp),
    });
    const files = ["kinfolk.json", "story.json", "manifest.json", "signature.json"];
    for (const file of files) {
      const a = await readFile(join(tmp, "nextcloud-sim", file));
      const b = await readFile(join(tmp, "google-drive-sim", file));
      assert.deepStrictEqual(a, b);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("publisher preserves timeline history across a publish cycle (#41)", async () => {
  // Regression: legacy `npm run publish` used to rm -rf each backend dir,
  // deleting timeline/ history accumulated by `npm run post` (timeline 404).
  const tmp = await mkdtemp(join(tmpdir(), "rooted-publish-"));
  try {
    // 1. Accumulate timeline history via `post` (same lane the web write API uses).
    const { stdout } = await run(
      process.execPath,
      ["--import", "tsx", postEntry, "--title", "Keep me", "--body", "history must survive"],
      { cwd: repoRoot, env: cleanEnv(tmp) }
    );
    const id = (stdout.match(/story=\S+/) ?? [""])[0].replace("story=", "").trim();
    assert.ok(id, `expected story id in post output, got: ${String(stdout).slice(-200)}`);
    // 2. Run the legacy seed publisher over the same root.
    await run(process.execPath, ["--import", "tsx", publishEntry], {
      cwd: repoRoot,
      env: cleanEnv(tmp),
    });
    // 3. Timeline history survives on both sims; seed files stay identical.
    for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
      const kept = JSON.parse(await readFile(join(tmp, backend, "timeline", id, "story.json"), "utf8"));
      assert.equal(kept.title, "Keep me");
      const index = JSON.parse(await readFile(join(tmp, backend, "timeline.json"), "utf8"));
      assert.ok(
        index.stories.some((s: { id: string }) => s.id === id),
        `${backend} index missing ${id}`
      );
    }
    const files = ["kinfolk.json", "story.json", "manifest.json", "signature.json"];
    for (const file of files) {
      const a = await readFile(join(tmp, "nextcloud-sim", file));
      const b = await readFile(join(tmp, "google-drive-sim", file));
      assert.deepStrictEqual(a, b);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
