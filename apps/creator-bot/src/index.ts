import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createManifest, hashObject, objectBytes, type Kinfolk, type Story, type Signature } from "@rooted/protocol";
import { LocalFolderStore } from "@rooted/storage";

const root = resolve("demo/stores");
const kinfolk: Kinfolk = { id: "kinfolk-alex", displayName: "Alex Rowan", bio: "Building a more rooted internet." };
const story: Story = { id: "story-first-light", title: "First light at the workshop", body: "A small place can hold a big beginning. Today we opened the doors, shared a meal, and made room for one another.", media: [], authorId: kinfolk.id, createdAt: "2026-09-19T09:00:00.000Z" };
const packageId = "rooted-demo-first-light";
const content = [
  { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
  { path: "story.json", contentType: "application/json", value: story }
];
const manifest = createManifest(packageId, content);
const signature: Signature = { algorithm: "demo-placeholder", signedManifestSha256: hashObject(manifest), note: "Demo boundary only: this is not a cryptographic signature and content is not encrypted." };

for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
  const store = new LocalFolderStore(resolve(root, backend));
  await rm(store.root, { recursive: true, force: true });
  await mkdir(store.root, { recursive: true });
  for (const object of content) await store.writeObject(object.path, objectBytes(object.value));
  await store.writeObject("manifest.json", objectBytes(manifest));
  await store.writeObject("signature.json", objectBytes(signature));
}
console.log(`Published ${packageId} to nextcloud-sim and google-drive-sim.`);
