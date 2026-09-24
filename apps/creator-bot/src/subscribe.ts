import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LocalFolderStore } from "@rooted/storage";
import {
  addSubscriber,
  backendsFromEnv,
  defaultRepoRoot,
  validateSubscriber,
} from "@rooted/timeline";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  const value = process.argv[idx + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

const USAGE = "usage: npm run subscribe -- --reader-id ID --reader-pubkey FILE";

function fail(message: string): never {
  console.error(`subscribe failed: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

const readerId = arg("reader-id");
const pubkeyFile = arg("reader-pubkey");
if (!readerId || !pubkeyFile) fail("need --reader-id and --reader-pubkey");

let publicKey: string;
try {
  publicKey = readFileSync(pubkeyFile, "utf8");
} catch {
  fail("cannot read --reader-pubkey file");
}

let subscriber;
try {
  subscriber = validateSubscriber({ readerId, readerPublicKey: publicKey });
} catch (e) {
  fail((e as Error).message);
}

const backends = backendsFromEnv(defaultRepoRoot());
const written: string[] = [];
for (const backend of ["nextcloud-sim", "google-drive-sim"]) {
  const dir = resolve(backends.root, backend);
  await mkdir(dir, { recursive: true });
  await addSubscriber(new LocalFolderStore(dir), subscriber);
  written.push(backend);
}
console.log(`done: subscribed ${subscriber.readerId} on ${written.join(", ")}`);
