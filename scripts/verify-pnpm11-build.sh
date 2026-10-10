#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$*"
}

command -v node >/dev/null 2>&1 || fail "Node.js is required"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required"

printf 'Node.js: '
node --version
printf 'pnpm: '
pnpm --version

node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const [major, minor] = process.versions.node.split(".").map(Number);
const nodeSupported =
  (major === 22 && minor >= 18) ||
  (major >= 24 && (major !== 24 || minor >= 11));

if (!nodeSupported) {
  fail(`Node.js ${process.versions.node} is outside ^22.18.0 || >=24.11.0`);
}

const root = JSON.parse(fs.readFileSync("package.json", "utf8"));
const workspaceText = fs.readFileSync("pnpm-workspace.yaml", "utf8");

if (root.packageManager !== "pnpm@11.24.0") {
  fail(`Expected packageManager pnpm@11.24.0, found ${root.packageManager}`);
}
if (root.devDependencies?.turbo || root.dependencies?.turbo) {
  fail("Turbo remains a root dependency; Termux-safe builds must not invoke/install its binary");
}
for (const name of ["build", "typecheck", "test"]) {
  const command = root.scripts?.[name] ?? "";
  if (!command.includes("--recursive") || !command.includes("--if-present") || /\bturbo\b/.test(command)) {
    fail(`Root script '${name}' must use the pnpm recursive fallback without Turbo`);
  }
}

if (!/^strictDepBuilds:\s*true\s*$/m.test(workspaceText)) {
  fail("pnpm-workspace.yaml must set strictDepBuilds: true");
}
if (!/^engineStrict:\s*true\s*$/m.test(workspaceText)) {
  fail("pnpm-workspace.yaml must set engineStrict: true");
}
if (!/^  esbuild:\s*true\s*$/m.test(workspaceText)) {
  fail("pnpm-workspace.yaml must explicitly approve esbuild");
}
if (/onlyBuiltDependencies|ignoredBuiltDependencies|neverBuiltDependencies/.test(workspaceText)) {
  fail("Legacy pnpm build-approval keys are not valid for pnpm v11");
}

const members = [...workspaceText.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
if (members.length === 0) fail("No workspace members were found");

for (const member of members) {
  const manifestPath = path.join(member, "package.json");
  if (!fs.existsSync(manifestPath)) {
    fail(`Workspace entry has no package.json: ${member}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const scriptName of ["build", "typecheck"]) {
    const script = manifest.scripts?.[scriptName];
    if (typeof script !== "string") continue;

    const tscIndex = script.search(/(?:^|[\s;&|])tsc(?:\s|$)/);
    if (tscIndex < 0) continue;
    const tscCommand = script.slice(tscIndex);
    if (/--filter(?:=|\s|$)|--prefer-offline(?:=|\s|$)/.test(tscCommand)) {
      fail(`${member} package script '${scriptName}' passes pnpm flags to TypeScript: ${script}`);
    }
  }
}

console.log(`Validated ${members.length} workspace manifests, pinned pnpm, lifecycle policy, and TypeScript script flags.`);
NODE
pass "configuration audit"

if [[ "$(pnpm --version)" != "11.24.0" ]]; then
  fail "Use the pinned package-manager version: corepack pnpm@11.24.0"
fi

printf '\n== Install (frozen lockfile) ==\n'
pnpm install --frozen-lockfile
pass "frozen install"

printf '\n== Build all workspace packages in topological order ==\n'
pnpm run build
pass "workspace build"

printf '\n== Strict TypeScript checks ==\n'
pnpm run typecheck
pass "workspace typecheck"

printf '\n== Vercel backend build command ==\n'
pnpm --filter @klyn/backend run build
pass "Vercel backend build"

printf '\nALL CHECKS PASSED\n'
