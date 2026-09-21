import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const serverEntry = resolve(repoRoot, "apps/ownplace-web/src/server.ts");
const TEST_PORT = 18091;

function cleanEnv(tmp: string): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PUBLISH_ROOT: tmp,
    PORT: String(TEST_PORT),
  };
  // Hermetic: no write token (dev mode leaves writes open), no cloud backends.
  delete env.OWNPLACE_WRITE_TOKEN;
  delete env.KEVCLOUD_WEBDAV_URL;
  delete env.KEVCLOUD_WEBDAV_USER;
  delete env.KEVCLOUD_WEBDAV_PASS;
  delete env.GOOGLE_DRIVE_SYNC;
  return env as NodeJS.ProcessEnv;
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const { status } = await get("/api/health");
      if (status === 200) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("server did not become ready");
    await new Promise((r) => setTimeout(r, 200));
  }
}

function request(
  method: string,
  path: string,
  rawBody?: string
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: TEST_PORT, path, method },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: unknown = null;
          try {
            json = JSON.parse(data);
          } catch {
            // non-JSON (e.g. text/plain 404) stays null
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on("error", reject);
    if (rawBody !== undefined) req.write(rawBody);
    req.end();
  });
}

const get = (path: string) => request("GET", path);
const postJson = (path: string, value: unknown) =>
  request("POST", path, JSON.stringify(value));
const postRaw = (path: string, raw: string) => request("POST", path, raw);

// Raw engine internals must never reach the wire: no paths, no errno,
// no exception class names, no stack frames.
const LEAK_PATTERNS = ["/", "\\", "Error", "error:", "ENOENT", "at ", ".mjs", ".ts:"];

function assertNoLeak(status: number, json: unknown) {
  assert.ok(
    status === 400 || status === 401 || status === 404 || status === 413 || status === 500,
    `expected error status, got ${status}`
  );
  const body = (json ?? {}) as Record<string, unknown>;
  assert.equal(typeof body.error, "string", `expected JSON error shape, got: ${JSON.stringify(json)}`);
  for (const p of LEAK_PATTERNS) {
    assert.ok(
      !(body.error as string).includes(p),
      `error leaks internals (${JSON.stringify(p)}): ${body.error}`
    );
  }
}

test("web API corrupt-JSON and invalid input stay stable and leak-free (#49)", async () => {
  const tmp = await mkdtemp(resolve(tmpdir(), "rooted-weberr-"));
  let child: ChildProcess | undefined;
  try {
    child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
      cwd: repoRoot,
      env: cleanEnv(tmp),
      stdio: "ignore",
    });
    await waitReady();

    // 1. Corrupt request bodies -> stable invalid-JSON message.
    for (const path of ["/api/post", "/api/contacts"]) {
      const r = await postRaw(path, "{not json");
      assert.equal(r.status, 400);
      assert.deepStrictEqual(r.json, { error: "invalid JSON body" });
    }

    // 2. Validation failures -> stable messages, no raw internals.
    const missing = await postJson("/api/post", {});
    assertNoLeak(missing.status, missing.json);
    assert.deepStrictEqual(missing.json, {
      error: "title and body are required and must be non-empty",
    });
    const tooLong = await postJson("/api/post", {
      title: "x".repeat(141),
      body: "ok",
    });
    assertNoLeak(tooLong.status, tooLong.json);
    assert.deepStrictEqual(tooLong.json, {
      error: "title too long: max 140 characters",
    });
    const badContact = await postJson("/api/contacts", { id: "../evil", displayName: "Evil" });
    assertNoLeak(badContact.status, badContact.json);
    assert.deepStrictEqual(badContact.json, {
      error: "contact id contains unsafe characters",
    });

    // 3. Bad query ids/backends -> stable messages.
    const badId = await get("/api/story?backend=nextcloud-sim&id=../evil");
    assertNoLeak(badId.status, badId.json);
    const badBackend = await get("/api/timeline?backend=nope");
    assertNoLeak(badBackend.status, badBackend.json);
    const missingContact = await request("DELETE", "/api/contacts?id=nope");
    assert.equal(missingContact.status, 404);
    assertNoLeak(missingContact.status, missingContact.json);
  } finally {
    child?.kill("SIGKILL");
    await rm(tmp, { recursive: true, force: true });
  }
});
