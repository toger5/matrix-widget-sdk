// One version for everything this repository publishes (crates and npm packages), kept in
// `[workspace.package].version` in Cargo.toml. Run from the repository root (RELEASING.md):
//
//   node scripts/set-version.mjs 0.2.0          write it to Cargo.toml (the workspace version and the
//                                                versions of the internal path dependencies), to every
//                                                packages/*/package.json, Cargo.lock and package-lock.json
//   node scripts/set-version.mjs --check 0.2.0  exit 1 unless every one of those places says 0.2.0
//
// `scripts/pack-npm.mjs` imports `workspaceVersion()`.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargoToml = join(root, "Cargo.toml");
// Semver without build metadata (npm drops it, crates.io ignores it).
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// `version = "…"` in `[workspace.package]`, up to the next table.
const WORKSPACE_VERSION = /(\[workspace\.package\][^[]*?\nversion = ")([^"]+)(")/;
// `widget-foo = { path = "crates/…", version = "…" }` in `[workspace.dependencies]`.
const PATH_DEPENDENCY = /^([\w-]+ = \{ path = "crates\/[^"]+", version = ")([^"]+)(" \})$/gm;

/** The version in `[workspace.package]` of Cargo.toml. */
export function workspaceVersion() {
  const match = readFileSync(cargoToml, "utf8").match(WORKSPACE_VERSION);
  if (!match) throw new Error("Cargo.toml: no version in [workspace.package]");
  return match[2];
}

const packageJsons = () =>
  readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, "packages", entry.name, "package.json"));

/** Every place that carries the version, with what it says. */
function versions() {
  const cargo = readFileSync(cargoToml, "utf8");
  return [
    ["Cargo.toml [workspace.package]", workspaceVersion()],
    ...[...cargo.matchAll(PATH_DEPENDENCY)].map((m) => [`Cargo.toml ${m[1].split(" ")[0]}`, m[2]]),
    ...packageJsons().map((path) => [path.slice(root.length + 1), JSON.parse(readFileSync(path, "utf8")).version]),
  ];
}

function check(version) {
  const wrong = versions().filter(([, v]) => v !== version);
  for (const [where, v] of wrong) console.error(`::error::${where} says ${v}, expected ${version}`);
  if (wrong.length) {
    console.error(`Run \`node scripts/set-version.mjs ${version}\` and commit the result.`);
    process.exit(1);
  }
  console.log(`All versions are ${version}.`);
}

function set(version) {
  let cargo = readFileSync(cargoToml, "utf8");
  cargo = cargo.replace(WORKSPACE_VERSION, `$1${version}$3`).replace(PATH_DEPENDENCY, `$1${version}$3`);
  writeFileSync(cargoToml, cargo);
  for (const path of packageJsons()) {
    const text = readFileSync(path, "utf8");
    // Only the top-level field, so the file keeps its formatting.
    writeFileSync(path, text.replace(/^( {2}"version": ")[^"]+(")/m, `$1${version}$2`));
  }
  execFileSync("cargo", ["update", "--workspace", "--offline"], { cwd: root, stdio: "inherit" });
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  check(version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const checkOnly = args[0] === "--check";
  const version = checkOnly ? args[1] : args[0];
  if (!version || !SEMVER.test(version)) {
    console.error("usage: node scripts/set-version.mjs [--check] <major.minor.patch[-prerelease]>");
    process.exit(2);
  }
  if (checkOnly) check(version);
  else set(version);
}
