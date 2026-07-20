#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbiddenPaths = [
  /(^|\/)fixtures\//,
  /(^|\/)maestro\//,
  /(^|\/)data\//,
  /(^|\/)output\//,
  /(^|\/)runtime\//,
  /(^|\/)\.playwright-cli\//,
  /^apps\/web\/scripts\/.*(?:smoke|audit)/,
  /^apps\/web\/scripts\/run-all-project-tests\.mjs$/,
  /^apps\/web\/scripts\/(?:deploy-fixed-tunnel|deploy-public-tunnel)\.mjs$/,
  /(^|\/)\.env(?:\.|$)(?!example$)/
];

const forbiddenContent = [
  { label: "private domain", pattern: /superjunior\.online/i },
  { label: "private user path", pattern: /\/Users\/junior\// },
  { label: "private LAN address", pattern: /172\.18\.40\.133/ },
  { label: "machine tunnel configuration", pattern: /(?:cloudflared|LaunchAgents\/|deploy:fixed)/i },
  { label: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /gh[oprsu]_[A-Za-z0-9_]{20,}/ },
  { label: "OpenAI key", pattern: /sk-[A-Za-z0-9_-]{40,}/ }
];

const failures = [];

for (const file of tracked) {
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: forbidden public-source path`);
    continue;
  }

  if (file === "scripts/public-source-audit.mjs") continue;

  let content;
  try {
    content = await readFile(file, "utf8");
  } catch {
    continue;
  }

  for (const check of forbiddenContent) {
    if (check.pattern.test(content)) failures.push(`${file}: ${check.label}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`public source audit passed (${tracked.length} tracked files)`);
