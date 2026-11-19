/**
 * The package entry (`generated/` is build output, `npm run bindings`). It replaces ubrn's own
 * entrypoint, whose `.wasm` import bundlers turn into an ES module: `new URL(…, import.meta.url)`
 * works in Vite, webpack 5, Rollup and esbuild, and after `scripts/pack-npm.mjs` bundles it.
 */
import * as matrix_sdk from "./generated/matrix_sdk";
import * as matrix_sdk_base from "./generated/matrix_sdk_base";
import * as matrix_sdk_common from "./generated/matrix_sdk_common";
import * as matrix_sdk_contentscanner from "./generated/matrix_sdk_contentscanner";
import * as matrix_sdk_crypto from "./generated/matrix_sdk_crypto";
import * as matrix_sdk_ffi from "./generated/matrix_sdk_ffi";
import * as matrix_sdk_ui from "./generated/matrix_sdk_ui";
import * as ruma_events from "./generated/ruma_events";
import initWasm from "./generated/wasm-bindgen/index.js";

let ready: Promise<void> | undefined;

/**
 * Load the wasm module and initialise every namespace. Must resolve before anything else from
 * this package is used; calling it again returns the same promise.
 */
export function uniffiInitAsync(): Promise<void> {
  return (ready ??= (async () => {
    await initWasm({ module_or_path: new URL("./generated/wasm-bindgen/index_bg.wasm", import.meta.url) });
    matrix_sdk.default.initialize();
    matrix_sdk_base.default.initialize();
    matrix_sdk_common.default.initialize();
    matrix_sdk_contentscanner.default.initialize();
    matrix_sdk_crypto.default.initialize();
    matrix_sdk_ffi.default.initialize();
    matrix_sdk_ui.default.initialize();
    ruma_events.default.initialize();
  })());
}

export * from "./generated/matrix_sdk";
export * from "./generated/matrix_sdk_base";
export * from "./generated/matrix_sdk_common";
export * from "./generated/matrix_sdk_contentscanner";
export * from "./generated/matrix_sdk_crypto";
export * from "./generated/matrix_sdk_ffi";
export * from "./generated/matrix_sdk_ui";
export * from "./generated/ruma_events";
