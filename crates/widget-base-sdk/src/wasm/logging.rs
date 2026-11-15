//! Logging for the JavaScript bindings.
//!
//! The client emits through the [`log`] facade. This module installs the logger that writes to
//! the JavaScript console (`widget-logging`), at level `warn` as soon as the wasm module is
//! loaded, so that a dropped message, a throwing callback or a panic is visible without any setup.

use log::LevelFilter;
use wasm_bindgen::prelude::*;

/// Runs when the wasm module is instantiated (`await init()`).
#[wasm_bindgen(start)]
fn start() {
    widget_logging::ensure_default();
}

/// Set what the SDK writes to the console. Can be called again at any time.
///
/// `level` is one of `off`, `error`, `warn` (the default), `info`, `debug`, `trace`. `filter`
/// holds `RUST_LOG`-style overrides per target, e.g. `"widget_base_sdk::client=trace"`; targets
/// are Rust module paths.
///
/// ```js
/// import init, { initLogging } from "widget-base-sdk";
/// await init();
/// initLogging("debug");
/// ```
#[wasm_bindgen(js_name = initLogging)]
pub fn init_logging(level: &str, filter: Option<String>) -> Result<(), JsError> {
    let config = widget_logging::LogConfig {
        level: parse_level(level)?,
        filter: filter.unwrap_or_default(),
        write_to_system: true,
    };
    widget_logging::configure(config).map_err(|e| JsError::new(&e.to_string()))
}

/// Write a line of the widget into the same stream as the SDK's own, with the same filtering.
#[wasm_bindgen(js_name = logEvent)]
pub fn log_event(level: &str, target: &str, message: &str) -> Result<(), JsError> {
    let level =
        parse_level(level)?.to_level().ok_or_else(|| JsError::new("level `off` cannot be used to emit a record"))?;
    widget_logging::log_event(level, target, message);
    Ok(())
}

fn parse_level(level: &str) -> Result<LevelFilter, JsError> {
    level.parse().map_err(|_| {
        JsError::new(&format!("unknown log level {level:?}; expected off, error, warn, info, debug or trace"))
    })
}
