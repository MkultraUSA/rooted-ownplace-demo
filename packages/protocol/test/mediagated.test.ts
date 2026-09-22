import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { openGatedContent, sealGatedContent } from "../src/index.js";
import { sealBody } from "../src/index.js";

function x25519Pair() {
  const pair = generateKeyPairSync("x25519");
  return {
    priv: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    pub: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const READER = { readerId: "reader-bob", readerPublicKey: "" };

test("sealed media round-trips with the body for the entitled reader only", () => {
  const reader = x25519Pair();
  const stranger = x25519Pair();
  const media = ["https://poster.example/drive/a.jpg", "https://poster.example/drive/b.mp4"];
  const env = sealGatedContent("paid story for bob", media, [{ ...READER, readerPublicKey: reader.pub }]);
  assert.deepEqual(openGatedContent(env, reader.priv, "reader-bob"), {
    body: "paid story for bob",
    media,
    legacy: false,
  });
  assert.throws(() => openGatedContent(env, stranger.priv, "stranger-x"), /not entitled/);
});

test("legacy string bodies still open with empty media", () => {
  const reader = x25519Pair();
  const env = sealBody("paid story for bob", reader.pub, "reader-bob");
  assert.deepEqual(openGatedContent(env, reader.priv, "reader-bob"), {
    body: "paid story for bob",
    media: [],
    legacy: true,
  });
});

test("non-v1 JSON bodies stay legacy instead of misreading", () => {
  const reader = x25519Pair();
  const env = sealBody("[1,2]", reader.pub, "reader-bob");
  assert.deepEqual(openGatedContent(env, reader.priv, "reader-bob"), {
    body: "[1,2]",
    media: [],
    legacy: true,
  });
});

test("oversize or malformed media is rejected before sealing", () => {
  const reader = x25519Pair();
  const readers = [{ ...READER, readerPublicKey: reader.pub }];
  assert.throws(() => sealGatedContent("", [], readers), /body must be non-empty/);
  assert.throws(
    () => sealGatedContent("b", Array.from({ length: 9 }, (_, i) => `https://x.example/${i}`), readers),
    /at most 8/,
  );
  assert.throws(() => sealGatedContent("b", [""], readers), /at most 8/);
  assert.throws(() => sealGatedContent("b", ["x".repeat(2049)], readers), /at most 8/);
  assert.throws(() => sealGatedContent("b", [42] as unknown as string[], readers), /at most 8/);
  assert.throws(() => sealGatedContent("b", ["http://poster.example/m.jpg"], readers), /at most 8/);
  assert.throws(() => sealGatedContent("b", ["javascript:alert(1)"], readers), /at most 8/);
});
