# Releasing

One version for everything: `[workspace.package].version` in `Cargo.toml`. A release publishes

| where | what | from |
|---|---|---|
| npmjs.com | `@matrix-widget-sdk/widget` | `crates/matrix-widget-sdk` (wasm-pack output) |
| npmjs.com | `@matrix-widget-sdk/host` | `packages/widget-host-bindings` (bundled, with its wasm) |
| npmjs.com | `@matrix-widget-sdk/compat-wrapper` | `packages/widget-compat-wrapper` (the built page, `dist/`) |
| crates.io | `matrix-widget-actions`, `matrix-widget-logging`, `matrix-widget-host-backend-interface`, `matrix-widget-host-driver` | `crates/` |
| GitHub | tag `v<version>`, a GitHub Release with the npm tarballs attached | |

Not published: `matrix-widget-sdk` as a crate (`publish = false`, usable only as the wasm npm
package), `uniffi-bindgen`, the apps (`widget-host`, `test-widgets`: the dev site, see README) and
`matrix-sdk-uniffi-js` (its runtime is a git dependency on an unreleased ubrn; `pack-npm.mjs
--with-matrix-sdk` packs it once that is solved). `matrix-widget-logging` is published only because
`matrix-widget-host-driver`'s `uniffi` feature depends on it, and crates.io needs every dependency,
optional ones included, on the registry.

The workspace packages stay `"private": true` and export their TypeScript sources for
development. `scripts/pack-npm.mjs` stages what is published (`dist/npm/stage/<name>/`, with a
generated package.json) and packs it to `dist/npm/*.tgz`. Only those tarballs are ever published.

## How the workflows share the work

- `.github/actions/setup-web` (composite action): toolchains, `npm ci`, `npm run wasm`,
  `npm run bindings` and the matrix-rust-sdk bindings from the cache. Used by `ci.yml` (`web`) and
  `release.yml` (`build`), so both build the same way. The caches that `main` creates (rust-cache,
  the SDK bindings) are restored by release runs, so a release does not rebuild the SDK.
- `ci.yml` packs the npm packages on every run, checks them (publint, are-the-types-wrong, a fresh
  Vite app that installs and builds them: `npm run smoke:npm`) and uploads them as the
  `npm-packages` artifact. It also runs `cargo publish --dry-run` for the four crates.
- `release.yml` builds and packs once (`build`). The publish jobs only download the
  `npm-packages` artifact, so what gets published is exactly what was tested. `npm publish` runs in
  `release.yml` itself, because npm's trusted publisher is bound to that file name.

## What `dry_run` is

`release.yml` only runs by hand: GitHub → the repository → **Actions** → **Release** (left
column) → **Run workflow** (button on the right). The form asks for the branch, `version` and
three checkboxes: `dry_run` (ticked by default), `npm` and `crates`.

- `dry_run` ticked: validate, build, test, pack and smoke-test, then stop. Nothing is published
  and no tag is created. The tarballs can be downloaded from the run's page (Summary → Artifacts →
  `npm-packages`). Use it to try a release.
- `dry_run` unticked: the same, then publish to npm and crates.io, and create the tag and the
  GitHub Release.

The **Release** entry only appears once `release.yml` is on `main` on GitHub.

## Every later release

1. Bump the version on a branch and merge it into `main` (the changelog lives in the PR and in the
   generated release notes):

   ```sh
   node scripts/set-version.mjs 0.2.0   # Cargo.toml, every packages/*/package.json, both lock files
   npm run wasm                         # so crates/matrix-widget-sdk/pkg has the new version too (local packing only)
   ```

   A prerelease such as `0.2.0-rc.1` is published to npm under the dist-tag `next`, never `latest`,
   and becomes a GitHub prerelease.
2. Actions → Release → Run workflow on `main`: version `0.2.0`, `dry_run` ticked. Check the run
   and the tarballs it uploaded.
3. Run it again with `dry_run` unticked. `validate` checks that every version says `0.2.0` and that the
   tag does not exist yet. `build` builds, tests, packs and runs the smoke test. Then
   `publish-npm` and `publish-crates` run, each after its environment's approval if one is
   configured. Last, `github-release` tags `v0.2.0` and attaches the tarballs.
4. If a job fails, re-run the workflow (or the failed jobs). Packages that are already on a
   registry are skipped, and the tag is created only after both publish jobs succeeded or were
   switched off (`npm` / `crates` inputs).

The workflow's own token creates the tag. Tag protection rules that forbid the Actions bot to
create `v*` tags would block it.
## Checking locally

```sh
npm run wasm && npm run bindings && npm run build --workspaces --if-present
npm run pack:npm                 # dist/npm/*.tgz
npm run smoke:npm                # installs them into a fresh Vite app, typechecks and builds it
npx publint dist/npm/<tgz>       # package.json and files
npx @arethetypeswrong/cli dist/npm/<tgz> --profile esm-only
cargo publish --dry-run -p matrix-widget-actions -p matrix-widget-logging -p matrix-widget-host-backend-interface -p matrix-widget-host-driver
node scripts/set-version.mjs --check 0.2.0
```

## Other places to publish (not set up)

- **pkg.pr.new**: installable preview builds per pull request or commit
  (`npm i https://pkg.pr.new/...`), without npm versions. Needs its GitHub App and one step that
  publishes `dist/npm/*.tgz` from the `web` job of `ci.yml`.
- **GitHub Packages (npm)**: the scope would have to be the GitHub owner (`@toger5`), and every
  consumer needs a token and an `.npmrc`, even for public packages. Not useful for a public SDK.
- **GitHub Release assets**: every release already carries the tarballs, which install with
  `npm i <asset url>`, without semver ranges.
