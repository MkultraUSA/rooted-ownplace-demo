import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, hashObject, objectBytes, createManifest } from "../src/index.js";

test("canonical JSON and hashes do not depend on object key order", () => {
  assert.equal(canonicalJson({ z: 1, a: "two" }), '{"a":"two","z":1}');
  assert.equal(hashObject({ z: 1, a: "two" }), hashObject({ a: "two", z: 1 }));
  assert.equal(new TextDecoder().decode(objectBytes({ a: 1 })), '{"a":1}\n');
});

test("manifest records deterministic content hashes and demo signing boundary", () => {
  const manifest = createManifest("pkg", [{ path: "story.json", contentType: "application/json", value: { title: "Hello" } }]);
  assert.equal(manifest.signing, "demo-placeholder");
  assert.equal(manifest.objects[0].sha256, hashObject({ title: "Hello" }));
});

test("Kinfolk identity persists and rejects altered signed content", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadOrCreateIdentity, signManifest, verifyManifestSignature } = await import("../src/index.js");
  const dir = await mkdtemp(join(tmpdir(), "ownplace-id-"));
  try {
    const identity = loadOrCreateIdentity("kinfolk-test", dir);
    assert.equal(loadOrCreateIdentity("kinfolk-test", dir).publicKey, identity.publicKey);
    const kinfolk = { id: "kinfolk-test", displayName: "Test", publicKey: identity.publicKey };
    const manifest = createManifest("pkg", [{ path: "kinfolk.json", contentType: "application/json", value: kinfolk }], "ed25519");
    const signature = signManifest(manifest, identity.privateKey);
    assert.equal(verifyManifestSignature(manifest, signature, kinfolk), true);
    assert.equal(verifyManifestSignature({ ...manifest, packageId: "forged" }, signature, kinfolk), false);
    assert.equal(verifyManifestSignature(manifest, signature, { ...kinfolk, publicKey: "forged" }), false);
    assert.throws(() => loadOrCreateIdentity("../escape", dir), /unsafe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("RSA keys cannot be labeled as Ed25519", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { signManifest, verifyManifestSignature } = await import("../src/index.js");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifest = createManifest("rsa-test", [], "ed25519");
  assert.throws(() => signManifest(manifest, privateKey), /must be Ed25519/);
  const { sign } = await import("node:crypto");
  const forged = { algorithm: "ed25519", signedManifestSha256: hashObject(manifest), value: sign(null, objectBytes(manifest), privateKey).toString("base64") };
  assert.equal(verifyManifestSignature(manifest, forged, { id: "k", displayName: "K", publicKey }), false);
});
