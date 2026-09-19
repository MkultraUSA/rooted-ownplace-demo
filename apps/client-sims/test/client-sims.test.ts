import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, hashObject, objectBytes } from "@rooted/protocol";
import { LocalFolderStore } from "@rooted/storage";
import { KinfolkClient } from "../src/client.js";
import { verifyStores } from "../src/verify-feed.js";

async function seedManifestPerBackend(root: string) {
  const kinfolk = { id: "k-test", displayName: "Test Kinfolk" };
  const story = { id: "s-test", title: "t", body: "b", media: [], authorId: "k-test", createdAt: "2026-09-19T00:00:00.000Z" };
  for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
    const k = backend === "google-drive-sim" ? { ...kinfolk, displayName: "Impostor" } : kinfolk;
    const manifest = createManifest("pkg-test", [
      { path: "kinfolk.json", contentType: "application/json", value: k },
      { path: "story.json", contentType: "application/json", value: story },
    ]);
    const signature = { algorithm: "demo-placeholder", signedManifestSha256: hashObject(manifest), note: "test" };
    const store = new LocalFolderStore(join(root, backend));
    await store.writeObject("kinfolk.json", objectBytes(k));
    await store.writeObject("story.json", objectBytes(story));
    await store.writeObject("manifest.json", objectBytes(manifest));
    await store.writeObject("signature.json", objectBytes(signature));
  }
}

async function seedSharedManifest(root: string, tamperBody?: string) {
  const kinfolk = { id: "k-test", displayName: "Test Kinfolk" };
  const story = { id: "s-test", title: "t", body: "b", media: [], authorId: "k-test", createdAt: "2026-09-19T00:00:00.000Z" };
  const manifest = createManifest("pkg-test", [
    { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
    { path: "story.json", contentType: "application/json", value: story },
  ]);
  const signature = { algorithm: "demo-placeholder", signedManifestSha256: hashObject(manifest), note: "test" };
  for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
    const store = new LocalFolderStore(join(root, backend));
    await store.writeObject("kinfolk.json", objectBytes(kinfolk));
    await store.writeObject("manifest.json", objectBytes(manifest));
    await store.writeObject("signature.json", objectBytes(signature));
    if (tamperBody !== undefined && backend === "google-drive-sim") {
      await store.writeObject("story.json", objectBytes({ ...story, body: tamperBody }));
    } else {
      await store.writeObject("story.json", objectBytes(story));
    }
  }
}

function clientFor(root: string, backend: string) {
  return new KinfolkClient(new LocalFolderStore(join(root, backend)), backend);
}

test("simulated Kinfolk clients verify the identical package on both backends", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-sims-"));
  try {
    await seedSharedManifest(root);
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

test("tampered story body fails verification on that backend only", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-sims-"));
  try {
    await seedSharedManifest(root, "evil");
    await assert.rejects(
      () => clientFor(root, "google-drive-sim").fetchPackage(),
      /hash mismatch: story\.json/
    );
    const ok = await clientFor(root, "nextcloud-sim").fetchPackage();
    assert.equal(ok.manifest.packageId, "pkg-test");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kinfolk drift across backends fails cross-backend verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-sims-"));
  try {
    await seedManifestPerBackend(root);
    await clientFor(root, "nextcloud-sim").fetchPackage();
    await clientFor(root, "google-drive-sim").fetchPackage();
    const report = await verifyStores(root);
    assert.equal(report.ok, false);
    assert.match(report.problems.join(";"), /cross-backend mismatch: kinfolk/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt JSON reports a collected problem, not a raw SyntaxError", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-sims-"));
  try {
    await seedSharedManifest(root);
    const store = new LocalFolderStore(join(root, "google-drive-sim"));
    await store.writeObject("story.json", new TextEncoder().encode("{not-json"));
    await assert.rejects(
      () => clientFor(root, "google-drive-sim").fetchPackage(),
      /invalid JSON: story\.json/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("store rejects paths escaping its root", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-sims-"));
  try {
    const store = new LocalFolderStore(join(root, "nextcloud-sim"));
    await assert.rejects(() => store.writeObject("../../evil.txt", new TextEncoder().encode("x")), /escapes root|unsafe/);
    assert.equal(await store.exists("../../evil.txt"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
