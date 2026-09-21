import { execFileSync } from "node:child_process";

const restrictedPatterns = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  ".env.ownplace",
  "**/.env.ownplace",
  "demo/stores",
  "demo/stores/**",
  "**/demo/stores/**",
  "secrets",
  "secrets/**",
  "**/secrets/**",
  ".secret",
  "**/.secret",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key",
  "*.p12",
  "**/*.p12",
  "*.pfx",
  "**/*.pfx",
  "id_rsa",
  "**/id_rsa",
  "id_ed25519",
  "**/id_ed25519",
  "credentials.json",
  "**/credentials.json",
  "service-account*.json",
  "**/service-account*.json",
];

const trackedFiles = process.argv.includes("--self-test")
  ? [
      ".ENV",
      "keys/ADMIN.PEM",
      "CREDENTIALS.JSON",
      "Id_rsa",
      "secrets",
      "demo/stores",
    ]
  : execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/"));

function escapeRegex(value) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern) {
  const normalized = pattern.replaceAll("\\", "/");
  let source = "";

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === "*" && next === "*") {
      const afterDoubleStar = normalized[i + 2];
      if (afterDoubleStar === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegex(char);
  }

  return new RegExp(`^${source}$`, "i");
}

const restricted = restrictedPatterns.map((pattern) => ({
  pattern,
  regex: globToRegex(pattern),
}));

const violations = trackedFiles
  .map((file) => ({
    file,
    pattern: restricted.find(({ regex }) => regex.test(file))?.pattern,
  }))
  .filter(({ pattern }) => pattern);

if (violations.length > 0) {
  console.error("Restricted secret/operator paths are tracked:");
  for (const { file, pattern } of violations) {
    console.error(`- ${file} matched ${pattern}`);
  }
  console.error("Move secrets and generated stores outside git history before merging.");
  process.exit(1);
}

console.log(`Secret path guard passed (${trackedFiles.length} tracked files checked).`);
