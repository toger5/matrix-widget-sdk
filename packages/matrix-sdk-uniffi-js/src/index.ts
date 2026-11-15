/**
 * matrix-sdk-ffi for the browser. This file is the package's only public entry; `generated/` is
 * build output (`npm run bindings`).
 *
 * ubrn's own entrypoint (`generated/index.web.ts`) imports the `.wasm` file as a path, which
 * bundlers like Vite turn into an ES module instead of a URL. This entry does the same work but
 * resolves the module URL the bundler way.
 */
/// <reference path="./vite-env.d.ts" />
import * as matrix_sdk from "./generated/matrix_sdk";
import * as matrix_sdk_base from "./generated/matrix_sdk_base";
import * as matrix_sdk_common from "./generated/matrix_sdk_common";
import * as matrix_sdk_contentscanner from "./generated/matrix_sdk_contentscanner";
import * as matrix_sdk_crypto from "./generated/matrix_sdk_crypto";
import * as matrix_sdk_ffi from "./generated/matrix_sdk_ffi";
import * as matrix_sdk_ui from "./generated/matrix_sdk_ui";
import * as ruma_events from "./generated/ruma_events";
import initWasm from "./generated/wasm-bindgen/index.js";
import wasmUrl from "./generated/wasm-bindgen/index_bg.wasm?url";

let ready: Promise<void> | undefined;

/**
 * Load the wasm module and initialise every namespace. Must resolve before anything else from
 * this package is used; calling it again returns the same promise.
 */
export function uniffiInitAsync(): Promise<void> {
  return (ready ??= (async () => {
    await initWasm({ module_or_path: wasmUrl });
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
