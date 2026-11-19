# Releasing

One version for everything: `[workspace.package].version` in `Cargo.toml`. A release publishes

| where | what | from |
|---|---|---|
| npmjs.com | `@matrix-widget-sdk/widget` | `crates/matrix-widget-sdk` (wasm-pack output) |
| npmjs.com | `@matrix-widget-sdk/host` | `packages/widget-host-bindings` (bundled, with its wasm) |
| npmjs.com | `@matrix-widget-sdk/compat-wrapper` | `packages/widget-compat-wrapper` (the built page, `dist/`) |
| crates.io | `matrix-widget-actions`, `matrix-widget-logging`, `matrix-widget-host-backend-interface`, `matrix-widget-host-driver` | `crates/` |
| GitHub | tag `v<version>`, a GitHub Release with the npm tarballs attached | |

Not published: `matrix-widget-sdk` as a crate (`publish = false`, only the wasm npm package),
`uniffi-bindgen`, the apps (`widget-host`, `test-widgets`: the dev site, see README) and
`matrix-sdk-uniffi-js` (its runtime is a git dependency on an unreleased ubrn; `pack-npm.mjs
--with-matrix-sdk` packs it once that is solved). `matrix-widget-logging` is published only because
`matrix-widget-host-driver`'s `uniffi` feature depends on it, and crates.io needs every dependency,
optional ones included, on the registry.

The workspace packages stay `"private": true`. `scripts/pack-npm.mjs` stages what is published
(`dist/npm/stage/<name>/`, with a generated package.json) and packs it to `dist/npm/*.tgz`; only
those tarballs are ever published.

## The workflows

- `.github/actions/setup-web`: toolchains, `npm ci`, `npm run wasm`, `npm run bindings` and the
  matrix-rust-sdk bindings from the cache. Shared by `ci.yml` (`web`) and `release.yml` (`build`);
  release runs restore the caches `main` created, so a release does not rebuild the SDK.
- `ci.yml` packs the npm packages on every run, checks them (publint, are-the-types-wrong,
  `npm run smoke:npm`) and runs `cargo publish --dry-run` for the four crates.
- `release.yml` builds and packs once; the publish jobs only download that `npm-packages`
  artifact, so what gets published is exactly what was tested. `npm publish` runs in `release.yml`
  itself because npm's trusted publisher is bound to that file name.

## Cutting a release

`release.yml` only runs by hand: Actions → **Release** → **Run workflow**, with `version` and the
checkboxes `dry_run` (default on), `npm` and `crates`. A dry run validates, builds, tests, packs and
smoke-tests, then stops; its tarballs are on the run's page (Artifacts → `npm-packages`).

1. Bump the version on a branch and merge it into `main` (the changelog lives in the PR and in the
   generated release notes):

   ```sh
   node scripts/set-version.mjs 0.2.0   # Cargo.toml, every packages/*/package.json, both lock files
   npm run wasm                         # so crates/matrix-widget-sdk/pkg has the new version too (local packing only)
   ```

   A prerelease such as `0.2.0-rc.1` is published to npm under the dist-tag `next` and becomes a
   GitHub prerelease.
2. Run the workflow on `main` with `dry_run` ticked; check the run and its tarballs.
3. Run it again with `dry_run` unticked: `validate` (every version says `0.2.0`, the tag does not
   exist), `build`, then `publish-npm` and `publish-crates` (each after its environment's approval
   if one is configured), and last `github-release`, which tags `v0.2.0` and attaches the tarballs.
4. If a job fails, re-run it. Packages already on a registry are skipped, and the tag is created
   only after both publish jobs succeeded or were switched off.

The workflow's own token creates the tag; tag protection rules that forbid the Actions bot to
create `v*` tags would block it.

## Checking locally

```sh
npm run build
npm run pack:npm                 # dist/npm/*.tgz
npm run smoke:npm                # installs them into a fresh Vite app, typechecks and builds it
npx publint dist/npm/<tgz>
npx @arethetypeswrong/cli dist/npm/<tgz> --profile esm-only
cargo publish --dry-run -p matrix-widget-actions -p matrix-widget-logging -p matrix-widget-host-backend-interface -p matrix-widget-host-driver
node scripts/set-version.mjs --check 0.2.0
```
