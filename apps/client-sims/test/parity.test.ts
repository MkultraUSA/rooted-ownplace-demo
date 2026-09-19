import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, hashObject, objectBytes } from "@rooted/protocol";
import { LocalFolderStore } from "@rooted/storage";
import { verifyParity } from "../src/verify-parity.js";

test("verifyParity passes on fresh sims without cloud env", async () => {
  const report = await verifyParity();
  assert.equal(report.ok, true);
  assert.deepStrictEqual(report.backends, ["nextcloud-sim", "google-drive-sim"]);
  assert.equal(report.fingerprints["nextcloud-sim"], report.fingerprints["google-drive-sim"]);
  assert.deepStrictEqual(report.problems, []);
});

test("verifyParity detects sim drift", async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const victim = resolve(repoRoot, "demo/stores/google-drive-sim/story.json");
  const original = await readFile(victim);
  try {
    const story = JSON.parse(original.toString());
    await writeFile(victim, JSON.stringify({ ...story, body: "tampered" }));
    // Tampered story breaks the per-backend manifest check first, so
    // verifyParity rejects (throw) rather than returning ok:false.
    await assert.rejects(() => verifyParity(), /google-drive-sim.*hash mismatch: story\.json/);
  } finally {
    await writeFile(victim, original);
  }
  const healed = await verifyParity();
  assert.equal(healed.ok, true);
});
