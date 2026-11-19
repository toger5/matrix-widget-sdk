//! Logging for the JavaScript bindings: the console logger of `matrix-widget-logging`, installed at
//! level `warn` when the module loads, so a dropped message, a throwing callback or a panic shows
//! without any setup.

use log::LevelFilter;
use wasm_bindgen::prelude::*;

/// Runs when the wasm module is instantiated (`await init()`).
#[wasm_bindgen(start)]
fn start() {
    matrix_widget_logging::ensure_default();
}

/// Set what the SDK writes to the console, at any time. `level`: `off`, `error`, `warn` (the
/// default), `info`, `debug` or `trace`; `filter`: `RUST_LOG`-style overrides per Rust module
/// path, e.g. `"matrix_widget_sdk::client=trace"`.
#[wasm_bindgen(js_name = initLogging)]
pub fn init_logging(level: &str, filter: Option<String>) -> Result<(), JsError> {
    let config = matrix_widget_logging::LogConfig {
        level: parse_level(level)?,
        filter: filter.unwrap_or_default(),
        write_to_system: true,
    };
    matrix_widget_logging::configure(config).map_err(|e| JsError::new(&e.to_string()))
}

/// Write a line of the widget into the same stream as the SDK's own, with the same filtering.
#[wasm_bindgen(js_name = logEvent)]
pub fn log_event(level: &str, target: &str, message: &str) -> Result<(), JsError> {
    let level =
        parse_level(level)?.to_level().ok_or_else(|| JsError::new("level `off` cannot be used to emit a record"))?;
    matrix_widget_logging::log_event(level, target, message);
    Ok(())
}

fn parse_level(level: &str) -> Result<LevelFilter, JsError> {
    level.parse().map_err(|_| {
        JsError::new(&format!("unknown log level {level:?}; expected off, error, warn, info, debug or trace"))
    })
}
