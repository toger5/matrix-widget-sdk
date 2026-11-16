// Builds the dev site: the widget host (matrix-rust-sdk and matrix-js-sdk builds) and the test
// widgets as one static site, laid out as GitHub Pages serves it (`.github/workflows/ci.yml`, job
// `deploy-dev-site`; README.md, "Dev site"). Run from the repository root: `npm run build:dev-site`.
//
// Needs what `npm run build` needs: `npm run wasm`, `npm run bindings` and the matrix-rust-sdk
// bindings (`npm run bindings -w packages/matrix-sdk-uniffi-js`).
//
//   SITE_BASE  the path the site is served under, with a leading and a trailing slash. Default `/`;
//              on GitHub Pages `/<repository>/` (or `/` with a custom domain).
//   SITE_OUT   the output directory, absolute or relative to the repository root. Default `dist/dev-site`.
//
// Layout (each part built with its own Vite `base`):
//   index.html, version.json   landing page and what was built
//   host/                      widget host on matrix-rust-sdk (the default build)
//   host-js/                   widget host on matrix-js-sdk (`vite build --mode js`)
//   widgets/new/, widgets/legacy/   the test widgets; the hosts' examples point here (`VITE_TEST_WIDGETS_URL`)
// The compat wrapper is part of each host build (`host/widget_compatibility_wrapper/`).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.SITE_BASE || "/";
// A path of whole segments: `//…` would be a protocol-relative URL, and it ends up in URLs.
if (!/^\/(?:[^/?#\\]+\/)*$/.test(base)) throw new Error(`SITE_BASE must be a path that starts and ends with "/": ${base}`);
const out = resolve(root, process.env.SITE_OUT || "dist/dev-site");

/** `vite build` of one package into `<out>/<dir>`, served at `<base><dir>/`. */
function viteBuild(pkg, dir, args = [], env = {}) {
  console.log(`==> ${pkg} -> ${base}${dir}/`);
  const cwd = join(root, "packages", pkg);
  // The package's own vite, run by this node: unlike `npx vite`, a missing vite is an error rather than a
  // download from the registry, and no shell is needed (Windows).
  const require = createRequire(join(cwd, "package.json"));
  const manifest = require.resolve("vite/package.json");
  const vite = join(dirname(manifest), require(manifest).bin.vite);
  execFileSync(process.execPath, [vite, "build", "--base", `${base}${dir}/`, "--outDir", join(out, dir), "--emptyOutDir", ...args], {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

mkdirSync(out, { recursive: true });
viteBuild("test-widgets", "widgets");
// A path, resolved against the host's own base URL by `src/exampleWidgets.ts`.
const widgets = { VITE_TEST_WIDGETS_URL: `${base}widgets/` };
viteBuild("widget-host", "host", [], widgets);
viteBuild("widget-host", "host-js", ["--mode", "js"], widgets);

// What was built. In CI the GITHUB_* variables say it; locally git does.
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const repository = process.env.GITHUB_REPOSITORY;
const commit = process.env.GITHUB_SHA ?? git("rev-parse", "HEAD");
const version = {
  commit,
  ref: process.env.GITHUB_REF_NAME ?? git("rev-parse", "--abbrev-ref", "HEAD"),
  localChanges: process.env.GITHUB_SHA ? false : git("status", "--porcelain") !== "",
  date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  commitUrl: repository ? `${server}/${repository}/commit/${commit}` : null,
  runUrl: repository && process.env.GITHUB_RUN_ID ? `${server}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
};
const readmeUrl = repository ? `${server}/${repository}/blob/${commit}/packages/widget-host/README.md#configuration` : null;
writeFileSync(join(out, "version.json"), `${JSON.stringify(version, null, 2)}\n`);
writeFileSync(join(out, "index.html"), landingPage({ ...version, readmeUrl }));
console.log(`==> ${out} (commit ${commit.slice(0, 10)}${version.localChanges ? " + local changes" : ""})`);

function landingPage(v) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`;
  const short = v.commit.slice(0, 10);
  const built = [
    `Built from ${esc(v.ref)} at ${v.commitUrl ? link(v.commitUrl, short) : `<code>${esc(short)}</code>`}${v.localChanges ? " plus local changes" : ""}`,
    `on ${esc(v.date.replace("T", " ").replace("Z", " UTC"))}`,
    v.runUrl ? `(${link(v.runUrl, "CI run")})` : "",
  ].join(" ");
  // `data-url` elements show the absolute URL of their path, resolved against this page.
  const url = (path) => `<code data-url="${esc(path)}">${esc(path)}</code>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Widget tools dev site</title>
    <style>
      :root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; }
      body { max-width: 46rem; margin: 0 auto; padding: 24px 16px 48px; }
      h1 { font-size: 1.5rem; margin: 0 0 4px; }
      h2 { font-size: 1.1rem; margin: 28px 0 8px; }
      code { font-size: 0.9em; overflow-wrap: anywhere; }
      li { margin: 4px 0; }
      .meta { opacity: 0.75; margin: 0; }
      .warning { border-left: 4px solid #d97706; padding: 4px 12px; background: color-mix(in srgb, #d97706 10%, transparent); }
    </style>
  </head>
  <body>
    <h1>Widget tools dev site</h1>
    <p class="meta">${built} · ${link("version.json", "version.json")}</p>

    <h2>Widget host</h2>
    <ul>
      <li><strong>matrix-rust-sdk</strong> (the default build):
        ${link("host/?mode=memory", "DevBackend")} (a mocked room with both test widgets, no homeserver) ·
        ${link("host/?autoload=1", "open the MSC4412 test widget")} ·
        ${link("host/", "log in")}</li>
      <li><strong>matrix-js-sdk</strong>:
        ${link("host-js/?mode=memory", "DevBackend")} ·
        ${link("host-js/?autoload=1", "open the MSC4412 test widget")} ·
        ${link("host-js/", "log in")}</li>
    </ul>
    <p>URL parameters (<code>event</code>, <code>autoload</code>, <code>autoApprove</code>, <code>wrapper</code>, <code>log</code>, …) are listed in
      ${v.readmeUrl ? link(v.readmeUrl, "the host's README") : "the host's README (<code>packages/widget-host/README.md</code>)"}.</p>

    <h2>Test widgets</h2>
    <p>For the URL of a widget state event; they only work embedded in a widget host.</p>
    <ul>
      <li>MSC4412 widget (widget-base-sdk), for an <code>m.widget</code> event: ${url("widgets/new/")}</li>
      <li>Legacy widget (matrix-widget-api), for an <code>im.vector.modular.widgets</code> event: ${url("widgets/legacy/?widgetId=$matrix_widget_id")}</li>
      <li>The compat wrapper the host runs legacy widgets in: ${url("host/widget_compatibility_wrapper/")} (another host's copy can be chosen with <code>?wrapper=</code>)</li>
    </ul>

    <h2>Before you log in</h2>
    <p class="warning">This site shares its origin with the test widgets, which run with <code>allow-same-origin</code>, and on
      <code>*.github.io</code> also with every other GitHub Pages site of the same account. Any page of that origin can read what the
      host stores in this browser: the access token and the encryption keys of a logged-in account. Use the DevBackend or a test
      account here; log in with an account you care about only on a deployment with a domain of its own.</p>

    <script>
      for (const el of document.querySelectorAll("[data-url]")) el.textContent = new URL(el.dataset.url, location.href).href;
    </script>
  </body>
</html>
`;
}
