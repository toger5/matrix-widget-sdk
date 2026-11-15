#!/bin/bash
# Builds matrix-sdk-ffi for the browser: `src/generated/*.ts` plus one wasm module.
#
# Derived from element-hq/aurora's build-wasm-bindings.sh. matrix-sdk-ffi is not built for
# wasm32 upstream, so the checkout needs a few edits before it compiles. Each one is explained
# where it is applied. Run from anywhere: `npm run bindings -w packages/matrix-sdk-uniffi-js`.
#
# Needs: the wasm32-unknown-unknown target (the matching `wasm-bindgen` CLI is installed locally),
# and binaryen's `wasm-opt`.
set -euo pipefail

command -v wasm-opt > /dev/null || { echo "wasm-opt not found: install binaryen (brew install binaryen)" >&2; exit 1; }

cd "$(dirname "$0")/.."
SDK=rust_modules/matrix-rust-sdk
WASM_FILE=src/generated/wasm-bindgen/index_bg.wasm

echo "==> Cleaning generated output"
rm -rf src/generated

echo "==> Restoring the lock file of ubrn"
# ubrn comes from a git commit (see package.json) and npm leaves its Cargo.lock out of the
# install. Without it cargo resolves newer dependencies than that commit was written for
# (uniffi_bindgen 0.32.2 does not compile with it), so the lock file of the same commit is
# fetched back.
UBRN_DIR=$(dirname "$(dirname "$(npx ubrn --path)")")
UBRN_COMMIT=$(sed -n 's/.*uniffi-bindgen-react-native#\([0-9a-f]*\)".*/\1/p' package.json)
curl -fsSL "https://raw.githubusercontent.com/neekolas/uniffi-bindgen-react-native/$UBRN_COMMIT/Cargo.lock" -o "$UBRN_DIR/Cargo.lock"

echo "==> Checking out the SDK"
# Undo the edits of a previous run first, so that the checkout can move to a new pin.
if [ -d "$SDK/.git" ]; then
    git -C "$SDK" reset --hard HEAD
    git -C "$SDK" clean -fd bindings crates
fi
npm run ubrn:checkout

echo "==> Adding the ffi API of sdk-additions/"
# API the widget host needs and upstream does not have yet. It is kept as whole new files, so
# the only edit to an upstream file is the line declaring each new module.
cp -R sdk-additions/. "$SDK/"
declare_module() { # <file> <existing line to insert after> <module>
    grep -qx "$2" "$1" || { echo "cannot declare $3: no line '$2' in $1" >&2; exit 1; }
    sed -i.bak "s/^$2\$/&\\
mod $3;/" "$1"
}
declare_module "$SDK/bindings/matrix-sdk-ffi/src/room/mod.rs" "mod power_levels;" raw_events
declare_module "$SDK/bindings/matrix-sdk-ffi/src/lib.rs" "mod room_list;" room_list_full_state
declare_module "$SDK/bindings/matrix-sdk-ffi/src/lib.rs" "mod room_list;" room_list_extra_state
declare_module "$SDK/crates/matrix-sdk-ui/src/room_list_service/mod.rs" "mod room_list;" full_state
declare_module "$SDK/crates/matrix-sdk-ui/src/room_list_service/mod.rs" "mod room_list;" extra_state

echo "==> Patching: drop the forced experimental-search feature"
# matrix-sdk-ffi enables matrix-sdk/experimental-search unconditionally, which pulls in tantivy
# (and rustix/errno), none of which build for wasm32-unknown-unknown.
sed -i.bak '/^matrix-sdk = /,/^\] }/{/^    "experimental-search"$/d;}' "$SDK/bindings/matrix-sdk-ffi/Cargo.toml"

echo "==> Patching: pin tracing-appender to 0.2.4"
# 0.2.5 depends on the `symlink` crate, which does not build for wasm32-unknown-unknown.
sed -i.bak -E 's/^tracing-appender = \{ version = "[^"]+"/tracing-appender = { version = "=0.2.4"/' "$SDK/Cargo.toml"

echo "==> First pass: generate the bindings/wasm shim crate"
# bindings/wasm can only be a member of the SDK workspace once it exists: the first pass
# creates it, the second builds it.
npm run ubrn:web || echo "    (first pass is allowed to fail after generating the crate)"

echo "==> Installing the wasm-bindgen CLI the SDK's lock file asks for"
# The CLI must be exactly the version of the wasm-bindgen crate in the binary. It goes into
# rust_modules/tools so it does not replace a different version installed for other projects.
WB_VERSION=$(grep -A1 '^name = "wasm-bindgen"$' "$SDK/Cargo.lock" | sed -n 's/^version = "\(.*\)"$/\1/p')
TOOLS="$PWD/rust_modules/tools"
if ! "$TOOLS/bin/wasm-bindgen" --version 2> /dev/null | grep -q " $WB_VERSION\$"; then
    cargo install wasm-bindgen-cli --version "$WB_VERSION" --locked --root "$TOOLS"
fi
export UBRN_WASM_BINDGEN="$TOOLS/bin/wasm-bindgen"

echo "==> Second pass: build with bindings/wasm in the workspace"
# The wasm is built in the SDK's workspace, which has no [profile.release], so the profile of this
# repository's Cargo.toml does not apply and cargo's defaults (opt-level 3, no LTO, 16 codegen
# units) would be used. Those roughly triple the code size: generic code is duplicated per crate
# and nothing is merged at link time. The profile is set here, through the environment, so that
# no further edit of the checkout is needed. `strip` drops the name section (function names,
# ~18 MB); build scripts and proc macros are left unstripped, as stripped proc-macro dylibs can
# fail to load on recent macOS (see the SDK's small-release-stripped profile).
export CARGO_PROFILE_RELEASE_OPT_LEVEL=z
export CARGO_PROFILE_RELEASE_LTO=fat
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
export CARGO_PROFILE_RELEASE_STRIP=true
export CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=none
sed -i.bak '/"xtask",/a\
    "bindings/wasm",
' "$SDK/Cargo.toml"
npm run ubrn:web

echo "==> Pointing the generated code at this package's ubrn runtime"
# Generated code imports its runtime as `@ubjs/core`. The runtime matching this ubrn is not
# published under that name; it is the main export of the ubrn package itself. Importing it by
# that name lets every package in this repository resolve its own runtime version.
sed -i.bak -E "s#(['\"])@ubjs/core['\"]#\1uniffi-bindgen-react-native\1#" src/generated/*.ts
rm src/generated/*.bak

echo "==> Optimising the wasm binary (takes a few minutes)"
# The features are listed because `strip` removes the target_features section wasm-opt would
# otherwise read them from; they are the ones rustc enables for wasm32-unknown-unknown.
ls -lh "$WASM_FILE"
wasm-opt -Oz \
    --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
    --enable-mutable-globals --enable-reference-types --enable-multivalue \
    "$WASM_FILE" -o "$WASM_FILE.tmp"
mv "$WASM_FILE.tmp" "$WASM_FILE"

ls -lh "$WASM_FILE"
echo "==> Done"
