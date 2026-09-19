import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashObject } from "@rooted/protocol";
import { LocalFolderStore } from "@rooted/storage";
import { KinfolkClient, type VerifiedPackage } from "./client.js";

// Repo root resolved from this file, not cwd: `npm run verify` executes
// with cwd set to the workspace dir (apps/client-sims).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function packageFingerprint(pkg: VerifiedPackage): string {
  return hashObject({ kinfolk: pkg.kinfolk, story: pkg.story, manifest: pkg.manifest, signature: pkg.signature });
}

export async function verifyStores(storesRoot = resolve(repoRoot, "demo/stores")) {
  const clients = ["nextcloud-sim", "google-drive-sim"].map(
    (backend) => new KinfolkClient(new LocalFolderStore(resolve(storesRoot, backend)), backend)
  );
  const [a, b] = await Promise.all(clients.map((c) => c.fetchPackage()));
  // Byte-identity across backends: every object must match, not just story+id.
  // (CI also runs `diff -r` as an independent byte check.)
  const problems: string[] = [];
  for (const key of ["kinfolk", "story", "manifest", "signature"] as const) {
    if (hashObject(a[key]) !== hashObject(b[key])) problems.push(`cross-backend mismatch: ${key}`);
  }
  if (a.manifest.packageId !== b.manifest.packageId) problems.push("cross-backend mismatch: packageId");
  const ok = problems.length === 0;
  return { ok, problems, packageId: a.manifest.packageId, title: String(a.story.title), fingerprint: packageFingerprint(a) };
}

function isDirectRun(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("verify-feed.ts") || entry.endsWith("verify-feed.js");
}

if (isDirectRun()) {
  const report = await verifyStores();
  console.log(`verify: ${report.ok ? "OK" : "MISMATCH"} package=${report.packageId} title="${report.title}" backends=nextcloud-sim,google-drive-sim`);
  if (!report.ok) {
    for (const p of report.problems) console.error(` - ${p}`);
    process.exit(1);
  }
}
