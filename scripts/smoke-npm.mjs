// Installs the tarballs of `npm run pack:npm` into a fresh Vite app outside the workspace and checks
// that a consumer can use them: the imports typecheck (`moduleResolution: bundler` and `nodenext`),
// `vite build` succeeds and emits both wasm modules, and the compat wrapper's page is in the
// package. Run from the repository root after `npm run pack:npm`: `npm run smoke:npm`.
// Needs the registry (vite, typescript and @ubjs/core are installed from it).
//
//   SMOKE_DIR  where the app is created; default a new directory in the OS temp dir
//   SMOKE_KEEP=1 keeps it afterwards (to load `dist/` in a browser: `npx vite preview` in it)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packed = join(root, "dist/npm");
const tarballs = existsSync(packed) ? readdirSync(packed).filter((f) => f.endsWith(".tgz")) : [];
const tarball = (name) => {
  const file = tarballs.find((f) => f.startsWith(`matrix-widget-sdk-${name}-`));
  if (!file) throw new Error(`dist/npm has no tarball of @matrix-widget-sdk/${name}; run \`npm run pack:npm\` first`);
  return `file:${join(packed, file)}`;
};

const app = process.env.SMOKE_DIR ? resolve(process.env.SMOKE_DIR) : mkdtempSync(join(tmpdir(), "matrix-widget-sdk-smoke-"));
mkdirSync(join(app, "src"), { recursive: true });
const write = (path, text) => writeFileSync(join(app, path), text);
const run = (cmd, args) => execFileSync(cmd, args, { cwd: app, stdio: "inherit", shell: process.platform === "win32" });

write(
  "package.json",
  JSON.stringify(
    {
      name: "matrix-widget-sdk-smoke",
      private: true,
      type: "module",
      dependencies: {
        "@matrix-widget-sdk/widget": tarball("widget"),
        "@matrix-widget-sdk/host": tarball("host"),
        "@matrix-widget-sdk/compat-wrapper": tarball("compat-wrapper"),
      },
      devDependencies: { vite: "^8.0.0", typescript: "^5.9.0" },
    },
    null,
    2,
  ),
);
const tsconfig = (moduleResolution, module) =>
  JSON.stringify({
    compilerOptions: { target: "ES2022", module, moduleResolution, // wasm-bindgen declarations use `Symbol.dispose`.
      lib: ["ES2022", "DOM", "ESNext.Disposable"], strict: true, noEmit: true, types: [] },
    include: ["src"],
  });
write("tsconfig.json", tsconfig("Bundler", "ESNext"));
write("tsconfig.node.json", tsconfig("NodeNext", "NodeNext"));
write("index.html", `<!doctype html><html><body><pre id="out"></pre><script type="module" src="/src/main.ts"></script></body></html>\n`);
// `window.smoke` resolves once both modules are loaded; a browser check can await it.
write(
  "src/main.ts",
  `import initWidget, { WidgetApi } from "@matrix-widget-sdk/widget";
import { InMemoryBackend, uniffiInitAsync, type WidgetHostPlatform } from "@matrix-widget-sdk/host";

async function smoke(): Promise<string> {
  await initWidget();
  await uniffiInitAsync();
  const backend = new InMemoryBackend("!room:example.org", "@alice:example.org");
  const platform: Partial<WidgetHostPlatform> = {};
  return [typeof WidgetApi.connectToParent, typeof backend.asBackend, Object.keys(platform).length].join(" ");
}
(window as unknown as { smoke: Promise<string> }).smoke = smoke().then((result) => {
  document.getElementById("out")!.textContent = "ok " + result;
  return result;
});
`,
);

console.log(`==> ${app}`);
run("npm", ["install", "--no-audit", "--no-fund"]);
run("npx", ["--no-install", "tsc", "-p", "tsconfig.json"]);
run("npx", ["--no-install", "tsc", "-p", "tsconfig.node.json"]);
run("npx", ["--no-install", "vite", "build"]);

const assets = readdirSync(join(app, "dist/assets"));
const wasm = assets.filter((f) => f.endsWith(".wasm"));
console.log(`dist/assets: ${assets.join(", ")}`);
if (wasm.length !== 2) throw new Error(`expected 2 wasm modules in dist/assets (widget + host), found ${wasm.length}`);
if (!existsSync(join(app, "node_modules/@matrix-widget-sdk/compat-wrapper/dist/index.html"))) {
  throw new Error("@matrix-widget-sdk/compat-wrapper has no dist/index.html");
}
console.log("==> smoke test passed");
if (!process.env.SMOKE_KEEP && !process.env.SMOKE_DIR) rmSync(app, { recursive: true, force: true });
