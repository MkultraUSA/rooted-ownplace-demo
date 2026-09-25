import { lstatSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

export interface ObjectStore {
  listObjects(prefix?: string): Promise<string[]>;
  readObject(path: string): Promise<Uint8Array>;
  writeObject(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  deleteObject(path: string): Promise<void>;
}

export class LocalFolderStore implements ObjectStore {
  constructor(public readonly root: string) {}
  private resolve(path: string): string {
    if (!path || path.startsWith("/") || path.includes("\\")) throw new Error(`unsafe store path: ${path}`);
    const root = resolve(this.root);
    const target = resolve(root, path);
    const rel = relative(root, target);
    if (rel === "" || rel.startsWith("..") || rel.includes("../")) throw new Error(`store path escapes root: ${path}`);
    // Refuse symlinks on every existing component. A timeline/<id> symlink
    // must not be followed out of the porch on read or write.
    let cursor = root;
    for (const part of rel.split("/")) {
      if (!part || part === ".") continue;
      cursor = resolve(cursor, part);
      try {
        if (lstatSync(cursor).isSymbolicLink()) throw new Error(`store path escapes root: ${path}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") break;
        throw e;
      }
    }
    return target;
  }
  async listObjects(prefix = ""): Promise<string[]> {
    const walk = async (folder: string): Promise<string[]> => {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      const paths: string[] = [];
      for (const entry of entries) {
        const full = join(folder, entry.name);
        if (entry.isDirectory()) paths.push(...await walk(full));
        else paths.push(relative(this.root, full).replaceAll("\\", "/"));
      }
      return paths;
    };
    return (await walk(this.root)).filter((path) => path.startsWith(prefix));
  }
  readObject(path: string): Promise<Uint8Array> { return readFile(this.resolve(path)); }
  async writeObject(path: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  async exists(path: string): Promise<boolean> {
    let target: string;
    try { target = this.resolve(path); } catch { return false; }
    return access(target).then(() => true, () => false);
  }
  async deleteObject(path: string): Promise<void> {
    // Delete-if-exists: missing file is not an error (clears stale flat
    // copies); unsafe paths still throw fail-closed via resolve().
    await rm(this.resolve(path), { force: true });
  }
}


function checkPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\")) throw new Error(`unsafe store path: ${path}`);
  const parts = path.split("/");
  if (parts.includes("") || parts.includes(".") || parts.includes("..")) throw new Error(`store path escapes root: ${path}`);
}

function parsePropfindPaths(xml: string): string[] {
  // Minimal multistatus href extractor: collects <d:href> values, decodes them.
  const out: string[] = [];
  const re = /<[^>]*href[^>]*>([^<]+)<\/[^>]*href[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    try { out.push(decodeURIComponent(m[1].trim())); } catch { out.push(m[1].trim()); }
  }
  return out;
}

export class WebDavStore implements ObjectStore {
  readonly name = "webdav";
  private baseUrl: string;
  private auth: string;

  constructor(opts: { baseUrl: string; username: string; password: string }) {
    const { baseUrl, username, password } = opts;
    if (!baseUrl || !username || !password) {
      throw new Error("WebDavStore requires baseUrl, username, password (pass via env, never commit)");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }

  static fromEnv(prefix = "KEVCLOUD"): WebDavStore {
    const get = (k: string) => process.env[`${prefix}_${k}`] ?? "";
    return new WebDavStore({ baseUrl: get("WEBDAV_URL"), username: get("WEBDAV_USER"), password: get("WEBDAV_PASS") });
  }

  private url(path: string): string {
    return `${this.baseUrl}/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  async writeObject(path: string, bytes: Uint8Array): Promise<void> {
    checkPath(path);
    // Ensure parent collections exist (MKCOL each level; 201 created,
    // 405/409/412 = already exists or ancestor conflict, tolerated:
    // the final PUT is authoritative and its status is checked strictly).
    const dir = dirname(path);
    if (dir !== ".") {
      const parts = dir.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const coll = parts.slice(0, i).join("/");
        const res = await fetch(this.url(coll + "/"), { method: "MKCOL", headers: { Authorization: this.auth } });
        if (![201, 405, 409, 412].includes(res.status)) throw new Error(`WebDAV MKCOL ${coll} failed: ${res.status}`);
      }
    }
    const res = await fetch(this.url(path), {
      method: "PUT",
      headers: { Authorization: this.auth, "Content-Type": "application/octet-stream" },
      body: bytes as unknown as BodyInit,
    });
    if (![200, 201, 204].includes(res.status)) throw new Error(`WebDAV PUT ${path} failed: ${res.status}`);
  }

  async readObject(path: string): Promise<Uint8Array> {
    checkPath(path);
    const res = await fetch(this.url(path), { headers: { Authorization: this.auth } });
    if (res.status === 404) throw new Error(`WebDAV object not found: ${path}`);
    if (!res.ok) throw new Error(`WebDAV GET ${path} failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    checkPath(path);
    const res = await fetch(this.url(path), { method: "HEAD", headers: { Authorization: this.auth } });
    if (res.status === 404) return false;
    return res.ok;
  }

  async deleteObject(path: string): Promise<void> {
    // Delete-if-exists for stale flat copies: 404 is not an error.
    checkPath(path);
    const res = await fetch(this.url(path), { method: "DELETE", headers: { Authorization: this.auth } });
    if (res.status === 404) return;
    if (!res.ok && res.status !== 204) throw new Error(`WebDAV DELETE ${path} failed: ${res.status}`);
  }

  async listObjects(prefix = ""): Promise<string[]> {
    if (prefix) checkPath(prefix.replace(/\/$/, ""));
    const target = prefix ? this.url(prefix.replace(/\/$/, "") + "/") : this.baseUrl + "/";
    const res = await fetch(target, {
      method: "PROPFIND",
      headers: {
        Authorization: this.auth,
        Depth: "infinity",
        "Content-Type": "application/xml",
      },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`,
    });
    if (!res.ok) throw new Error(`WebDAV PROPFIND failed: ${res.status}`);
    const xml = await res.text();
    const basePath = new URL(this.baseUrl).pathname.replace(/\/$/, "");
    const out: string[] = [];
    for (const href of parsePropfindPaths(xml)) {
      let rel = href;
      try { rel = new URL(href, this.baseUrl).pathname; } catch { /* already a path */ }
      rel = rel.replace(basePath, "").replace(/^\//, "");
      if (!rel || rel === prefix.replace(/\/$/, "")) continue;
      if (prefix && !rel.startsWith(prefix.replace(/\/$/, ""))) continue;
      if (rel.endsWith("/")) continue; // collections, not objects
      out.push(rel);
    }
    return [...new Set(out)].sort();
  }
}


export class GoogleDriveStore implements ObjectStore {
  readonly name = "google-drive-rclone-scaffold";
  private unavailable(): never {
    throw new Error(
      "GoogleDriveStore is a scaffold: sync via scripts/sync-drive.sh (rclone rooted_drive:) on Hostinger; no credentials are bundled"
    );
  }
  listObjects(): Promise<string[]> { return this.unavailable(); }
  readObject(): Promise<Uint8Array> { return this.unavailable(); }
  writeObject(): Promise<void> { return this.unavailable(); }
  exists(): Promise<boolean> { return this.unavailable(); }
  deleteObject(): Promise<void> { return this.unavailable(); }
}
