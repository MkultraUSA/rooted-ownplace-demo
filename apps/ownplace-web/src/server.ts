// OwnPlace write API: serves the built web UI and exposes JSON endpoints.
// Reads serve local sims (static demo). Writes go through @rooted/timeline
// — the SAME lane as the CLI — so web posts syndicate to every backend.
//
// Endpoints:
//   GET  /api/timeline?backend=nextcloud-sim        timeline index
//   GET  /api/story?backend=B&id=ID                 single story package
//   GET  /api/contacts                              contact list
//   POST /api/post        {title, body, authorId?, authorName?}
//   POST /api/contacts    {id, displayName}  |  DELETE /api/contacts?id=ID
//
// Write auth: single-operator demo token via OWNPLACE_WRITE_TOKEN env.
// Requests without a matching `Authorization: Bearer <token>` get 401 for
// POST/DELETE only; reads stay public. When the env var is unset, writes
// are allowed locally with a console warning (dev convenience, not a claim).

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  addContact,
  backendsFromEnv,
  defaultRepoRoot,
  publishStory,
  readContacts,
  removeContact,
  validateContact,
  validateInput,
} from "@rooted/timeline";
import { LocalFolderStore } from "@rooted/storage";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = defaultRepoRoot();
const distDir = path.resolve(here, "../../dist");
const port = Number(process.env.PORT ?? 8091);
const writeToken = process.env.OWNPLACE_WRITE_TOKEN ?? "";

if (!writeToken) {
  console.warn("OWNPLACE_WRITE_TOKEN unset: write endpoints are open (local dev mode)");
}

function simStore(backend: string): LocalFolderStore {
  if (backend !== "nextcloud-sim" && backend !== "google-drive-sim") {
    throw new Error("unknown backend");
  }
  return new LocalFolderStore(path.resolve(repoRoot, "demo/stores", backend));
}

async function readJsonBody(req: http.IncomingMessage, limit = 32 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: http.ServerResponse, status: number, body: unknown, contentType = "application/json"): void {
  const text = contentType === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, { "content-type": contentType });
  res.end(text);
}

function authorized(req: http.IncomingMessage): boolean {
  if (!writeToken) return true; // dev mode (warned at startup)
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${writeToken}`;
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;

    // --- Reads (public) ---
    if (req.method === "GET" && pathname === "/api/timeline") {
      const backend = url.searchParams.get("backend") ?? "nextcloud-sim";
      try {
        const raw = new TextDecoder().decode(await simStore(backend).readObject("timeline.json"));
        send(res, 200, JSON.parse(raw));
      } catch {
        send(res, 404, { error: "no timeline" });
      }
      return;
    }
    if (req.method === "GET" && pathname === "/api/story") {
      const backend = url.searchParams.get("backend") ?? "nextcloud-sim";
      const id = url.searchParams.get("id") ?? "";
      if (!id || id.includes("/") || id.includes("..")) {
        send(res, 400, { error: "bad id" });
        return;
      }
      try {
        const store = simStore(backend);
        const story = JSON.parse(new TextDecoder().decode(await store.readObject(`timeline/${id}/story.json`)));
        send(res, 200, story);
      } catch {
        send(res, 404, { error: "not found" });
      }
      return;
    }
    if (req.method === "GET" && pathname === "/api/contacts") {
      const list = await readContacts(simStore("nextcloud-sim"));
      send(res, 200, list);
      return;
    }

    // --- Writes (token-gated) ---
    if (req.method === "POST" && pathname === "/api/post") {
      if (!authorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      let input: unknown;
      try {
        input = await readJsonBody(req);
      } catch {
        send(res, 400, { error: "invalid JSON body" });
        return;
      }
      const rec = (input ?? {}) as Record<string, unknown>;
      let validated;
      try {
        validated = validateInput({
          title: rec.title as string,
          body: rec.body as string,
          authorId: rec.authorId as string | undefined,
          authorName: rec.authorName as string | undefined,
        });
      } catch (e) {
        send(res, 400, { error: (e as Error).message });
        return;
      }
      const result = await publishStory(validated, backendsFromEnv(repoRoot));
      send(res, 201, result);
      return;
    }
    if ((req.method === "POST" || req.method === "DELETE") && pathname === "/api/contacts") {
      if (!authorized(req)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const store = simStore("nextcloud-sim");
      if (req.method === "DELETE") {
        const id = url.searchParams.get("id") ?? "";
        if (!id) {
          send(res, 400, { error: "id required" });
          return;
        }
        send(res, 200, await removeContact(store, id));
        return;
      }
      let input: unknown;
      try {
        input = await readJsonBody(req);
      } catch {
        send(res, 400, { error: "invalid JSON body" });
        return;
      }
      try {
        const contact = validateContact((input ?? {}) as { id?: unknown; displayName?: unknown });
        send(res, 201, await addContact(store, contact));
      } catch (e) {
        send(res, 400, { error: (e as Error).message });
        return;
      }
      return;
    }

    // --- Static bundle ---
    if (req.method === "GET") {
      const rel = pathname === "/" ? "index.html" : pathname.replace(/^\//, "").split("?")[0];
      if (rel.includes("..")) {
        send(res, 400, { error: "bad path" });
        return;
      }
      try {
        const data = await readFile(path.join(distDir, rel));
        const ext = path.extname(rel);
        res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
        res.end(data);
      } catch {
        send(res, 404, "not found", "text/plain");
      }
      return;
    }
    send(res, 405, { error: "method not allowed" });
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OwnPlace API + web on http://127.0.0.1:${port}`);
});
