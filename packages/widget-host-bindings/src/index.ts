/**
 * The package entry (`generated/` is ubrn's build output). It replaces ubrn's own entrypoint,
 * whose `.wasm` import bundlers turn into an ES module: `new URL(…, import.meta.url)` works in
 * Vite, webpack 5, Rollup and esbuild, and after `scripts/pack-npm.mjs` bundles the package.
 */
import initWasm from "./generated/wasm-bindgen/index.js";
import * as matrix_widget_actions from "./generated/matrix_widget_actions";
import * as matrix_widget_host_driver from "./generated/matrix_widget_host_driver";
import * as matrix_widget_host_backend_interface from "./generated/matrix_widget_host_backend_interface";

let ready: Promise<void> | undefined;

/**
 * Load the wasm module and initialise every namespace. Must resolve before anything else from
 * this package is used; calling it again returns the same promise.
 */
export function uniffiInitAsync(): Promise<void> {
  return (ready ??= (async () => {
    await initWasm({ module_or_path: new URL("./generated/wasm-bindgen/index_bg.wasm", import.meta.url) });
    matrix_widget_actions.default.initialize();
    matrix_widget_host_backend_interface.default.initialize();
    matrix_widget_host_driver.default.initialize();
  })());
}

export * from "./generated/matrix_widget_actions";
export * from "./generated/matrix_widget_host_backend_interface";
export * from "./generated/matrix_widget_host_driver";
