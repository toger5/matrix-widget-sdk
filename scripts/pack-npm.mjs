// Packs the npm packages of this repository into `dist/npm/*.tgz`, ready for `npm publish <tgz>`
// (`.github/workflows/release.yml`; RELEASING.md). Run from the repository root: `npm run pack:npm`.
//
// Needs what `npm run build` needs: `npm run wasm` (widget side) and `npm run bindings` (host side).
//
//   @matrix-widget-sdk/widget          crates/matrix-widget-sdk/pkg (wasm-pack output), renamed
//   @matrix-widget-sdk/host            packages/widget-host-bindings, bundled into one ES module + its wasm
//   @matrix-widget-sdk/compat-wrapper  packages/widget-compat-wrapper, the built static page (dist/)
//   @matrix-widget-sdk/matrix-sdk-uniffi-js   only with --with-matrix-sdk (needs its own long build)
//
// Each package is staged in `dist/npm/stage/<name>/` with a generated package.json; the workspace
// packages stay `private` and keep exporting their TypeScript sources for development. Every
// version must equal `[workspace.package].version` in Cargo.toml (`scripts/set-version.mjs`).
//
//   --with-matrix-sdk   also pack matrix-sdk-uniffi-js
//   --out <dir>         output directory, default `dist/npm`

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { workspaceVersion } from "./set-version.mjs";

const SCOPE = "@matrix-widget-sdk";
const REPOSITORY = "https://github.com/toger5/matrix-widget-sdk";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const withMatrixSdk = args.includes("--with-matrix-sdk");
const outIndex = args.indexOf("--out");
const out = resolve(root, outIndex >= 0 ? args[outIndex + 1] : "dist/npm");
const stageRoot = join(out, "stage");
const version = workspaceVersion();

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const fail = (message) => {
  console.error(`pack-npm: ${message}`);
  process.exit(1);
};

/** The fields every published package.json shares. */
function manifest(dir, fields) {
  return {
    name: `${SCOPE}/${fields.name}`,
    version,
    description: fields.description,
    license: "Apache-2.0",
    repository: { type: "git", url: `git+${REPOSITORY}.git`, directory: dir },
    homepage: `${REPOSITORY}/tree/main/${dir}#readme`,
    bugs: `${REPOSITORY}/issues`,
    type: "module",
    ...Object.fromEntries(Object.entries(fields).filter(([key]) => !["name", "description"].includes(key))),
    publishConfig: { access: "public" },
  };
}

function stage(name) {
  const dir = join(stageRoot, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function requireFile(path, hint) {
  if (!existsSync(path)) fail(`${path.slice(root.length + 1)} is missing; run ${hint} first`);
}

/** A source package.json whose version is not the workspace version means set-version was not run. */
function checkSourceVersion(path) {
  const v = readJson(path).version;
  if (v !== version) fail(`${path.slice(root.length + 1)} has version ${v}, Cargo.toml ${version}; run scripts/set-version.mjs`);
}

// ---------------------------------------------------------------------------------------------
// @matrix-widget-sdk/widget: the wasm-pack output, renamed.

function packWidget() {
  const pkg = join(root, "crates/matrix-widget-sdk/pkg");
  requireFile(join(pkg, "package.json"), "`npm run wasm`");
  const generated = readJson(join(pkg, "package.json"));
  // wasm-pack takes the version from Cargo.toml; an older one means an old build.
  if (generated.version !== version) fail(`crates/matrix-widget-sdk/pkg is version ${generated.version}, Cargo.toml ${version}; run \`npm run wasm\``);
  const dir = stage("widget");
  for (const file of readdirSync(pkg)) {
    if (file !== "package.json" && file !== ".gitignore") cpSync(join(pkg, file), join(dir, file), { recursive: true });
  }
  const files = generated.files.filter((f) => existsSync(join(pkg, f)));
  if (existsSync(join(pkg, "snippets"))) files.push("snippets");
  writeJson(
    join(dir, "package.json"),
    manifest("crates/matrix-widget-sdk", {
      name: "widget",
      description: generated.description,
      keywords: ["matrix", "widget", "msc4412", "wasm"],
      main: generated.main,
      types: generated.types,
      exports: {
        ".": { types: `./${generated.types}`, default: `./${generated.main}` },
        "./package.json": "./package.json",
      },
      files: [...files, "README.md"],
      sideEffects: generated.sideEffects ?? false,
    }),
  );
  return dir;
}

// ---------------------------------------------------------------------------------------------
// @matrix-widget-sdk/host and matrix-sdk-uniffi-js: ubrn output, bundled.
//
// The generated TypeScript imports without file extensions and the package exports raw `.ts`, so
// it is bundled with esbuild into one `index.js`. `src/index.ts` finds the wasm with
// `new URL("./generated/wasm-bindgen/index_bg.wasm", import.meta.url)`, which esbuild leaves alone;
// the wasm is copied to that same path next to the bundle. Types come from `tsc --emitDeclarationOnly`
// with the source layout (`index.d.ts`, `generated/*.d.ts`).

async function packUniffiPackage({ source, name, description, keywords }) {
  const src = join(root, "packages", source);
  const sourceJson = readJson(join(src, "package.json"));
  checkSourceVersion(join(src, "package.json"));
  const wasm = join(src, "src/generated/wasm-bindgen/index_bg.wasm");
  requireFile(wasm, source === "widget-host-bindings" ? "`npm run bindings`" : `\`npm run bindings -w packages/${source}\``);
  const dir = stage(name);

  // Everything except the runtime the generated code imports is bundled.
  const external = Object.keys(sourceJson.dependencies ?? {});
  await build({
    entryPoints: [join(src, "src/index.ts")],
    outfile: join(dir, "index.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external,
    legalComments: "inline",
    logLevel: "warning",
  });
  const bundle = readFileSync(join(dir, "index.js"), "utf8");
  if (!bundle.includes('new URL("./generated/wasm-bindgen/index_bg.wasm", import.meta.url)')) {
    fail(`${source}: the bundle no longer finds its wasm with new URL(…, import.meta.url); see src/index.ts`);
  }
  mkdirSync(join(dir, "generated/wasm-bindgen"), { recursive: true });
  cpSync(wasm, join(dir, "generated/wasm-bindgen/index_bg.wasm"));

  const tsc = join(dirname(createRequire(join(src, "package.json")).resolve("typescript/package.json")), "bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", src, "--noEmit", "false", "--declaration", "--emitDeclarationOnly", "--outDir", dir], {
    stdio: "inherit",
  });
  // The wasm-bindgen glue is JavaScript with a hand-written declaration file, which tsc does not copy.
  cpSync(join(src, "src/generated/wasm-bindgen/index.d.ts"), join(dir, "generated/wasm-bindgen/index.d.ts"));
  // ubrn's own entrypoint, replaced by src/index.ts.
  rmSync(join(dir, "generated/index.web.d.ts"), { force: true });
  addJsExtensions(dir);
  cpSync(join(src, "README.md"), join(dir, "README.md"));

  writeJson(
    join(dir, "package.json"),
    manifest(`packages/${source}`, {
      name,
      description,
      keywords,
      main: "./index.js",
      types: "./index.d.ts",
      exports: {
        ".": { types: "./index.d.ts", default: "./index.js" },
        "./package.json": "./package.json",
      },
      files: ["index.js", "**/*.d.ts", "generated/wasm-bindgen/index_bg.wasm", "README.md"],
      dependencies: sourceJson.dependencies,
    }),
  );
  return dir;
}

// ---------------------------------------------------------------------------------------------
// @matrix-widget-sdk/compat-wrapper: the built page. A client serves `dist/` under its own origin.

function packCompatWrapper() {
  const src = join(root, "packages/widget-compat-wrapper");
  checkSourceVersion(join(src, "package.json"));
  const dir = stage("compat-wrapper");
  // The package's own vite, run by this node (as in build-dev-site.mjs: no npx download, no shell).
  const require = createRequire(join(src, "package.json"));
  const viteManifest = require.resolve("vite/package.json");
  const vite = join(dirname(viteManifest), require(viteManifest).bin.vite);
  execFileSync(process.execPath, [vite, "build", "--outDir", join(dir, "dist"), "--emptyOutDir"], { cwd: src, stdio: "inherit" });
  cpSync(join(src, "README.md"), join(dir, "README.md"));
  writeJson(
    join(dir, "package.json"),
    manifest("packages/widget-compat-wrapper", {
      name: "compat-wrapper",
      description:
        "Static page that wraps a legacy (matrix-widget-api) widget and speaks MSC4412 to the host. Serve dist/ under the client's own origin.",
      keywords: ["matrix", "widget", "msc4412", "matrix-widget-api"],
      exports: { "./*": "./dist/*", "./package.json": "./package.json" },
      files: ["dist", "README.md"],
    }),
  );
  return dir;
}

/**
 * The generated sources import `./matrix_widget_actions` without an extension, which bundlers resolve but
 * TypeScript's `node16` / `nodenext` resolution does not. Give every relative import in the
 * declaration files a `.js` extension (TypeScript maps it to the `.d.ts` next to it).
 */
function addJsExtensions(dir) {
  for (const entry of readdirSync(dir, { recursive: true })) {
    const path = join(dir, entry);
    if (!path.endsWith(".d.ts")) continue;
    const text = readFileSync(path, "utf8");
    const fixed = text.replace(/((?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']+?)(["'])/g, (match, head, spec, tail) =>
      /\.(?:js|json|wasm)$/.test(spec) ? match : `${head}${spec}.js${tail}`,
    );
    if (fixed !== text) writeFileSync(path, fixed);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------

mkdirSync(out, { recursive: true });
for (const file of readdirSync(out)) if (file.endsWith(".tgz")) rmSync(join(out, file));

const staged = [
  packWidget(),
  await packUniffiPackage({
    source: "widget-host-bindings",
    name: "host",
    description:
      "Host side of the Matrix widget API (MSC4412) for JavaScript clients: matrix-widget-host-driver, matrix-widget-host-backend-interface and matrix-widget-actions as TypeScript + wasm",
    keywords: ["matrix", "widget", "msc4412", "wasm", "uniffi"],
  }),
  packCompatWrapper(),
];
if (withMatrixSdk) {
  staged.push(
    await packUniffiPackage({
      source: "matrix-sdk-uniffi-js",
      name: "matrix-sdk-uniffi-js",
      description: readJson(join(root, "packages/matrix-sdk-uniffi-js/package.json")).description,
      keywords: ["matrix", "matrix-rust-sdk", "wasm", "uniffi"],
    }),
  );
}

for (const dir of staged) {
  execFileSync("npm", ["pack", dir, "--pack-destination", out], { stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });
}
console.log(`==> ${out}`);
for (const file of readdirSync(out).filter((f) => f.endsWith(".tgz"))) console.log(`    ${file}`);
