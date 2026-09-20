// Thin CLI over @rooted/timeline: same lane the web write API uses.
// Syndication = everyone; no per-post targeting; paid gating is future work.

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
  console.error('usage: npm run post -- --title "TITLE" --body "BODY" [--author-id ID] [--author-name NAME]');
  process.exit(2);
}

const res = await publishStory(validated, backendsFromEnv(defaultRepoRoot()));
console.log(`done: ${res.backends.join(", ")} story=${res.storyId} author=${res.authorId}`);
