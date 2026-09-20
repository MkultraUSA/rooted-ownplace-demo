// Thin CLI over @rooted/timeline: same lane the web write API uses.
// Slice-1 paid gating: --entitle-reader ID plus --reader-pubkey FILE seals the body for one reader; default posts stay public.

import { readFileSync } from "node:fs";
import { defaultRepoRoot, backendsFromEnv, publishStory, validateInput } from "@rooted/timeline";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  const value = process.argv[idx + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

let validated;
try {
  validated = validateInput({
    title: arg("title") ?? "",
    body: arg("body") ?? "",
    authorId: arg("author-id"),
    authorName: arg("author-name"),
  });
} catch (e) {
  console.error(`post failed: ${(e as Error).message}`);
  console.error('usage: npm run post -- --title "TITLE" --body "BODY" [--author-id ID] [--author-name NAME] [--entitle-reader ID --reader-pubkey FILE]');
  process.exit(2);
}

let entitle: { readerId: string; readerPublicKey: string } | undefined;
const entitleReader = arg("entitle-reader");
const readerPubkeyFile = arg("reader-pubkey");
if ((entitleReader === undefined) !== (readerPubkeyFile === undefined)) {
  console.error("post failed: --entitle-reader and --reader-pubkey must be used together");
  process.exit(2);
}
if (entitleReader !== undefined && readerPubkeyFile !== undefined) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entitleReader) || entitleReader.includes("..")) {
    console.error("post failed: unsafe entitle-reader id");
    process.exit(2);
  }
  try {
    entitle = { readerId: entitleReader, readerPublicKey: readFileSync(readerPubkeyFile, "utf8") };
  } catch {
    console.error("post failed: cannot read --reader-pubkey file");
    process.exit(2);
  }
}
const res = await publishStory(validated, backendsFromEnv(defaultRepoRoot()), { entitle });
console.log(`done: ${res.backends.join(", ")} story=${res.storyId} author=${res.authorId}`);
