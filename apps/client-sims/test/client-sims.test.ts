import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, hashObject, objectBytes } from "@rooted/protocol";
import { LocalFolderStore } from "@rooted/storage";
import { KinfolkClient } from "../src/client.js";
import { verifyStores } from "../src/verify-feed.js";

async function seed(root: string, tamperBackend: string | null) {
  const kinfolk = { id: "k-test", displayName: "Test Kinfolk" };
  const story = { id: "s-test", title: "t", body: "b", media: [], authorId: "k-test", createdAt: "2026-09-19T00:00:00.000Z" };
  const manifest = createManifest("pkg-test", [
    { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
    { path: "story.json", contentType: "application/json", value: story },
  ]);
  const signature = { algorithm: "demo-placeholder", signedManifestSha256: hashObject(manifest), note: "test" };
  for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
    const store = new LocalFolderStore(join(root, backend));
    const body = tamperBackend === backend ? "evil" : story.body;
    await store.writeObject("kinfolk.json", objectBytes(kinfolk));
    await store.writeObject("story.json", objectBytes({ ...story, body }));
    await store.writeObject("manifest.json", objectBytes(manifest));
    await store.writeObject("signature.json", objectBytes(signature));
  }
}

function clientFor(root: string, backend: string) {
  return new KinfolkClient(new LocalFolderStore(join(root, backend)), backend);
}

test("simulated Kinfolk clients verify the identical package on both backends", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-sims-"));
  try {
    await seed(root, null);
    const [a, b] = await Promise.all([
      clientFor(root, "nextcloud-sim").fetchPackage(),
      clientFor(root, "google-drive-sim").fetchPackage(),
    ]);
    assert.equal(hashObject(a.story), hashObject(b.story));
    assert.equal(a.manifest.packageId, b.manifest.packageId);
    const report = await verifyStores(root);
    assert.equal(report.ok, true);
    assert.equal(report.packageId, "pkg-test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tampered backend fails client verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-sims-"));
  try {
    await seed(root, "google-drive-sim");
    await assert.rejects(
      () => clientFor(root, "google-drive-sim").fetchPackage(),
      /hash mismatch: story\.json/
    );
    // Untouched backend still verifies — tamper is isolated, not systemic.
    const ok = await clientFor(root, "nextcloud-sim").fetchPackage();
    assert.equal(ok.manifest.packageId, "pkg-test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
