import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hashObject } from "@rooted/protocol";
import { LocalFolderStore, WebDavStore } from "@rooted/storage";
import { KinfolkClient } from "./client.js";

const run = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface ParityResult {
  ok: boolean;
  backends: string[];
  fingerprints: Record<string, string>;
  problems: string[];
}

function fingerprint(pkg: { kinfolk: unknown; story: unknown; manifest: unknown; signature: unknown }): string {
  return hashObject({ kinfolk: pkg.kinfolk, story: pkg.story, manifest: pkg.manifest, signature: pkg.signature });
}

export async function verifyParity(): Promise<ParityResult> {
  const problems: string[] = [];
  const fingerprints: Record<string, string> = {};
  const backends: string[] = [];

  // Local sims always participate.
  const storesRoot = resolve(repoRoot, "demo/stores");
  const sims = ["nextcloud-sim", "google-drive-sim"].map(
    (b) => new KinfolkClient(new LocalFolderStore(resolve(storesRoot, b)), b)
  );
  const [a, b] = await Promise.all(sims.map((c) => c.fetchPackage()));
  fingerprints["nextcloud-sim"] = fingerprint(a);
  fingerprints["google-drive-sim"] = fingerprint(b);
  backends.push("nextcloud-sim", "google-drive-sim");
  if (fingerprints["nextcloud-sim"] !== fingerprints["google-drive-sim"]) {
    problems.push("cross-backend mismatch: sim fingerprints differ");
  }

  // kevcloud WebDAV (opt-in).
  if (process.env.KEVCLOUD_WEBDAV_URL && process.env.KEVCLOUD_WEBDAV_USER && process.env.KEVCLOUD_WEBDAV_PASS) {
    try {
      const kc = await new KinfolkClient(
        new WebDavStore({
          baseUrl: process.env.KEVCLOUD_WEBDAV_URL,
          username: process.env.KEVCLOUD_WEBDAV_USER,
          password: process.env.KEVCLOUD_WEBDAV_PASS,
        }),
        "kevcloud"
      ).fetchPackage();
      fingerprints["kevcloud"] = fingerprint(kc);
      backends.push("kevcloud");
      if (fingerprints["kevcloud"] !== fingerprints["nextcloud-sim"]) {
        problems.push("cross-backend mismatch: kevcloud differs from sims");
      }
    } catch (e) {
      problems.push(`kevcloud unreachable: ${(e as Error).message}`);
    }
  }

  // Google Drive via rclone cat (opt-in, Hostinger).
  if (process.env.GOOGLE_DRIVE_SYNC === "1") {
    try {
      const remote = process.env.GOOGLE_DRIVE_REMOTE ?? "rooted_drive:";
      const folder = process.env.GOOGLE_DRIVE_FOLDER ?? "Rooted OwnPlace Demo";
      const target = (p: string) => `${remote}${folder}/${p}`;
      const get = async (p: string) => {
        const { stdout } = await run("rclone", ["cat", target(p), "--timeout", "30s"], { maxBuffer: 10 * 1024 * 1024 });
        return JSON.parse(stdout);
      };
      const [kinfolk, story, manifest, signature] = await Promise.all(
        ["kinfolk.json", "story.json", "manifest.json", "signature.json"].map(get)
      );
      const problems_gd: string[] = [];
      for (const obj of manifest.objects ?? []) {
        const byName: Record<string, unknown> = { "kinfolk.json": kinfolk, "story.json": story, "manifest.json": manifest, "signature.json": signature };
        const content = typeof obj?.path === "string" ? byName[obj.path] : undefined;
        if (content === undefined) { problems_gd.push(`manifest lists ${obj.path} but missing on drive`); continue; }
        if (hashObject(content) !== obj.sha256) problems_gd.push(`hash mismatch on drive: ${obj.path}`);
      }
      if (signature.signedManifestSha256 !== hashObject(manifest)) problems_gd.push("drive signature mismatch");
      if (problems_gd.length) {
        problems.push(...problems_gd.map((p) => `google-drive: ${p}`));
      } else {
        fingerprints["google-drive"] = hashObject({ kinfolk, story, manifest, signature });
        backends.push("google-drive");
        if (fingerprints["google-drive"] !== fingerprints["nextcloud-sim"]) {
          problems.push("cross-backend mismatch: google-drive differs from sims");
        }
      }
    } catch (e) {
      problems.push(`google-drive unreachable: ${(e as Error).message}`);
    }
  }

  return { ok: problems.length === 0, backends, fingerprints, problems };
}

function isDirectRun(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("verify-parity.ts") || entry.endsWith("verify-parity.js");
}

if (isDirectRun()) {
  const report = await verifyParity();
  console.log(`parity: ${report.ok ? "OK" : "MISMATCH"} backends=${report.backends.join(",")}`);
  for (const [b, fp] of Object.entries(report.fingerprints)) console.log(` - ${b}: ${fp.slice(0, 16)}…`);
  if (!report.ok) {
    for (const p of report.problems) console.error(` - ${p}`);
    process.exit(1);
  }
}
