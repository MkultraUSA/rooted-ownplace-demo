import { hashObject, verifyManifestSignature } from "@rooted/protocol";
import type { ObjectStore } from "@rooted/storage";

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
  constructor(private store: ObjectStore, readonly backend: string) {}

  async fetchPackage(): Promise<VerifiedPackage> {
    const problems: string[] = [];
    const parsed: Record<string, unknown> = {};
    for (const f of FILES) {
      let text: string;
      try {
        text = new TextDecoder().decode(await this.store.readObject(f)); // NOTE: Buffer.toString() works but raw Uint8Array.toString() joins bytes as CSV — always decode explicitly.
      } catch (e) {
        problems.push(`missing unreadable file: ${f} (${(e as Error).message})`);
        continue;
      }
      try {
        parsed[f] = JSON.parse(text);
      } catch {
        problems.push(`invalid JSON: ${f}`);
      }
    }
    const manifest = parsed["manifest.json"] as VerifiedPackage["manifest"] | undefined;
    const signature = parsed["signature.json"] as VerifiedPackage["signature"] | undefined;
    if (manifest && Array.isArray(manifest.objects)) {
      const names = manifest.objects.map((o) => o?.path);
      for (const required of ["kinfolk.json", "story.json"]) {
        if (names.filter((name) => name === required).length !== 1) problems.push(`manifest must list ${required} exactly once`);
      }
      for (const obj of manifest.objects) {
        if (typeof obj?.path !== "string" || typeof obj?.sha256 !== "string") {
          problems.push("manifest has malformed object entry");
          continue;
        }
        const content = parsed[obj.path];
        if (content === undefined) { problems.push(`manifest lists ${obj.path} but it is missing`); continue; }
        if (hashObject(content) !== obj.sha256) problems.push(`hash mismatch: ${obj.path}`);
      }
    } else if (parsed["manifest.json"] !== undefined) {
      problems.push("manifest is malformed: objects is not an array");
    }
    if (manifest && signature) {
      if (typeof signature.signedManifestSha256 !== "string") {
        problems.push("signature is malformed: signedManifestSha256 is not a string");
      } else if (signature.signedManifestSha256 !== hashObject(manifest)) {
        problems.push("signature does not match manifest");
      } else if ((manifest as { signing?: string }).signing !== "ed25519") {
        problems.push("package is not Ed25519 signed");
      } else if (!verifyManifestSignature(manifest, signature, parsed["kinfolk.json"])) {
        problems.push("Ed25519 signature verification failed");
      }
    }
    const kinfolk = parsed["kinfolk.json"] as { id?: unknown } | undefined;
    const story = parsed["story.json"] as { authorId?: unknown } | undefined;
    if (kinfolk && story && (typeof kinfolk.id !== "string" || story.authorId !== kinfolk.id)) problems.push("story author does not match Kinfolk identity");
    if (!manifest || !signature || !kinfolk || !story) problems.push("incomplete package");
    if (problems.length) throw new Error(`${this.backend}: ${problems.join("; ")}`);
    return {
      backend: this.backend,
      kinfolk: parsed["kinfolk.json"],
      story: parsed["story.json"] as VerifiedPackage["story"],
      manifest: manifest as VerifiedPackage["manifest"],
      signature: signature as VerifiedPackage["signature"],
    };
  }
}
