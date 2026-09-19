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
