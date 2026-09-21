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

interface Client {
  request(method: string, path: string, rawBody?: string): Promise<{ status: number; json: unknown }>;
  close(): void;
}

async function boot(extraEnv: Record<string, string> = {}): Promise<{ child: ChildProcess; tmp: string; client: Client }> {
  const tmp = await mkdtemp(resolve(tmpdir(), "rooted-weberr-"));
  const env: Record<string, string | undefined> = {
    ...process.env,
    PUBLISH_ROOT: tmp,
    PORT: "0",
    ...extraEnv,
  };
  // Hermetic: cloud backends never enabled in the child.
  delete env.KEVCLOUD_WEBDAV_URL;
  delete env.KEVCLOUD_WEBDAV_USER;
  delete env.KEVCLOUD_WEBDAV_PASS;
  delete env.GOOGLE_DRIVE_SYNC;
  const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
    cwd: repoRoot,
    env: env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "ignore"],
  });
  // Ephemeral port: server logs the bound address (supports PORT=0).
  const port = await new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not log bound port")), 15000);
    let buf = "";
    child.stdout!.on("data", (d) => {
      buf += String(d);
      const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolvePort(Number(m[1]));
      }
    });
    child.on("exit", () => reject(new Error("server exited before logging bound port")));
  });
  const request = (method: string, path: string, rawBody?: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; json: unknown; raw: string }>((resolveReq, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: unknown = null;
          try {
            json = JSON.parse(data);
          } catch {
            // non-JSON (e.g. text/plain 404) stays null
          }
          resolveReq({ status: res.statusCode ?? 0, json, raw: data });
        });
      });
      req.on("error", reject);
      if (rawBody !== undefined) req.write(rawBody);
      req.end();
    });
  // Readiness: health endpoint (no store dependency).
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const r = await request("GET", "/api/health");
      if (r.status === 200) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error("server did not become ready");
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    child,
    tmp,
    client: {
      request: async (method, path, rawBody) => {
        const r = await request(method, path, rawBody);
        return { status: r.status, json: r.json };
      },
      close: () => child.kill("SIGKILL"),
    },
  };
}

// Raw engine internals must never reach the wire: no paths, no errno,
// no exception class names, no stack frames. Bare "/" was dropped as
// overbroad (it would fail legit prose); path-shaped and frame-shaped
// patterns catch real leaks instead.
const LEAK_PATTERNS: (string | RegExp)[] = [
  "\\",
  "Error",
  "error:",
  "ENOENT",
  "at ",
  ".mjs",
  ".ts:",
  /\.js:/,
  /\/[\w.-]+\//,
  /:\d+/,
];

function assertError(
  actual: { status: number; json: unknown },
  expectedStatus: number,
  expectedBody?: unknown
) {
  assert.equal(actual.status, expectedStatus);
  const body = (actual.json ?? {}) as Record<string, unknown>;
  assert.equal(typeof body.error, "string", `expected JSON error shape, got: ${JSON.stringify(actual.json)}`);
  if (expectedBody !== undefined) assert.deepStrictEqual(actual.json, expectedBody);
  for (const p of LEAK_PATTERNS) {
    const hit = typeof p === "string" ? (body.error as string).includes(p) : p.test(body.error as string);
    assert.ok(!hit, `error leaks internals (${String(p)}): ${body.error}`);
  }
}

// Covered: corrupt bodies, validation failures, bad ids/backends, missing
// contact, oversized body, wrong method, static 404, login 401/200.
// NOT covered: 500 outer-catch (needs store I/O fault injection; message is
// static "internal error" by inspection) — future work, not this slice.
test("web API corrupt-JSON and invalid input stay stable and leak-free (#49)", async () => {
  const { client, tmp } = await boot();
  try {
    // 1. Corrupt request bodies -> stable invalid-JSON message.
    for (const path of ["/api/post", "/api/contacts"]) {
      assertError(await client.request("POST", path, "{not json"), 400, { error: "invalid JSON body" });
    }

    // 2. Validation failures -> pinned stable messages, no raw internals.
    assertError(await client.request("POST", "/api/post", JSON.stringify({})), 400, {
      error: "title and body are required and must be non-empty",
    });
    // NOTE: 140/141 intentionally pin TITLE_MAX on the wire; if the constant
    // changes, this test MUST break so the new message is deliberately reviewed.
    assertError(
      await client.request("POST", "/api/post", JSON.stringify({ title: "x".repeat(141), body: "ok" })),
      400,
      { error: "title too long: max 140 characters" }
    );
    assertError(
      await client.request("POST", "/api/contacts", JSON.stringify({ id: "../evil", displayName: "Evil" })),
      400,
      { error: "contact id contains unsafe characters" }
    );

    // 3. Bad query ids/backends, missing contact -> stable messages.
    assertError(await client.request("GET", "/api/story?backend=nextcloud-sim&id=../evil"), 400, {
      error: "bad id",
    });
    assertError(await client.request("GET", "/api/timeline?backend=nope"), 400, {
      error: "unknown backend",
    });
    assertError(await client.request("DELETE", "/api/contacts?id=nope"), 404, {
      error: "contact not found",
    });

    // 4. Oversized body, wrong method, static asset miss.
    assertError(await client.request("POST", "/api/post", "x".repeat(33 * 1024)), 413, {
      error: "body too large",
    });
    assertError(await client.request("PUT", "/api/post", JSON.stringify({})), 405, {
      error: "method not allowed",
    });
    const miss = await client.request("GET", "/no-such-page");
    assert.equal(miss.status, 404);
    assert.equal(miss.json, null); // text/plain, never JSON error shape
  } finally {
    client.close();
    await rm(tmp, { recursive: true, force: true });
  }
  await new Promise((r) => setTimeout(r, 200));
});

test("web API login accepts the token and rejects anything else (#49)", async () => {
  const { client, tmp } = await boot({ OWNPLACE_WRITE_TOKEN: "t" });
  try {
    // No credentials -> 401, never a hint about the token.
    assertError(await client.request("POST", "/api/post", JSON.stringify({ title: "x", body: "y" })), 401, {
      error: "unauthorized",
    });
    assertError(
      await client.request("POST", "/api/login", JSON.stringify({ token: "wrong" })),
      401,
      { error: "unauthorized" }
    );
    const ok = await client.request("POST", "/api/login", JSON.stringify({ token: "t" }));
    assert.equal(ok.status, 200);
    assert.deepStrictEqual(ok.json, { ok: true });
  } finally {
    client.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
