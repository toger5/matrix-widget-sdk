//! The logger behind the widget tools bindings.
//!
//! Every crate in this workspace emits through the [`log`] facade, which does nothing until an
//! implementation is installed. The library crates never install one: a Rust application picks its
//! own (`env_logger`, `tracing-log`, ...). The *bindings* have no such application around them, so
//! they install the logger of this crate:
//!
//! * `matrix-widget-host-driver` (UniFFI: Kotlin, Swift, Python, and the web through ubrn) exposes it as
//!   `setup_logging`,
//! * `matrix-widget-sdk` (wasm-bindgen) exposes it as `initLogging`.
//!
//! Each of those is a separate binary with its own copy of the `log` globals, which is why the
//! shared part lives here instead of in one of them.
//!
//! Records fan out to two independent destinations:
//!
//! * the platform log: the JavaScript console on `wasm32`, logcat on Android, the unified log on
//!   iOS and stderr everywhere else;
//! * an optional [`LogSink`] of the host, for its own file or rageshake pipeline.
//!
//! Filtering uses `RUST_LOG` syntax against module-path targets, see [`LogConfig::filter`].

use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};

pub use log::{Level, LevelFilter};
use log::{Log, Metadata, Record};

/// Tag (Android), subsystem category (iOS) and thread name prefix of this logger.
#[cfg(not(target_arch = "wasm32"))]
const TAG: &str = "matrix-widget";

/// What [`configure`] should install.
#[derive(Clone, Debug)]
pub struct LogConfig {
    /// Level applied to every target that no `filter` directive matches.
    pub level: LevelFilter,
    /// `RUST_LOG`-style per-target overrides, e.g. `"matrix_widget_host_driver::driver=trace"`.
    ///
    /// Targets are module paths, so a directive matches by prefix. The roots are
    /// `matrix_widget_host_driver`, `matrix_widget_host_backend_interface`, `matrix_widget_sdk` and `matrix_widget_actions`.
    /// Empty means "no overrides".
    pub filter: String,
    /// Write to the platform log. Turn it off when a [`LogSink`] is installed and the records
    /// should not show up twice.
    pub write_to_system: bool,
}

impl LogConfig {
    /// `level` for everything, written to the platform log.
    pub fn new(level: LevelFilter) -> Self {
        Self { level, filter: String::new(), write_to_system: true }
    }
}

/// One log record, as handed to a [`LogSink`].
#[derive(Clone, Debug)]
pub struct LogRecord {
    pub level: Level,
    /// Module path of the emitting code, e.g. `matrix_widget_host_driver::driver::requests`.
    pub target: String,
    pub message: String,
    /// Milliseconds since the Unix epoch, taken when the record was emitted.
    pub timestamp_ms: u64,
    pub thread: String,
    pub file: Option<String>,
    pub line: Option<u32>,
}

/// A host-supplied destination for log records.
///
/// On native targets it is called from one dedicated thread, never from the thread that emitted
/// the record, so it may block. On `wasm32` there are no threads and it is called in place.
/// Records logged from inside the sink are discarded instead of being delivered to it again.
pub type LogSink = Arc<dyn Fn(LogRecord) + Send + Sync>;

/// [`LogConfig::filter`] is not a valid `RUST_LOG` spec.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvalidFilter(pub String);

impl std::fmt::Display for InvalidFilter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "invalid log filter: {}", self.0)
    }
}

impl std::error::Error for InvalidFilter {}

/// Installs the logger, or reconfigures it if it is already installed.
///
/// `log::set_logger` works once per process, so later calls swap the filter and the platform-log
/// setting in place. The sink is separate, see [`set_sink`]. If the application installed a logger of its own before the
/// first call, that one stays and this call only raises `log::max_level`.
///
/// Also installs a panic hook that reports the panic through the logger (native) or the console
/// (`wasm32`) before the previous hook runs.
///
/// With an invalid `config.filter` nothing changes.
pub fn configure(config: LogConfig) -> Result<(), InvalidFilter> {
    let filter = build_filter(&config)?;
    let max_level = filter.filter();

    let logger = Logger::global();
    let has_sink = {
        let mut state = logger.state.write().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.filter = filter;
        state.write_to_system = config.write_to_system;
        state.sink.is_some()
    };
    CONFIGURED.store(true, Ordering::Relaxed);

    log::set_max_level(max_level);
    // Err means a logger is already installed. If it is ours, the swap above took effect; if it
    // is the application's, the application wins.
    let _ = log::set_logger(logger);

    install_panic_hook();

    log::info!(
        "widget tools {} logging configured: level={} filter={:?} system={} sink={}",
        env!("CARGO_PKG_VERSION"),
        config.level,
        config.filter.trim(),
        config.write_to_system,
        has_sink,
    );
    Ok(())
}

/// Installs the logger with warnings and errors going to the platform log, unless [`configure`]
/// (or this function) ran before.
///
/// The web bindings call this on start, so that a dropped message or a panic is visible in the
/// console without any setup.
pub fn ensure_default() {
    if !CONFIGURED.load(Ordering::Relaxed) {
        // An empty filter cannot be invalid.
        let _ = configure(LogConfig::new(LevelFilter::Warn));
    }
}

/// Sets (or with `None` removes) the host's destination for log records.
///
/// The sink gets what passes the filter of [`configure`], which has to be called as well: before
/// that no logger is installed and the sink gets nothing.
pub fn set_sink(sink: Option<LogSink>) {
    Logger::global().state.write().unwrap_or_else(|poisoned| poisoned.into_inner()).sink = sink;
}

/// Emits a record from the host into the same stream as the SDK's own records.
pub fn log_event(level: Level, target: &str, message: &str) {
    log::log!(target: target, level, "{message}");
}

/// Number of records dropped because the [`LogSink`] could not keep up. Always 0 on `wasm32`.
pub fn dropped_record_count() -> u64 {
    Logger::global().dropped.load(Ordering::Relaxed)
}

// --- implementation ---------------------------------------------------------------------------

static CONFIGURED: AtomicBool = AtomicBool::new(false);
static LOGGER: OnceLock<Logger> = OnceLock::new();

thread_local! {
    /// Set while this thread runs the host sink. A sink that logs would otherwise receive its own
    /// records, forever.
    // Clippy does not see the `const` initializer on targets with emulated TLS (Android).
    #[allow(clippy::missing_const_for_thread_local)]
    static IN_SINK: Cell<bool> = const { Cell::new(false) };
}

fn build_filter(config: &LogConfig) -> Result<env_filter::Filter, InvalidFilter> {
    let mut builder = env_filter::Builder::new();
    builder.filter_level(config.level);
    let spec = config.filter.trim();
    if !spec.is_empty() {
        builder.try_parse(spec).map_err(|err| InvalidFilter(format!("{spec:?}: {err}")))?;
    }
    Ok(builder.build())
}

struct State {
    filter: env_filter::Filter,
    write_to_system: bool,
    sink: Option<LogSink>,
}

struct Logger {
    state: RwLock<State>,
    dropped: AtomicU64,
    #[cfg(not(target_arch = "wasm32"))]
    sink_tx: std::sync::mpsc::SyncSender<LogRecord>,
    #[cfg(target_os = "android")]
    logcat: android_logger::AndroidLogger,
    #[cfg(target_os = "ios")]
    oslog: oslog::OsLog,
}

impl Logger {
    fn global() -> &'static Logger {
        LOGGER.get_or_init(|| Logger {
            state: RwLock::new(State {
                // Replaced by `configure` before `log` can reach this logger.
                filter: env_filter::Builder::new().filter_level(LevelFilter::Off).build(),
                write_to_system: false,
                sink: None,
            }),
            dropped: AtomicU64::new(0),
            #[cfg(not(target_arch = "wasm32"))]
            sink_tx: native::spawn_sink_thread(),
            #[cfg(target_os = "android")]
            logcat: android_logger::AndroidLogger::new(
                // Our own filter has already run when a record gets here.
                android_logger::Config::default().with_max_level(LevelFilter::Trace).with_tag(TAG),
            ),
            #[cfg(target_os = "ios")]
            oslog: oslog::OsLog::new("org.matrix.widget-tools", TAG),
        })
    }

    fn write_to_system(&self, record: &Record<'_>) {
        #[cfg(target_arch = "wasm32")]
        wasm::write_to_console(record);

        #[cfg(target_os = "android")]
        self.logcat.log(record);

        #[cfg(target_os = "ios")]
        {
            let level = match record.level() {
                Level::Error => oslog::Level::Error,
                Level::Warn => oslog::Level::Default,
                Level::Info => oslog::Level::Info,
                Level::Debug | Level::Trace => oslog::Level::Debug,
            };
            self.oslog.with_level(level, &format!("{}: {}", record.target(), record.args()));
        }

        #[cfg(not(any(target_arch = "wasm32", target_os = "android", target_os = "ios")))]
        {
            use std::io::Write as _;
            let line = format!(
                "{} {:<5} {}: {}",
                native::format_wall_clock(now_ms()),
                record.level(),
                record.target(),
                record.args()
            );
            let _ = writeln!(std::io::stderr().lock(), "{line}");
        }
    }
}

impl Log for Logger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        self.state.read().is_ok_and(|state| state.filter.enabled(metadata))
    }

    fn log(&self, record: &Record<'_>) {
        let (write_to_system, sink) = {
            let Ok(state) = self.state.read() else { return };
            if !state.filter.matches(record) {
                return;
            }
            (state.write_to_system, state.sink.clone())
        };
        if write_to_system {
            self.write_to_system(record);
        }
        if let Some(sink) = sink {
            if !IN_SINK.with(Cell::get) {
                self.deliver(sink, to_record(record));
            }
        }
    }

    fn flush(&self) {}
}

fn to_record(record: &Record<'_>) -> LogRecord {
    LogRecord {
        level: record.level(),
        target: record.target().to_owned(),
        message: record.args().to_string(),
        timestamp_ms: now_ms(),
        thread: thread_name(),
        file: record.file().map(str::to_owned),
        line: record.line(),
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;

    impl Logger {
        /// No threads on `wasm32`: call the sink in place.
        pub(super) fn deliver(&self, sink: LogSink, record: LogRecord) {
            IN_SINK.with(|in_sink| in_sink.set(true));
            sink(record);
            IN_SINK.with(|in_sink| in_sink.set(false));
        }
    }

    /// `<target>: <message>` through the console method of the record's level, so that the
    /// browser's own level filter works.
    pub(super) fn write_to_console(record: &Record<'_>) {
        use web_sys::console;
        let line = format!("{}: {}", record.target(), record.args()).into();
        match record.level() {
            Level::Error => console::error_1(&line),
            Level::Warn => console::warn_1(&line),
            Level::Info => console::info_1(&line),
            // `console.trace` would print a stack trace with every line.
            Level::Debug | Level::Trace => console::debug_1(&line),
        }
    }

    // `SystemTime::now()` panics on `wasm32-unknown-unknown`.
    pub(super) fn now_ms() -> u64 {
        js_sys::Date::now() as u64
    }

    pub(super) fn thread_name() -> String {
        "main".to_owned()
    }

    pub(super) fn install_panic_hook() {
        console_error_panic_hook::set_once();
    }
}
#[cfg(target_arch = "wasm32")]
use wasm::{install_panic_hook, now_ms, thread_name};

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    /// How many records may wait for the host sink before new ones are dropped. Dropping instead
    /// of blocking keeps a slow sink from stalling the thread that logs.
    const SINK_QUEUE_CAPACITY: usize = 4096;
    /// Report every this-many dropped records.
    const DROP_REPORT_INTERVAL: u64 = 1024;

    impl Logger {
        /// Queue the record for the sink thread.
        pub(super) fn deliver(&self, _sink: LogSink, record: LogRecord) {
            if let Err(TrySendError::Full(_)) = self.sink_tx.try_send(record) {
                let dropped = self.dropped.fetch_add(1, Ordering::Relaxed) + 1;
                if dropped % DROP_REPORT_INTERVAL == 0 {
                    // Straight to the platform log: the queue is what is full.
                    self.write_to_system(
                        &Record::builder()
                            .level(Level::Warn)
                            .target(module_path!())
                            .args(format_args!("log sink is not keeping up: {dropped} records dropped"))
                            .build(),
                    );
                }
            }
        }
    }

    pub(super) fn spawn_sink_thread() -> SyncSender<LogRecord> {
        let (tx, rx) = sync_channel::<LogRecord>(SINK_QUEUE_CAPACITY);
        let spawned = std::thread::Builder::new().name(format!("{TAG}-log")).spawn(move || {
            IN_SINK.with(|in_sink| in_sink.set(true));
            for record in rx {
                // Read the sink per record, so that `set_sink` can swap it.
                let sink = LOGGER.get().and_then(|logger| logger.state.read().ok()?.sink.clone());
                if let Some(sink) = sink {
                    sink(record);
                }
            }
        });
        if spawned.is_err() {
            eprintln!("{TAG}: could not spawn the log sink thread; the host sink is disabled");
        }
        tx
    }

    pub(super) fn now_ms() -> u64 {
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default()
    }

    pub(super) fn thread_name() -> String {
        std::thread::current().name().unwrap_or("unnamed").to_owned()
    }

    /// `HH:MM:SS.mmm` in UTC, for the stderr output.
    #[cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]
    pub(super) fn format_wall_clock(timestamp_ms: u64) -> String {
        let seconds_today = (timestamp_ms / 1000) % 86_400;
        format!(
            "{:02}:{:02}:{:02}.{:03}",
            seconds_today / 3600,
            (seconds_today % 3600) / 60,
            seconds_today % 60,
            timestamp_ms % 1000,
        )
    }

    pub(super) fn install_panic_hook() {
        static HOOK: std::sync::Once = std::sync::Once::new();
        HOOK.call_once(|| {
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                log::error!(
                    target: "matrix_widget_logging::panic",
                    "panic on thread {:?}: {info}\n{}",
                    thread_name(),
                    std::backtrace::Backtrace::force_capture(),
                );
                previous(info);
            }));
        });
    }
}
#[cfg(not(target_arch = "wasm32"))]
use native::{install_panic_hook, now_ms, thread_name};

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use std::sync::Mutex;

    use super::*;

    fn config(level: LevelFilter, filter: &str) -> LogConfig {
        // Tests must not write to the test runner's stderr.
        LogConfig { level, filter: filter.to_owned(), write_to_system: false }
    }

    fn collecting_sink() -> (LogSink, Arc<Mutex<Vec<LogRecord>>>) {
        let records = Arc::new(Mutex::new(Vec::new()));
        let sink_records = records.clone();
        (Arc::new(move |record| sink_records.lock().unwrap().push(record)), records)
    }

    /// Waits until the sink thread delivered `expected`, and returns all messages so far.
    fn wait_for(records: &Mutex<Vec<LogRecord>>, expected: &str) -> Vec<String> {
        let messages = || records.lock().unwrap().iter().map(|r| r.message.clone()).collect::<Vec<_>>();
        for _ in 0..200 {
            if messages().iter().any(|m| m == expected) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        messages()
    }

    #[test]
    fn wall_clock_formatting_splits_the_epoch_into_time_of_day() {
        assert_eq!(native::format_wall_clock(0), "00:00:00.000");
        assert_eq!(native::format_wall_clock(86_399_999), "23:59:59.999");
        assert_eq!(native::format_wall_clock(86_400_000), "00:00:00.000");
        assert_eq!(native::format_wall_clock(1_785_760_496_789), "12:34:56.789");
    }

    #[test]
    fn an_invalid_filter_is_rejected() {
        let error = build_filter(&config(LevelFilter::Info, "core=nonsense")).unwrap_err();
        assert!(error.0.contains("core=nonsense"), "unexpected error: {error}");
    }

    #[test]
    fn per_target_directives_override_the_baseline_level() {
        let filter = build_filter(&config(LevelFilter::Warn, "matrix_widget_host_driver=trace,noisy=error")).unwrap();
        let enabled =
            |target: &str, level: Level| filter.enabled(&Metadata::builder().target(target).level(level).build());

        // A directive matches the submodules of its target.
        assert!(enabled("matrix_widget_host_driver::driver::requests", Level::Trace));
        assert!(!enabled("noisy::module", Level::Warn));
        // Other targets get the baseline.
        assert!(enabled("matrix_widget_sdk::client", Level::Warn));
        assert!(!enabled("matrix_widget_sdk::client", Level::Info));
        // `log::set_max_level` must not clip the most verbose directive.
        assert_eq!(filter.filter(), LevelFilter::Trace);
    }

    /// One test for the whole life of the global logger: it is process-wide, so separate tests
    /// would race.
    #[test]
    fn the_installed_logger_filters_and_delivers_to_the_sink() {
        let (sink, records) = collecting_sink();
        set_sink(Some(sink));
        configure(config(LevelFilter::Info, "matrix_widget_host_driver=debug")).unwrap();

        log::log!(target: "matrix_widget_host_driver::driver", Level::Debug, "kept: driver debug");
        log::log!(target: "some_other_crate", Level::Debug, "dropped: other debug");
        log_event(Level::Info, "host", "kept: from the host");

        let messages = wait_for(&records, "kept: from the host");
        assert!(messages.iter().any(|m| m == "kept: driver debug"), "missing record in {messages:?}");
        assert!(messages.iter().any(|m| m == "kept: from the host"), "missing record in {messages:?}");
        assert!(!messages.iter().any(|m| m.starts_with("dropped:")), "filtered record in {messages:?}");

        let record = records.lock().unwrap().iter().find(|r| r.message == "kept: from the host").cloned().unwrap();
        assert_eq!((record.level, record.target.as_str()), (Level::Info, "host"));
        assert!(record.timestamp_ms > 0);

        // A second call reconfigures; `ensure_default` then changes nothing.
        let (second, second_records) = collecting_sink();
        set_sink(Some(second));
        configure(config(LevelFilter::Error, "")).unwrap();
        ensure_default();

        log::log!(target: "matrix_widget_host_driver::driver", Level::Warn, "dropped: below the new level");
        log::log!(target: "matrix_widget_host_driver::driver", Level::Error, "kept: error");

        let messages = wait_for(&second_records, "kept: error");
        assert!(messages.iter().any(|m| m == "kept: error"), "missing record in {messages:?}");
        assert!(!messages.iter().any(|m| m.starts_with("dropped:")), "old filter still active: {messages:?}");

        // An invalid filter leaves the configuration alone, and the sink can be removed.
        assert!(configure(config(LevelFilter::Trace, "a=b=c")).is_err());
        log::log!(target: "x", Level::Error, "kept: after the invalid filter");
        wait_for(&second_records, "kept: after the invalid filter");
        assert!(second_records.lock().unwrap().iter().any(|r| r.message == "kept: after the invalid filter"));
        set_sink(None);
        log::log!(target: "x", Level::Error, "dropped: no sink");
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!second_records.lock().unwrap().iter().any(|r| r.message.starts_with("dropped:")));
    }
}
