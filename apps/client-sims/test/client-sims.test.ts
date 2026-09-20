import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManifest, hashObject, objectBytes, signManifest } from "@rooted/protocol";
import { LocalFolderStore } from "@rooted/storage";
import { KinfolkClient } from "../src/client.js";
import { verifyStores } from "../src/verify-feed.js";

const testPair = generateKeyPairSync("ed25519");
const testPrivateKey = testPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const testPublicKey = testPair.publicKey.export({ type: "spki", format: "pem" }).toString();

async function seedManifestPerBackend(root: string) {
  const kinfolk = { id: "k-test", displayName: "Test Kinfolk", publicKey: testPublicKey };
  const story = { id: "s-test", title: "t", body: "b", media: [], authorId: "k-test", createdAt: "2026-09-19T00:00:00.000Z" };
  for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
    const k = backend === "google-drive-sim" ? { ...kinfolk, displayName: "Impostor" } : kinfolk;
    const manifest = createManifest("pkg-test", [
      { path: "kinfolk.json", contentType: "application/json", value: k },
      { path: "story.json", contentType: "application/json", value: story },
    ], "ed25519");
    const signature = signManifest(manifest, testPrivateKey);
    const store = new LocalFolderStore(join(root, backend));
    await store.writeObject("kinfolk.json", objectBytes(k));
    await store.writeObject("story.json", objectBytes(story));
    await store.writeObject("manifest.json", objectBytes(manifest));
    await store.writeObject("signature.json", objectBytes(signature));
  }
}

async function seedSharedManifest(root: string, tamperBody?: string) {
  const kinfolk = { id: "k-test", displayName: "Test Kinfolk", publicKey: testPublicKey };
  const story = { id: "s-test", title: "t", body: "b", media: [], authorId: "k-test", createdAt: "2026-09-19T00:00:00.000Z" };
  const manifest = createManifest("pkg-test", [
    { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
    { path: "story.json", contentType: "application/json", value: story },
  ], "ed25519");
  const signature = signManifest(manifest, testPrivateKey);
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

test("reader verifies a real Ed25519 signature and rejects a forged one", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-signed-"));
  try {
    const pair = generateKeyPairSync("ed25519");
    const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const kinfolk = { id: "k", displayName: "K", publicKey };
    const story = { id: "s", title: "Signed", body: "body", media: [], authorId: "k", createdAt: "2026-09-20T00:00:00.000Z" };
    const manifest = createManifest("signed", [
      { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
      { path: "story.json", contentType: "application/json", value: story },
    ], "ed25519");
    const signature = signManifest(manifest, privateKey);
    if (signature.algorithm !== "ed25519") throw new Error("expected Ed25519 signature");
    const store = new LocalFolderStore(root);
    for (const [name, value] of Object.entries({ "kinfolk.json": kinfolk, "story.json": story, "manifest.json": manifest, "signature.json": signature })) {
      await store.writeObject(name, objectBytes(value));
    }
    await new KinfolkClient(store, "signed").fetchPackage();
    await store.writeObject("signature.json", objectBytes({ ...signature, value: signature.value.replace(/^./, signature.value[0] === "A" ? "B" : "A") }));
    await assert.rejects(() => new KinfolkClient(store, "signed").fetchPackage(), /Ed25519 signature verification failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("reader rejects a legacy downgrade and an unsigned content file", async () => {
  const root = await mkdtemp(join(tmpdir(), "rooted-downgrade-"));
  try {
    const kinfolk = { id: "k", displayName: "K", publicKey: testPublicKey };
    const story = { id: "s", title: "S", body: "B", media: [], authorId: "k", createdAt: "2026-09-20T00:00:00.000Z" };
    const store = new LocalFolderStore(root);
    const legacy = createManifest("p", [
      { path: "kinfolk.json", contentType: "application/json", value: kinfolk },
      { path: "story.json", contentType: "application/json", value: story },
    ]);
    for (const [name, value] of Object.entries({ "kinfolk.json": kinfolk, "story.json": story, "manifest.json": legacy, "signature.json": { algorithm: "demo-placeholder", signedManifestSha256: hashObject(legacy), note: "legacy" } })) {
      await store.writeObject(name, objectBytes(value));
    }
    await assert.rejects(() => new KinfolkClient(store, "legacy").fetchPackage(), /not Ed25519 signed/);
    const incomplete = createManifest("p", [{ path: "kinfolk.json", contentType: "application/json", value: kinfolk }], "ed25519");
    await store.writeObject("manifest.json", objectBytes(incomplete));
    await store.writeObject("signature.json", objectBytes(signManifest(incomplete, testPrivateKey)));
    await assert.rejects(() => new KinfolkClient(store, "incomplete").fetchPackage(), /manifest must list story.json exactly once/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
