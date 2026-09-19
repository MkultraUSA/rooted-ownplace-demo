import { hashObject } from "@rooted/protocol";
import type { LocalFolderStore } from "@rooted/storage";

export interface VerifiedPackage {
  backend: string;
  kinfolk: unknown;
  story: Record<string, unknown> & { title: string };
  manifest: Record<string, unknown> & { packageId: string; objects: { path: string; sha256: string }[] };
  signature: Record<string, unknown> & { signedManifestSha256: string };
}

const FILES = ["kinfolk.json", "story.json", "manifest.json", "signature.json"] as const;

// Headless OwnPlace client simulator: a Kinfolk app reading one backend
// through the shared ObjectStore interface, verifying hashes + signature.
export class KinfolkClient {
  constructor(private store: LocalFolderStore, readonly backend: string) {}

  async fetchPackage(): Promise<VerifiedPackage> {
    const raw: Record<string, string> = {};
    for (const f of FILES) raw[f] = (await this.store.readObject(f)).toString();
    const kinfolk = JSON.parse(raw["kinfolk.json"]);
    const story = JSON.parse(raw["story.json"]);
    const manifest = JSON.parse(raw["manifest.json"]);
    const signature = JSON.parse(raw["signature.json"]);
    const problems: string[] = [];
    for (const obj of manifest.objects ?? []) {
      if (raw[obj.path] === undefined) { problems.push(`manifest lists ${obj.path} but it is missing`); continue; }
      if (hashObject(JSON.parse(raw[obj.path])) !== obj.sha256) problems.push(`hash mismatch: ${obj.path}`);
    }
    if (signature.signedManifestSha256 !== hashObject(manifest)) problems.push("signature does not match manifest");
    if (problems.length) throw new Error(`${this.backend}: ${problems.join("; ")}`);
    return { backend: this.backend, kinfolk, story, manifest, signature };
  }
}
