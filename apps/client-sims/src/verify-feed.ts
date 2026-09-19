import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashObject } from "@rooted/protocol";
import { LocalFolderStore } from "@rooted/storage";
import { KinfolkClient } from "./client.js";

// Repo root resolved from this file, not cwd: `npm run verify` executes
// with cwd set to the workspace dir (apps/client-sims).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function verifyStores(storesRoot = resolve(repoRoot, "demo/stores")) {
  const clients = ["nextcloud-sim", "google-drive-sim"].map(
    (backend) => new KinfolkClient(new LocalFolderStore(resolve(storesRoot, backend)), backend)
  );
  const [a, b] = await Promise.all(clients.map((c) => c.fetchPackage()));
  const sameStory = hashObject(a.story) === hashObject(b.story);
  const samePackage = a.manifest.packageId === b.manifest.packageId;
  return { ok: sameStory && samePackage, packageId: a.manifest.packageId, title: a.story.title };
}

if (process.env.ROOTED_VERIFY_STANDALONE !== "0") {
  const report = await verifyStores();
  console.log(`verify: ${report.ok ? "OK" : "MISMATCH"} package=${report.packageId} title="${report.title}" backends=nextcloud-sim,google-drive-sim`);
  if (!report.ok) process.exit(1);
}
