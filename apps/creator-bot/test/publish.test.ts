import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("publisher writes identical packages to both simulated backends", async () => {
  await run(process.execPath, ["--import", "tsx", "apps/creator-bot/src/index.ts"], { cwd: repoRoot });
  const root = resolve(repoRoot, "demo/stores");
  const files = ["kinfolk.json", "story.json", "manifest.json", "signature.json"];
  for (const file of files) assert.deepEqual(await readFile(resolve(root, "nextcloud-sim", file)), await readFile(resolve(root, "google-drive-sim", file)));
  await rm(root, { recursive: true, force: true });
  // Republish so the working tree keeps a demo package for web/verify/drive-sync.
  await run(process.execPath, ["--import", "tsx", "apps/creator-bot/src/index.ts"], { cwd: repoRoot });
});
