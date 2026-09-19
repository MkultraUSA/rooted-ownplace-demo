import { mkdir, readdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export interface ObjectStore {
  listObjects(prefix?: string): Promise<string[]>;
  readObject(path: string): Promise<Uint8Array>;
  writeObject(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export class LocalFolderStore implements ObjectStore {
  constructor(public readonly root: string) {}
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
  readObject(path: string): Promise<Uint8Array> { return readFile(join(this.root, path)); }
  async writeObject(path: string, bytes: Uint8Array): Promise<void> {
    const target = join(this.root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  async exists(path: string): Promise<boolean> {
    return access(join(this.root, path)).then(() => true, () => false);
  }
}

export class WebDavStore implements ObjectStore {
  constructor(readonly message = "WebDAV adapter scaffold: configure a real endpoint before use") {}
  private unavailable(): never { throw new Error(this.message); }
  listObjects(): Promise<string[]> { return this.unavailable(); }
  readObject(): Promise<Uint8Array> { return this.unavailable(); }
  writeObject(): Promise<void> { return this.unavailable(); }
  exists(): Promise<boolean> { return this.unavailable(); }
}

export class GoogleDriveStore extends WebDavStore {
  constructor() { super("Google Drive adapter scaffold: use OAuth/rclone; no credentials are bundled"); }
}
