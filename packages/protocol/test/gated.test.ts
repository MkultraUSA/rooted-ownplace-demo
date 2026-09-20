import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  isSealedBody,
  loadOrCreateEncryptionIdentity,
  sealBody,
  tryOpenBody,
  unsealBody,
} from "../src/index.js";

function x25519Pair() {
  const pair = generateKeyPairSync("x25519");
  return {
    priv: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    pub: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function mutateB64(value: string): string {
  const idx = value[0] === "A" ? 1 : 0;
  return value.slice(0, idx) + (value[idx] === "A" ? "B" : "A") + value.slice(idx + 1);
}

test("sealed body round-trips for the entitled reader only", () => {
  const reader = x25519Pair();
  const stranger = x25519Pair();
  const env = sealBody("paid story for bob", reader.pub, "reader-bob");
  assert.equal(env.algorithm, "aes-256-gcm");
  assert.equal(env.wrapped.readerId, "reader-bob");
  assert.equal(unsealBody(env, reader.priv, "reader-bob"), "paid story for bob");
  assert.throws(() => unsealBody(env, stranger.priv, "stranger-x"), /not entitled/);
  assert.throws(() => unsealBody(env, reader.priv, "reader-eve"), /not entitled/);
  assert.deepEqual(tryOpenBody({ body: "", restricted: env }, reader.priv, "reader-bob"), {
    status: "opened",
    body: "paid story for bob",
  });
  assert.deepEqual(tryOpenBody({ body: "", restricted: env }, stranger.priv, "stranger-x").status, "not-entitled");
  assert.deepEqual(tryOpenBody({ body: "", restricted: env }).status, "restricted");
  assert.deepEqual(tryOpenBody({ body: "hi" }).status, "public");
});

test("tampered envelopes fail closed with a fixed message", () => {
  const reader = x25519Pair();
  const env = sealBody("paid story", reader.pub, "reader-bob");
  for (const tampered of [
    { ...env, ciphertext: mutateB64(env.ciphertext) },
    { ...env, bodyNonce: mutateB64(env.bodyNonce) },
    { ...env, wrapped: { ...env.wrapped, wrappedKey: mutateB64(env.wrapped.wrappedKey) } },
    { ...env, wrapped: { ...env.wrapped, keyNonce: mutateB64(env.wrapped.keyNonce) } },
  ]) {
    assert.throws(() => unsealBody(tampered, reader.priv, "reader-bob"), /not entitled/);
  }
});

test("malformed envelopes are malformed, not not-entitled", () => {
  const reader = x25519Pair();
  for (const bad of [
    {},
    null,
    { ...sealBody("x", reader.pub, "reader-bob"), algorithm: "rot13" },
    { ...sealBody("x", reader.pub, "reader-bob"), ciphertext: "!!!" },
    { ...sealBody("x", reader.pub, "reader-bob"), wrapped: undefined },
  ]) {
    assert.throws(() => unsealBody(bad, reader.priv), /malformed/);
    assert.equal(tryOpenBody({ body: "", restricted: bad }, reader.priv).status, "unreadable");
  }
  // Plaintext body alongside an envelope fails closed even with the right key.
  const env = sealBody("x", reader.pub, "reader-bob");
  assert.equal(tryOpenBody({ body: "LEAK", restricted: env }, reader.priv, "reader-bob").status, "unreadable");
});

test("seals are randomized and inputs are validated", () => {
  const reader = x25519Pair();
  const a = sealBody("same words", reader.pub, "reader-bob");
  const b = sealBody("same words", reader.pub, "reader-bob");
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.notEqual(a.wrapped.wrappedKey, b.wrapped.wrappedKey);
  assert.equal(isSealedBody(a), true);
  assert.equal(isSealedBody({}), false);
  assert.throws(() => sealBody("x", reader.pub, "../evil"), /unsafe/);
  assert.throws(() => sealBody("", reader.pub, "reader-bob"), /non-empty/);
  const ed = generateKeyPairSync("ed25519");
  const edPub = ed.publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.throws(() => sealBody("x", edPub, "reader-bob"), /must be X25519/);
});

test("encryption identity persists beside the signing identity", async () => {
  const { mkdtemp, rm, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "ownplace-enc-"));
  try {
    const first = loadOrCreateEncryptionIdentity("reader-bob", dir);
    assert.equal(loadOrCreateEncryptionIdentity("reader-bob", dir).publicKey, first.publicKey);
    assert.ok((await readdir(dir)).includes("reader-bob.enc.pem"));
    assert.throws(() => loadOrCreateEncryptionIdentity("../escape", dir), /unsafe/);
    // The encryption key actually seals: end-to-end through the persisted key.
    const env = sealBody("persisted", first.publicKey, "reader-bob");
    assert.equal(unsealBody(env, first.privateKey, "reader-bob"), "persisted");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
