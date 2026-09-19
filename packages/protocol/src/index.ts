import { createHash } from "node:crypto";

export type Kinfolk = { id: string; displayName: string; bio?: string };
export type Story = { id: string; title: string; body: string; media: string[]; authorId: string; createdAt: string };
export type ManifestObject = { path: string; sha256: string; contentType: string };
export type Manifest = { protocolVersion: "0.1"; packageId: string; objects: ManifestObject[]; signing: "demo-placeholder" };
export type Signature = { algorithm: "demo-placeholder"; signedManifestSha256: string; note: string };

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(",");
  return `{${entries}}`;
}

export function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function objectBytes(value: unknown): Uint8Array { return new TextEncoder().encode(`${canonicalJson(value)}\n`); }
export function hashObject(value: unknown): string { return sha256(objectBytes(value)); }

export function createManifest(packageId: string, objects: Array<Omit<ManifestObject, "sha256"> & { value: unknown }>): Manifest {
  return {
    protocolVersion: "0.1", packageId, signing: "demo-placeholder",
    objects: objects.map(({ path, contentType, value }) => ({ path, contentType, sha256: hashObject(value) }))
  };
}
