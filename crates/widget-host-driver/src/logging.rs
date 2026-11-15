//! Logging for the bindings (Kotlin, Swift, Python, and the web through ubrn).
//!
//! The driver emits through the [`log`] facade, and a facade without an implementation is silent.
//! A foreign host cannot install a Rust logger, so [`setup_logging`] does it: records go to the
//! platform log (logcat, the unified log on iOS, the JavaScript console, stderr elsewhere) and,
//! after [`set_log_sink`], to a [`LogSink`] of the host.
//!
//! On the web the driver installs the logger itself with level `warn`, so a refused request or a
//! panic shows up in the console without any setup. Native hosts are silent until they call
//! [`setup_logging`].
//!
//! The implementation is the `widget-logging` crate; this module is its UniFFI surface.

use std::sync::Arc;

/// Severity of a log record.
#[derive(Clone, Copy, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl From<LogLevel> for log::Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Error => log::Level::Error,
            LogLevel::Warn => log::Level::Warn,
            LogLevel::Info => log::Level::Info,
            LogLevel::Debug => log::Level::Debug,
            LogLevel::Trace => log::Level::Trace,
        }
    }
}

impl From<log::Level> for LogLevel {
    fn from(level: log::Level) -> Self {
        match level {
            log::Level::Error => LogLevel::Error,
            log::Level::Warn => LogLevel::Warn,
            log::Level::Info => LogLevel::Info,
            log::Level::Debug => LogLevel::Debug,
            log::Level::Trace => LogLevel::Trace,
        }
    }
}

/// What [`setup_logging`] should install.
#[derive(Clone, Debug, uniffi::Record)]
pub struct LogConfig {
    /// Level applied to every target that no `filter` directive matches.
    pub level: LogLevel,
    /// `RUST_LOG`-style per-target overrides, e.g.
    /// `"widget_host_driver::driver=trace,widget_matrix_backend=warn"`.
    ///
    /// Targets are module paths and a directive matches by prefix. The roots are
    /// `widget_host_driver`, `widget_matrix_backend` and `widget_actions`. Empty means "no
    /// overrides".
    #[uniffi(default = "")]
    pub filter: String,
    /// Write to the platform log (logcat on Android, the unified log on iOS, the console on the
    /// web, stderr elsewhere). Turn it off when a [`LogSink`] is installed and the records should
    /// not show up twice.
    #[uniffi(default = true)]
    pub write_to_system: bool,
}

/// One log record, as handed to a [`LogSink`].
#[derive(Clone, Debug, uniffi::Record)]
pub struct LogRecord {
    pub level: LogLevel,
    /// Module path of the emitting code, e.g. `widget_host_driver::driver::requests`.
    pub target: String,
    pub message: String,
    /// Milliseconds since the Unix epoch, taken when the record was emitted.
    pub timestamp_ms: u64,
    pub thread: String,
    pub file: Option<String>,
    pub line: Option<u32>,
}

/// A destination for log records that the host implements.
///
/// On native platforms `log` is called from one dedicated thread, so it may block. On the web it
/// is called in place. Records logged from inside `log` are discarded.
#[uniffi::export(with_foreign)]
pub trait LogSink: Send + Sync {
    fn log(&self, record: LogRecord);
}

/// [`LogConfig::filter`] is not a valid `RUST_LOG` spec.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error, uniffi::Error)]
pub enum LoggingError {
    #[error("{message}")]
    InvalidFilter { message: String },
}

/// Install the logger, or reconfigure it if it is already installed. Call it before anything
/// else, and again whenever the level or the filter should change.
///
/// Also installs a panic hook that logs a Rust panic before the process (or the wasm module)
/// dies. With an invalid `config.filter` nothing changes.
#[uniffi::export]
pub fn setup_logging(config: LogConfig) -> Result<(), LoggingError> {
    let config = widget_logging::LogConfig {
        level: log::Level::from(config.level).to_level_filter(),
        filter: config.filter,
        write_to_system: config.write_to_system,
    };
    widget_logging::configure(config).map_err(|e| LoggingError::InvalidFilter { message: e.to_string() })
}

/// Also hand every record that passes the filter of [`setup_logging`] to `sink`, replacing the
/// sink set before. The sink gets nothing until [`setup_logging`] was called (on the web the
/// driver does that itself, with level `warn`).
// Not an optional argument of `setup_logging`: the web bindings cannot pass an optional object
// that JavaScript implements.
#[uniffi::export]
pub fn set_log_sink(sink: Arc<dyn LogSink>) {
    widget_logging::set_sink(Some(Arc::new(move |record: widget_logging::LogRecord| {
        sink.log(LogRecord {
            level: record.level.into(),
            target: record.target,
            message: record.message,
            timestamp_ms: record.timestamp_ms,
            thread: record.thread,
            file: record.file,
            line: record.line,
        })
    })));
}

/// Remove the sink set with [`set_log_sink`].
#[uniffi::export]
pub fn clear_log_sink() {
    widget_logging::set_sink(None);
}

/// Emit a record from the host into the same stream as the SDK's own, so that the host's lines
/// and the driver's appear in one timeline.
#[uniffi::export]
pub fn log_event(level: LogLevel, target: String, message: String) {
    widget_logging::log_event(level.into(), &target, &message);
}

/// Number of records dropped because the [`LogSink`] could not keep up. Always 0 on the web.
#[uniffi::export]
pub fn dropped_log_record_count() -> u64 {
    widget_logging::dropped_record_count()
}
