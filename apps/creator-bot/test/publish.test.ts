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

test("publisher writes identical packages to both simulated backends", async () => {
  // Run in an isolated temp checkout overlay: copy repo minus stores/node_modules
  // is overkill — instead run publisher with PUBLISH_ROOT override into temp dir.
  const tmp = await mkdtemp(join(tmpdir(), "rooted-publish-"));
  try {
    await run(process.execPath, ["--import", "tsx", "apps/creator-bot/src/index.ts"], {
      cwd: repoRoot,
      env: { ...process.env, PUBLISH_ROOT: tmp },
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
