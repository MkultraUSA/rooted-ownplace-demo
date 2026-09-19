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

  // Local sims always participate. Honor PUBLISH_ROOT like the publisher.
  const storesRoot = process.env.PUBLISH_ROOT
    ? resolve(process.env.PUBLISH_ROOT)
    : resolve(repoRoot, "demo/stores");
  const fetched: Record<string, { kinfolk: unknown; story: unknown; manifest: unknown; signature: unknown }> = {};
  for (const b of ["nextcloud-sim", "google-drive-sim"]) {
    try {
      fetched[b] = await new KinfolkClient(
        new LocalFolderStore(resolve(storesRoot, b)), b
      ).fetchPackage();
      backends.push(b);
    } catch (e) {
      problems.push(`${b}: ${(e as Error).message}`);
    }
  }
  if (fetched["nextcloud-sim"] && fetched["google-drive-sim"]) {
    fingerprints["nextcloud-sim"] = fingerprint(fetched["nextcloud-sim"]);
    fingerprints["google-drive-sim"] = fingerprint(fetched["google-drive-sim"]);
    if (fingerprints["nextcloud-sim"] !== fingerprints["google-drive-sim"]) {
      problems.push("cross-backend mismatch: sim fingerprints differ");
    }
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
      if (
        fetched["nextcloud-sim"] &&
        fingerprints["kevcloud"] !== fingerprints["nextcloud-sim"]
      ) {
        problems.push("cross-backend mismatch: kevcloud differs from sims");
      }
    } catch (e) {
      problems.push(`kevcloud unreachable: ${(e as Error).message}`);
    }
  }

  // Google Drive via rclone cat (opt-in, Hostinger).
  if (process.env.GOOGLE_DRIVE_SYNC === "1") {
    const remote = process.env.GOOGLE_DRIVE_REMOTE ?? "rooted_drive:";
    const folder = process.env.GOOGLE_DRIVE_FOLDER ?? "Rooted OwnPlace Demo";
    const target = (p: string) => `${remote}${folder}/${p}`;
    let raw: Record<string, string>;
    try {
      const get = async (p: string) => {
        const { stdout } = await run("rclone", ["cat", target(p), "--timeout", "30s"], { maxBuffer: 10 * 1024 * 1024 });
        return stdout;
      };
      const texts = await Promise.all(
        ["kinfolk.json", "story.json", "manifest.json", "signature.json"].map(get)
      );
      raw = Object.fromEntries(
        ["kinfolk.json", "story.json", "manifest.json", "signature.json"].map((n, i) => [n, texts[i]])
      );
    } catch (e) {
      problems.push(`google-drive unreachable: ${(e as Error).message}`);
      raw = {};
    }
    if (raw && Object.keys(raw).length === 4) {
      const problems_gd: string[] = [];
      const parsed: Record<string, unknown> = {};
      for (const [n, text] of Object.entries(raw)) {
        try { parsed[n] = JSON.parse(text); }
        catch { problems_gd.push(`google-drive corrupt: invalid JSON: ${n}`); }
      }
      const manifest = parsed["manifest.json"] as { objects?: unknown; packageId?: unknown } | undefined;
      const signature = parsed["signature.json"] as { signedManifestSha256?: unknown } | undefined;
      if (manifest && Array.isArray(manifest.objects)) {
        const byName: Record<string, unknown> = {
          "kinfolk.json": parsed["kinfolk.json"], "story.json": parsed["story.json"],
          "manifest.json": parsed["manifest.json"], "signature.json": parsed["signature.json"],
        };
        for (const obj of manifest.objects as { path?: unknown; sha256?: unknown }[]) {
          if (typeof obj?.path !== "string" || typeof obj?.sha256 !== "string") {
            problems_gd.push("google-drive corrupt: manifest has malformed object entry");
            continue;
          }
          const content = byName[obj.path];
          if (content === undefined) { problems_gd.push(`google-drive corrupt: manifest lists ${obj.path} but missing`); continue; }
          if (hashObject(content) !== obj.sha256) problems_gd.push(`google-drive corrupt: hash mismatch: ${obj.path}`);
        }
      } else if (parsed["manifest.json"] !== undefined) {
        problems_gd.push("google-drive corrupt: manifest objects is not an array");
      }
      if (manifest && signature) {
        if (typeof signature.signedManifestSha256 !== "string") {
          problems_gd.push("google-drive corrupt: signature is malformed");
        } else if (signature.signedManifestSha256 !== hashObject(manifest)) {
          problems_gd.push("google-drive corrupt: signature does not match manifest");
        }
      }
      if (problems_gd.length) {
        problems.push(...problems_gd);
      } else {
        fingerprints["google-drive"] = hashObject({
          kinfolk: parsed["kinfolk.json"], story: parsed["story.json"],
          manifest: parsed["manifest.json"], signature: parsed["signature.json"],
        });
        backends.push("google-drive");
        if (
          fetched["nextcloud-sim"] &&
          fingerprints["google-drive"] !== fingerprints["nextcloud-sim"]
        ) {
          problems.push("cross-backend mismatch: google-drive differs from sims");
        }
      }
    }
  }

  // Timeline indexes must also match across sims (same stories, same order).
  if (fetched["nextcloud-sim"] && fetched["google-drive-sim"]) {
    const idxProblems = await compareTimelines(storesRoot);
    problems.push(...idxProblems);
  }

  return { ok: problems.length === 0, backends, fingerprints, problems };
}

async function readTimelineIds(
  store: LocalFolderStore,
  label: string,
  problems: string[]
): Promise<string[] | null> {
  let index: { stories?: unknown };
  try {
    index = JSON.parse(new TextDecoder().decode(await store.readObject("timeline.json")));
  } catch {
    return null; // no timeline yet: not a mismatch, just empty
  }
  if (!index || !Array.isArray(index.stories)) {
    problems.push(`${label}: timeline.json is malformed`);
    return [];
  }
  const ids: string[] = [];
  for (const s of index.stories as { id?: unknown }[]) {
    if (typeof s?.id !== "string") {
      problems.push(`${label}: timeline has malformed entry`);
      continue;
    }
    ids.push(s.id);
  }
  return ids;
}

async function compareTimelines(storesRoot: string): Promise<string[]> {
  const problems: string[] = [];
  const { LocalFolderStore: LFS } = await import("@rooted/storage");
  const a = await readTimelineIds(
    new LFS(resolve(storesRoot, "nextcloud-sim")), "nextcloud-sim", problems
  );
  const b = await readTimelineIds(
    new LFS(resolve(storesRoot, "google-drive-sim")), "google-drive-sim", problems
  );
  if (a === null || b === null) return problems; // at least one side empty: nothing to compare
  if (a.length !== b.length || !a.every((id, i) => id === b[i])) {
    problems.push("cross-backend mismatch: timeline indexes differ");
  }
  return problems;
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
