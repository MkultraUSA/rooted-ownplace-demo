import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

test("publisher writes identical packages to both simulated backends", async () => {
  await run(process.execPath, ["--import", "tsx", "apps/creator-bot/src/index.ts"], { cwd: resolve(".") });
  const root = resolve("demo/stores");
  const files = ["kinfolk.json", "story.json", "manifest.json", "signature.json"];
  for (const file of files) assert.deepEqual(await readFile(resolve(root, "nextcloud-sim", file)), await readFile(resolve(root, "google-drive-sim", file)));
  await rm(root, { recursive: true, force: true });
});
