//! Read-only access to trackio experiment databases, for `<plot>` blocks.
//!
//! trackio keeps one SQLite file per project under `$TRACKIO_DIR` (default
//! `~/.cache/huggingface/trackio/<project>.db`). Every `log()` call is one row
//! in `metrics` holding a JSON object of the keys logged at that moment, so a
//! step can be spread over several rows. Configs live in `configs`, one JSON
//! object per run. Databases written before trackio 0.24 have no `run_id`
//! column and identify runs by name only; both shapes are read.
//!
//! Nothing here writes: databases are opened read-only, and when that fails
//! (a WAL database whose `-shm` cannot be created, a sandbox) the file is read
//! as an immutable snapshot instead and the response says so.

use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// Default number of points per series after downsampling.
pub const DEFAULT_MAX_POINTS: usize = 1500;
/// Upper bound on points per series, whatever the caller asks for.
pub const MAX_POINTS_CAP: usize = 20_000;
/// Flattened config keys kept per run; huge configs are cut here.
const CONFIG_KEY_CAP: usize = 200;

/// Where a plot's data lives: a trackio project name or a database path.
#[derive(Deserialize, Serialize, Clone, Debug, Default)]
pub struct DbSource {
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub project: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub db: Option<String>,
}

/// Errors carry a stable code the frontend and the MCP server branch on.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct ExpError {
  pub error: &'static str,
  pub message: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub path: Option<String>,
}

impl ExpError {
  fn new(error: &'static str, message: impl Into<String>, path: Option<&Path>) -> Self {
    ExpError {
      error,
      message: message.into(),
      path: path.map(|p| p.to_string_lossy().to_string()),
    }
  }
  pub fn bad_request(message: impl Into<String>) -> Self {
    Self::new("bad_request", message, None)
  }
  pub fn forbidden(message: impl Into<String>, path: &Path) -> Self {
    Self::new("forbidden", message, Some(path))
  }
  /// HTTP status for this error in server mode.
  pub fn status(&self) -> u16 {
    match self.error {
      "bad_request" => 400,
      "forbidden" => 403,
      "not_found" => 404,
      "bad_schema" => 422,
      "locked" => 503,
      _ => 500,
    }
  }
}

impl std::fmt::Display for ExpError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{}", self.message)
  }
}

/// The directory trackio writes to: `$TRACKIO_DIR`, else `$HF_HOME/trackio`,
/// else `$XDG_CACHE_HOME/huggingface/trackio`, else
/// `~/.cache/huggingface/trackio` (trackio's own resolution).
pub fn trackio_dir() -> PathBuf {
  let nonempty = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty());
  if let Some(dir) = nonempty("TRACKIO_DIR") {
    return PathBuf::from(dir);
  }
  if let Some(hf) = nonempty("HF_HOME") {
    return PathBuf::from(hf).join("trackio");
  }
  let cache = nonempty("XDG_CACHE_HOME")
    .map(PathBuf::from)
    .or_else(|| dirs::home_dir().map(|h| h.join(".cache")))
    .unwrap_or_else(|| PathBuf::from(".cache"));
  cache.join("huggingface").join("trackio")
}

/// trackio's on-disk name for a project: only `[A-Za-z0-9_-]` survive, and
/// an empty result becomes `default`.
pub fn canonical_project(name: &str) -> String {
  let kept: String = name
    .chars()
    .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
    .collect();
  if kept.is_empty() {
    "default".to_string()
  } else {
    kept
  }
}

/// Turn a source into a canonical database path. A relative `db` is taken
/// against `base_dir`, the directory of the markdown file holding the plot.
pub fn resolve_source(source: &DbSource, base_dir: Option<&Path>) -> Result<PathBuf, ExpError> {
  let candidate = match (&source.project, &source.db) {
    (Some(_), Some(_)) => {
      return Err(ExpError::bad_request(
        "give either \"project\" or \"db\" in the source, not both",
      ))
    }
    (None, None) => {
      return Err(ExpError::bad_request(
        "the source needs \"project\" (a trackio project) or \"db\" (a database path)",
      ))
    }
    (Some(project), None) => trackio_dir().join(format!("{}.db", canonical_project(project))),
    (None, Some(db)) => {
      let raw = PathBuf::from(db.strip_prefix("file://").unwrap_or(db));
      let expanded = match raw.strip_prefix("~") {
        Ok(rest) => dirs::home_dir()
          .map(|h| h.join(rest))
          .unwrap_or(raw.clone()),
        Err(_) => raw.clone(),
      };
      if expanded.is_absolute() {
        expanded
      } else {
        match base_dir {
          Some(base) => base.join(expanded),
          None => {
            return Err(ExpError::bad_request(format!(
              "\"{}\" is relative, but the document's directory is not known",
              db
            )))
          }
        }
      }
    }
  };

  candidate.canonicalize().map_err(|_| {
    let what = match &source.project {
      Some(project) => format!(
        "no trackio project \"{}\" (looked for {})",
        project,
        candidate.display()
      ),
      None => format!("no database at {}", candidate.display()),
    };
    ExpError::new("not_found", what, Some(&candidate))
  })
}

/// Whether a path names a database file by extension.
pub fn has_db_extension(path: &Path) -> bool {
  path
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| matches!(e.to_ascii_lowercase().as_str(), "db" | "sqlite" | "sqlite3"))
    .unwrap_or(false)
}

/// An open database plus how it was opened.
pub struct Db {
  pub conn: Connection,
  pub path: PathBuf,
  /// Opened as an immutable snapshot: no locking, may lag a live writer.
  pub immutable: bool,
  /// 2 when `metrics` has a `run_id` column, 1 for older databases.
  pub schema: u8,
}

fn sqlite_error(err: rusqlite::Error, path: &Path) -> ExpError {
  use rusqlite::ErrorCode;
  match err.sqlite_error_code() {
    Some(ErrorCode::DatabaseBusy) | Some(ErrorCode::DatabaseLocked) => ExpError::new(
      "locked",
      "the database is busy (training is writing); try again shortly",
      Some(path),
    ),
    Some(ErrorCode::NotADatabase) => ExpError::new(
      "bad_schema",
      "the file is not a SQLite database",
      Some(path),
    ),
    _ => ExpError::new(
      "io",
      format!("could not read the database: {}", err),
      Some(path),
    ),
  }
}

/// A `file:` URI for SQLite, percent-encoding everything but path characters.
fn sqlite_uri(path: &Path, query: &str) -> String {
  let mut out = String::from("file:");
  for byte in path.to_string_lossy().bytes() {
    match byte {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~' => {
        out.push(byte as char)
      }
      other => out.push_str(&format!("%{:02X}", other)),
    }
  }
  out.push('?');
  out.push_str(query);
  out
}

fn try_open(uri: &str) -> rusqlite::Result<Connection> {
  let flags =
    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX;
  let conn = Connection::open_with_flags(uri, flags)?;
  conn.busy_timeout(Duration::from_millis(1500))?;
  // Opening is lazy: touch the schema so a failure shows up here.
  conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;
  Ok(conn)
}

/// Open read-only, falling back to an immutable snapshot when a normal
/// read-only open is refused.
pub fn open(path: &Path) -> Result<Db, ExpError> {
  let (conn, immutable) = match try_open(&sqlite_uri(path, "mode=ro")) {
    Ok(conn) => (conn, false),
    Err(first) => {
      let busy = matches!(
        first.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy) | Some(rusqlite::ErrorCode::DatabaseLocked)
      );
      if busy {
        return Err(sqlite_error(first, path));
      }
      match try_open(&sqlite_uri(path, "mode=ro&immutable=1")) {
        Ok(conn) => (conn, true),
        Err(_) => return Err(sqlite_error(first, path)),
      }
    }
  };

  let columns = table_columns(&conn, "metrics").map_err(|e| sqlite_error(e, path))?;
  if columns.is_empty() {
    return Err(ExpError::new(
      "bad_schema",
      "this database has no metrics table, so it is not a trackio project",
      Some(path),
    ));
  }
  let schema = if columns.iter().any(|c| c == "run_id") {
    2
  } else {
    1
  };
  Ok(Db {
    conn,
    path: path.to_path_buf(),
    immutable,
    schema,
  })
}

fn table_columns(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
  let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
  let names = stmt
    .query_map([], |row| row.get::<_, String>(1))?
    .collect::<rusqlite::Result<Vec<_>>>()?;
  Ok(names)
}

fn file_stamp(path: &Path) -> (i64, u64) {
  std::fs::metadata(path)
    .map(|m| {
      let mtime = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
      (mtime, m.len())
    })
    .unwrap_or((0, 0))
}

/// Milliseconds since the epoch of the database's last change, counting the
/// write-ahead log, which a live WAL writer touches instead of the main file.
pub fn modified_ms(path: &Path) -> i64 {
  let wal = PathBuf::from(format!("{}-wal", path.display()));
  file_stamp(path).0.max(file_stamp(&wal).0)
}

/// A cheap token that changes whenever the database does: modification
/// times and sizes of the file and its WAL, plus the newest metrics row.
pub fn version(db: &Db) -> String {
  let (mtime, bytes) = file_stamp(&db.path);
  let (wal_mtime, wal_bytes) = file_stamp(&PathBuf::from(format!("{}-wal", db.path.display())));
  let max_id: i64 = db
    .conn
    .query_row("SELECT coalesce(max(id), 0) FROM metrics", [], |r| r.get(0))
    .unwrap_or(0);
  format!("{}:{}:{}", mtime.max(wal_mtime), bytes + wal_bytes, max_id)
}

/// A JSON column. trackio writes it as TEXT in older versions and as a BLOB of
/// UTF-8 bytes in newer ones.
fn json_column(row: &rusqlite::Row, index: usize) -> rusqlite::Result<Option<Value>> {
  use rusqlite::types::ValueRef;
  let bytes = match row.get_ref(index)? {
    ValueRef::Text(b) | ValueRef::Blob(b) => b,
    _ => return Ok(None),
  };
  Ok(serde_json::from_slice(bytes).ok())
}

/// A number from a logged value. trackio writes non-finite floats as the
/// strings "Infinity", "-Infinity" and "NaN"; those, booleans and anything
/// structured (images, tables) are not plotted.
pub fn parse_metric_value(value: &Value) -> Option<f64> {
  match value {
    Value::Number(n) => n.as_f64().filter(|v| v.is_finite()),
    _ => None,
  }
}

/// Whether a logged value is a plottable scalar, or a non-finite stand-in
/// for one (still a scalar metric, just not drawable at that step).
fn is_scalar(value: &Value) -> bool {
  match value {
    Value::Number(_) => true,
    Value::String(s) => matches!(s.as_str(), "Infinity" | "-Infinity" | "NaN"),
    _ => false,
  }
}

/// Flatten a nested config to dot paths, keeping scalars. Arrays become
/// their JSON text so they can still be compared and shown.
pub fn flatten_config(value: &Value) -> BTreeMap<String, Value> {
  fn walk(prefix: &str, value: &Value, out: &mut BTreeMap<String, Value>) {
    if out.len() >= CONFIG_KEY_CAP {
      return;
    }
    match value {
      Value::Object(map) => {
        for (key, inner) in map {
          let path = if prefix.is_empty() {
            key.clone()
          } else {
            format!("{}.{}", prefix, key)
          };
          walk(&path, inner, out);
        }
      }
      Value::Array(_) => {
        out.insert(prefix.to_string(), Value::String(value.to_string()));
      }
      other => {
        if !prefix.is_empty() {
          out.insert(prefix.to_string(), other.clone());
        }
      }
    }
  }
  let mut out = BTreeMap::new();
  walk("", value, &mut out);
  out
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
  let y = if m <= 2 { y - 1 } else { y };
  let era = if y >= 0 { y } else { y - 399 } / 400;
  let yoe = y - era * 400;
  let mp = (m + 9) % 12;
  let doy = (153 * mp + 2) / 5 + d - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era * 146_097 + doe - 719_468
}

/// Milliseconds since the epoch for an ISO-8601 timestamp as Python's
/// `isoformat()` writes it, with or without fraction and UTC offset. A
/// timestamp without an offset is read as UTC.
pub fn parse_iso_ms(text: &str) -> Option<i64> {
  let text = text.trim();
  let num = |s: &str| s.parse::<i64>().ok();
  if text.len() < 19 {
    return None;
  }
  let (date, rest) = text.split_at(10);
  let mut parts = date.split('-');
  let (y, mo, d) = (
    num(parts.next()?)?,
    num(parts.next()?)?,
    num(parts.next()?)?,
  );
  let rest = rest.strip_prefix('T').or_else(|| rest.strip_prefix(' '))?;
  let (h, mi, s) = (
    num(rest.get(0..2)?)?,
    num(rest.get(3..5)?)?,
    num(rest.get(6..8)?)?,
  );
  let mut tail = &rest[8..];

  let mut millis = 0i64;
  if let Some(frac) = tail.strip_prefix('.') {
    let digits: String = frac.chars().take_while(|c| c.is_ascii_digit()).collect();
    let padded: String = format!("{:0<3}", &digits[..digits.len().min(3)]);
    millis = num(&padded)?;
    tail = &frac[digits.len()..];
  }

  let offset_minutes = if tail.is_empty() || tail == "Z" {
    0
  } else {
    let sign = match &tail[..1] {
      "+" => 1,
      "-" => -1,
      _ => return None,
    };
    let hh = num(tail.get(1..3)?)?;
    let mm = num(tail.get(4..6).unwrap_or("00"))?;
    sign * (hh * 60 + mm)
  };

  let days = days_from_civil(y, mo, d);
  let seconds = days * 86_400 + h * 3600 + mi * 60 + s - offset_minutes * 60;
  Some(seconds * 1000 + millis)
}

/// Largest-triangle-three-buckets: indices of `threshold` points that keep
/// the visual shape of the series, always including both ends.
pub fn lttb(points: &[(f64, f64)], threshold: usize) -> Vec<usize> {
  let n = points.len();
  if threshold >= n || threshold < 3 {
    return (0..n).collect();
  }
  let mut kept = Vec::with_capacity(threshold);
  kept.push(0);
  let every = (n - 2) as f64 / (threshold - 2) as f64;
  let mut a = 0usize;
  for i in 0..threshold - 2 {
    let next_start = ((i + 1) as f64 * every) as usize + 1;
    let next_end = (((i + 2) as f64 * every) as usize + 1).min(n);
    let (mut avg_x, mut avg_y) = (0.0, 0.0);
    let span = (next_end - next_start).max(1);
    for p in &points[next_start..next_end.max(next_start + 1).min(n)] {
      avg_x += p.0;
      avg_y += p.1;
    }
    avg_x /= span as f64;
    avg_y /= span as f64;

    let start = (i as f64 * every) as usize + 1;
    let end = (((i + 1) as f64 * every) as usize + 1).min(n - 1);
    let (ax, ay) = points[a];
    let mut best = start;
    let mut best_area = -1.0;
    for (j, p) in points
      .iter()
      .enumerate()
      .take(end.max(start + 1))
      .skip(start)
    {
      let area = ((ax - avg_x) * (p.1 - ay) - (ax - p.0) * (avg_y - ay)).abs();
      if area > best_area {
        best_area = area;
        best = j;
      }
    }
    kept.push(best);
    a = best;
  }
  kept.push(n - 1);
  kept
}

/// Summary statistics of one series, computed on every point before
/// downsampling.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Summary {
  pub first: f64,
  pub last: f64,
  pub min: f64,
  pub max: f64,
  pub mean: f64,
  pub argmin_step: i64,
  pub argmax_step: i64,
}

/// One point: step, value and wall-clock time in ms (when known).
pub type Point = (i64, f64, Option<i64>);

pub fn summarize(points: &[Point]) -> Option<Summary> {
  let first = points.first()?;
  let last = points.last()?;
  let mut summary = Summary {
    first: first.1,
    last: last.1,
    min: first.1,
    max: first.1,
    mean: 0.0,
    argmin_step: first.0,
    argmax_step: first.0,
  };
  let mut total = 0.0;
  for &(step, value, _) in points {
    total += value;
    if value < summary.min {
      summary.min = value;
      summary.argmin_step = step;
    }
    if value > summary.max {
      summary.max = value;
      summary.argmax_step = step;
    }
  }
  summary.mean = total / points.len() as f64;
  Some(summary)
}

// ---- Listing projects ------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
pub struct ProjectInfo {
  pub name: String,
  pub path: String,
  pub bytes: u64,
  pub modified_ms: i64,
  pub wal: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct ProjectsResponse {
  pub dir: String,
  pub projects: Vec<ProjectInfo>,
}

/// The databases in the trackio directory, newest first. A missing
/// directory is an empty list, not an error.
pub fn list_projects() -> ProjectsResponse {
  let dir = trackio_dir();
  let mut projects = Vec::new();
  if let Ok(entries) = std::fs::read_dir(&dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().and_then(|e| e.to_str()) != Some("db") {
        continue;
      }
      let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
        continue;
      };
      if name.starts_with("registry-") {
        continue;
      }
      let wal_path = PathBuf::from(format!("{}-wal", path.display()));
      projects.push(ProjectInfo {
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        bytes: file_stamp(&path).1,
        modified_ms: modified_ms(&path),
        wal: file_stamp(&wal_path).1 > 0,
      });
    }
  }
  projects.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(a.name.cmp(&b.name)));
  ProjectsResponse {
    dir: dir.to_string_lossy().to_string(),
    projects,
  }
}

// ---- Listing runs ----------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
pub struct KeyInfo {
  pub key: String,
  /// Rows holding a scalar for this key.
  pub count: u64,
}

#[derive(Serialize, Debug, Clone)]
pub struct RunInfo {
  pub name: String,
  pub ids: Vec<String>,
  /// Several run ids share this name (a restarted run); their rows merge.
  pub ambiguous: bool,
  pub created_at: Option<String>,
  pub first_step: i64,
  pub last_step: i64,
  pub rows: u64,
  pub first_ms: Option<i64>,
  pub last_ms: Option<i64>,
  pub keys: Vec<KeyInfo>,
  pub config: BTreeMap<String, Value>,
}

#[derive(Serialize, Debug, Clone)]
pub struct RunsResponse {
  pub db: String,
  pub version: String,
  pub schema: u8,
  pub immutable: bool,
  pub modified_ms: i64,
  pub runs: Vec<RunInfo>,
}

/// Runs responses by database, reused while the version is unchanged.
static RUNS_CACHE: Mutex<Option<HashMap<PathBuf, RunsResponse>>> = Mutex::new(None);

/// Every run with its step range, scalar metric keys and flattened config.
pub fn list_runs(path: &Path) -> Result<RunsResponse, ExpError> {
  let db = open(path)?;
  let version = version(&db);
  if let Some(cached) = RUNS_CACHE
    .lock()
    .unwrap()
    .as_ref()
    .and_then(|c| c.get(path))
    .filter(|c| c.version == version)
  {
    return Ok(cached.clone());
  }

  let response = read_runs(&db, version).map_err(|e| sqlite_error(e, path))?;
  RUNS_CACHE
    .lock()
    .unwrap()
    .get_or_insert_with(HashMap::new)
    .insert(path.to_path_buf(), response.clone());
  Ok(response)
}

struct RunAcc {
  ids: Vec<String>,
  first_step: i64,
  last_step: i64,
  rows: u64,
  first_ts: Option<String>,
  last_ts: Option<String>,
  keys: BTreeMap<String, u64>,
}

fn read_runs(db: &Db, version: String) -> rusqlite::Result<RunsResponse> {
  let id_column = if db.schema == 2 { "run_id" } else { "run_name" };
  let sql = format!(
    "SELECT run_name, {}, step, timestamp, metrics FROM metrics ORDER BY timestamp, id",
    id_column
  );
  let mut stmt = db.conn.prepare(&sql)?;
  let mut rows = stmt.query([])?;

  let mut order: Vec<String> = Vec::new();
  let mut runs: HashMap<String, RunAcc> = HashMap::new();
  while let Some(row) = rows.next()? {
    let name: String = row.get(0)?;
    let id: String = row.get(1)?;
    let step: i64 = row.get(2)?;
    let ts: String = row.get(3)?;
    let metrics = json_column(row, 4)?;

    let acc = runs.entry(name.clone()).or_insert_with(|| {
      order.push(name.clone());
      RunAcc {
        ids: Vec::new(),
        first_step: step,
        last_step: step,
        rows: 0,
        first_ts: None,
        last_ts: None,
        keys: BTreeMap::new(),
      }
    });
    if !acc.ids.contains(&id) {
      acc.ids.push(id);
    }
    acc.first_step = acc.first_step.min(step);
    acc.last_step = acc.last_step.max(step);
    acc.rows += 1;
    if acc.first_ts.is_none() {
      acc.first_ts = Some(ts.clone());
    }
    acc.last_ts = Some(ts);
    if let Some(Value::Object(map)) = metrics {
      for (key, value) in map {
        if is_scalar(&value) {
          *acc.keys.entry(key).or_insert(0) += 1;
        }
      }
    }
  }
  drop(rows);
  drop(stmt);

  let configs = read_configs(&db.conn).unwrap_or_default();

  let runs = order
    .into_iter()
    .map(|name| {
      let acc = runs
        .remove(&name)
        .expect("every ordered run was accumulated");
      let (created_at, config) = configs
        .get(&name)
        .cloned()
        .unwrap_or((None, BTreeMap::new()));
      RunInfo {
        ambiguous: acc.ids.len() > 1,
        ids: acc.ids,
        created_at: created_at.or_else(|| acc.first_ts.clone()),
        first_step: acc.first_step,
        last_step: acc.last_step,
        rows: acc.rows,
        first_ms: acc.first_ts.as_deref().and_then(parse_iso_ms),
        last_ms: acc.last_ts.as_deref().and_then(parse_iso_ms),
        keys: acc
          .keys
          .into_iter()
          .map(|(key, count)| KeyInfo { key, count })
          .collect(),
        config,
        name,
      }
    })
    .collect();

  Ok(RunsResponse {
    db: db.path.to_string_lossy().to_string(),
    version,
    schema: db.schema,
    immutable: db.immutable,
    modified_ms: modified_ms(&db.path),
    runs,
  })
}

type ConfigByRun = HashMap<String, (Option<String>, BTreeMap<String, Value>)>;

fn read_configs(conn: &Connection) -> rusqlite::Result<ConfigByRun> {
  let mut out = HashMap::new();
  if table_columns(conn, "configs")?.is_empty() {
    return Ok(out);
  }
  let mut stmt = conn.prepare("SELECT run_name, config, created_at FROM configs ORDER BY id")?;
  let mut rows = stmt.query([])?;
  while let Some(row) = rows.next()? {
    let name: String = row.get(0)?;
    let config = json_column(row, 1)?;
    let created: Option<String> = row.get(2)?;
    let flat = config.map(|v| flatten_config(&v)).unwrap_or_default();
    out.insert(name, (created, flat));
  }
  Ok(out)
}

// ---- Fetching series -------------------------------------------------------

#[derive(Deserialize, Debug, Clone, Default)]
pub struct SeriesRequest {
  pub runs: Vec<String>,
  pub keys: Vec<String>,
  /// Points per series after downsampling; 0 returns summaries only.
  #[serde(default)]
  pub max_points: Option<usize>,
  /// Keep every row when a step is logged twice instead of the last one.
  #[serde(default)]
  pub keep_duplicate_steps: bool,
  /// The version the caller already holds; an unchanged database answers
  /// with `unchanged` and no data.
  #[serde(default)]
  pub if_version: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct Series {
  pub run: String,
  pub key: String,
  /// Points before downsampling.
  pub n: usize,
  /// Rows where the key held a non-finite value ("NaN", "Infinity").
  pub n_nonfinite: usize,
  pub downsampled: bool,
  pub summary: Option<Summary>,
  pub points: Vec<Point>,
}

#[derive(Serialize, Debug, Clone)]
pub struct Missing {
  pub run: String,
  pub key: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(untagged)]
pub enum SeriesResponse {
  Data {
    db: String,
    version: String,
    schema: u8,
    immutable: bool,
    modified_ms: i64,
    series: Vec<Series>,
    missing: Vec<Missing>,
  },
  Unchanged {
    unchanged: bool,
    version: String,
    modified_ms: i64,
  },
}

/// The points of every requested (run, key) pair. Rows are read in
/// trackio's own order (timestamp, then id). A step logged several times
/// keeps its last value unless `keep_duplicate_steps` is set.
pub fn fetch_series(path: &Path, request: &SeriesRequest) -> Result<SeriesResponse, ExpError> {
  if request.runs.is_empty() || request.keys.is_empty() {
    return Err(ExpError::bad_request("name at least one run and one key"));
  }
  let max_points = request
    .max_points
    .unwrap_or(DEFAULT_MAX_POINTS)
    .min(MAX_POINTS_CAP);

  let db = open(path)?;
  let version = version(&db);
  if request.if_version.as_deref() == Some(version.as_str()) {
    return Ok(SeriesResponse::Unchanged {
      unchanged: true,
      version,
      modified_ms: modified_ms(path),
    });
  }

  let mut series = Vec::new();
  let mut missing = Vec::new();
  let mut stmt = db
    .conn
    .prepare(
      "SELECT step, timestamp, metrics FROM metrics WHERE run_name = ?1 ORDER BY timestamp, id",
    )
    .map_err(|e| sqlite_error(e, path))?;

  for run in &request.runs {
    // One pass over the run's rows collects every requested key.
    let mut collected: Vec<(Vec<Point>, HashMap<i64, usize>, usize)> = request
      .keys
      .iter()
      .map(|_| (Vec::new(), HashMap::new(), 0))
      .collect();
    let mut rows = stmt
      .query(params![run])
      .map_err(|e| sqlite_error(e, path))?;
    while let Some(row) = rows.next().map_err(|e| sqlite_error(e, path))? {
      let step: i64 = row.get(0).map_err(|e| sqlite_error(e, path))?;
      let ts: String = row.get(1).map_err(|e| sqlite_error(e, path))?;
      let metrics = json_column(row, 2).map_err(|e| sqlite_error(e, path))?;
      let Some(Value::Object(map)) = metrics else {
        continue;
      };
      let t = parse_iso_ms(&ts);
      for (index, key) in request.keys.iter().enumerate() {
        let Some(value) = map.get(key) else { continue };
        let (points, by_step, nonfinite) = &mut collected[index];
        match parse_metric_value(value) {
          Some(v) => {
            if !request.keep_duplicate_steps {
              if let Some(&at) = by_step.get(&step) {
                points[at] = (step, v, t);
                continue;
              }
              by_step.insert(step, points.len());
            }
            points.push((step, v, t));
          }
          None if is_scalar(value) => *nonfinite += 1,
          None => {}
        }
      }
    }

    for (key, (points, _, nonfinite)) in request.keys.iter().zip(collected) {
      if points.is_empty() && nonfinite == 0 {
        missing.push(Missing {
          run: run.clone(),
          key: key.clone(),
        });
        continue;
      }
      let summary = summarize(&points);
      let n = points.len();
      let (points, downsampled) = if max_points == 0 {
        (Vec::new(), n > 0)
      } else if n > max_points {
        let xy: Vec<(f64, f64)> = points.iter().map(|p| (p.0 as f64, p.1)).collect();
        let kept = lttb(&xy, max_points);
        (kept.into_iter().map(|i| points[i]).collect(), true)
      } else {
        (points, false)
      };
      series.push(Series {
        run: run.clone(),
        key: key.clone(),
        n,
        n_nonfinite: nonfinite,
        downsampled,
        summary,
        points,
      });
    }
  }

  Ok(SeriesResponse::Data {
    db: db.path.to_string_lossy().to_string(),
    version,
    schema: db.schema,
    immutable: db.immutable,
    modified_ms: modified_ms(path),
    series,
    missing,
  })
}

/// Keys of a JSON object as `Map`, for tests and fixtures.
#[cfg(test)]
pub(crate) fn object(pairs: &[(&str, Value)]) -> Value {
  let mut map = serde_json::Map::new();
  for (k, v) in pairs {
    map.insert((*k).to_string(), v.clone());
  }
  Value::Object(map)
}

/// Writing trackio-shaped databases for tests, with trackio's own DDL.
#[cfg(test)]
pub(crate) mod fixture {
  use super::*;

  pub struct Row<'a> {
    pub run: &'a str,
    pub step: i64,
    pub timestamp: &'a str,
    pub metrics: Value,
  }

  /// Create a database at `path`. Schema 2 has `run_id` and stores JSON as
  /// BLOBs, as current trackio does; schema 1 has neither.
  pub fn write(path: &Path, schema: u8, rows: &[Row], configs: &[(&str, Value)], wal: bool) {
    let conn = Connection::open(path).unwrap();
    if wal {
      conn
        .query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))
        .unwrap();
    }
    let run_id = if schema == 2 {
      "run_id TEXT NOT NULL,"
    } else {
      ""
    };
    conn
      .execute_batch(&format!(
        "CREATE TABLE metrics (
           id INTEGER PRIMARY KEY AUTOINCREMENT, {run_id}
           timestamp TEXT NOT NULL, run_name TEXT NOT NULL,
           step INTEGER NOT NULL, metrics TEXT NOT NULL, log_id TEXT, space_id TEXT);
         CREATE TABLE configs (
           id INTEGER PRIMARY KEY AUTOINCREMENT, {run_id}
           run_name TEXT NOT NULL, config TEXT NOT NULL, created_at TEXT NOT NULL);"
      ))
      .unwrap();
    for row in rows {
      if schema == 2 {
        conn
          .execute(
            "INSERT INTO metrics (run_id, timestamp, run_name, step, metrics) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![format!("id-{}", row.run), row.timestamp, row.run, row.step, row.metrics.to_string().into_bytes()],
          )
          .unwrap();
      } else {
        conn
          .execute(
            "INSERT INTO metrics (timestamp, run_name, step, metrics) VALUES (?1, ?2, ?3, ?4)",
            params![row.timestamp, row.run, row.step, row.metrics.to_string()],
          )
          .unwrap();
      }
    }
    for (run, config) in configs {
      if schema == 2 {
        conn
          .execute(
            "INSERT INTO configs (run_id, run_name, config, created_at) VALUES (?1, ?2, ?3, '2026-01-01T00:00:00')",
            params![format!("id-{}", run), run, config.to_string().into_bytes()],
          )
          .unwrap();
      } else {
        conn
          .execute(
            "INSERT INTO configs (run_name, config, created_at) VALUES (?1, ?2, '2026-01-01T00:00:00')",
            params![run, config.to_string()],
          )
          .unwrap();
      }
    }
  }

  /// Two runs with `split/family/name` keys, partial rows per step, a
  /// non-finite value, an image-valued key and nested configs.
  pub fn standard(path: &Path, schema: u8, wal: bool) {
    let mut rows = Vec::new();
    let image = serde_json::json!({"_type": "trackio.image", "file_path": "x.png"});
    for (run, scale) in [("exp_1", 1.0), ("exp_2", 2.0)] {
      for step in 0..10i64 {
        let ts: &'static str =
          Box::leak(format!("2026-01-01T00:00:{:02}.500000", step).into_boxed_str());
        rows.push(Row {
          run,
          step,
          timestamp: ts,
          metrics: serde_json::json!({
            "train/loss/ce": scale * (10 - step) as f64,
            "train/loss/kl": 0.5 * scale,
          }),
        });
        // A second, partial row for the same step: only validation keys.
        let val = if step == 3 {
          Value::String("NaN".into())
        } else {
          serde_json::json!(scale * (12 - step) as f64)
        };
        rows.push(Row {
          run,
          step,
          timestamp: ts,
          metrics: object(&[("val/loss/ce", val), ("samples", image.clone())]),
        });
      }
    }
    let configs = [
      (
        "exp_1",
        serde_json::json!({"model": {"arch": "conv", "width": 64}, "lr": 0.001, "tags": ["a"]}),
      ),
      (
        "exp_2",
        serde_json::json!({"model": {"arch": "vit", "width": 64}, "lr": 0.002, "episodes": "Infinity"}),
      ),
    ];
    write(path, schema, &rows, &configs, wal);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("md-render-exp-{}-{}", name, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
  }

  #[test]
  fn canonical_project_keeps_only_safe_characters() {
    assert_eq!(canonical_project("my proj!.v2"), "myprojv2");
    assert_eq!(canonical_project("a_b-c"), "a_b-c");
    assert_eq!(canonical_project("..//"), "default");
  }

  #[test]
  fn sources_resolve_relative_to_the_document() {
    let dir = temp_dir("resolve");
    let db = dir.join("runs.db");
    fixture::standard(&db, 2, false);
    let source = DbSource {
      db: Some("./runs.db".into()),
      project: None,
    };
    assert_eq!(resolve_source(&source, Some(&dir)).unwrap(), db);
    let absolute = DbSource {
      db: Some(db.to_string_lossy().to_string()),
      project: None,
    };
    assert_eq!(resolve_source(&absolute, None).unwrap(), db);

    let missing = DbSource {
      db: Some("nope.db".into()),
      project: None,
    };
    assert_eq!(
      resolve_source(&missing, Some(&dir)).unwrap_err().error,
      "not_found"
    );
    assert_eq!(
      resolve_source(&missing, None).unwrap_err().error,
      "bad_request"
    );
    let both = DbSource {
      db: Some("a.db".into()),
      project: Some("a".into()),
    };
    assert_eq!(resolve_source(&both, Some(&dir)).unwrap_err().status(), 400);
    assert_eq!(
      resolve_source(&DbSource::default(), None)
        .unwrap_err()
        .status(),
      400
    );
  }

  #[test]
  fn values_parse_and_non_finite_strings_are_skipped() {
    assert_eq!(parse_metric_value(&json!(1.5)), Some(1.5));
    assert_eq!(parse_metric_value(&json!(3)), Some(3.0));
    for skipped in [
      json!("NaN"),
      json!("Infinity"),
      json!("-Infinity"),
      json!(true),
      json!({"a": 1}),
    ] {
      assert_eq!(parse_metric_value(&skipped), None);
    }
    assert!(is_scalar(&json!("NaN")));
    assert!(!is_scalar(&json!({"_type": "image"})));
  }

  #[test]
  fn configs_flatten_to_dot_paths() {
    let flat =
      flatten_config(&json!({"model": {"arch": "vit", "dims": [1, 2]}, "lr": 0.1, "none": null}));
    assert_eq!(flat.get("model.arch"), Some(&json!("vit")));
    assert_eq!(flat.get("model.dims"), Some(&json!("[1,2]")));
    assert_eq!(flat.get("lr"), Some(&json!(0.1)));
    assert_eq!(flat.get("none"), Some(&Value::Null));
  }

  #[test]
  fn iso_timestamps_parse_with_and_without_offsets() {
    assert_eq!(parse_iso_ms("1970-01-01T00:00:01"), Some(1000));
    assert_eq!(parse_iso_ms("1970-01-01T00:00:01.250000"), Some(1250));
    assert_eq!(parse_iso_ms("1970-01-01T01:00:00+01:00"), Some(0));
    assert_eq!(
      parse_iso_ms("2026-05-15T13:20:43.084159+00:00"),
      Some(1_778_851_243_084)
    );
    assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(parse_iso_ms("not a time"), None);
  }

  #[test]
  fn lttb_keeps_the_ends_and_the_spike() {
    let mut points: Vec<(f64, f64)> = (0..1000).map(|i| (i as f64, 0.0)).collect();
    points[500].1 = 100.0;
    let kept = lttb(&points, 50);
    assert_eq!(kept.len(), 50);
    assert_eq!(kept[0], 0);
    assert_eq!(*kept.last().unwrap(), 999);
    assert!(kept.contains(&500));
    assert_eq!(lttb(&points[..10], 50).len(), 10);
  }

  #[test]
  fn summaries_track_extremes_and_their_steps() {
    let s = summarize(&[(0, 3.0, None), (1, 1.0, None), (2, 5.0, None)]).unwrap();
    assert_eq!((s.first, s.last, s.min, s.max), (3.0, 5.0, 1.0, 5.0));
    assert_eq!((s.argmin_step, s.argmax_step), (1, 2));
    assert!((s.mean - 3.0).abs() < 1e-12);
    assert!(summarize(&[]).is_none());
  }

  #[test]
  fn runs_list_keys_steps_and_configs_in_both_schemas() {
    let dir = temp_dir("runs");
    for schema in [1u8, 2] {
      let db = dir.join(format!("s{}.db", schema));
      fixture::standard(&db, schema, false);
      let runs = list_runs(&db).unwrap();
      assert_eq!(runs.schema, schema);
      assert!(!runs.immutable);
      let names: Vec<_> = runs.runs.iter().map(|r| r.name.as_str()).collect();
      assert_eq!(names, ["exp_1", "exp_2"]);
      let first = &runs.runs[0];
      assert_eq!((first.first_step, first.last_step, first.rows), (0, 9, 20));
      let keys: Vec<_> = first.keys.iter().map(|k| k.key.as_str()).collect();
      // The image-valued key is not a metric; the NaN row still counts.
      assert_eq!(keys, ["train/loss/ce", "train/loss/kl", "val/loss/ce"]);
      assert_eq!(first.keys[2].count, 10);
      assert_eq!(first.config.get("model.arch"), Some(&json!("conv")));
      assert_eq!(
        runs.runs[1].config.get("episodes"),
        Some(&json!("Infinity"))
      );
      assert!(!first.ambiguous);
      assert_eq!(first.first_ms, parse_iso_ms("2026-01-01T00:00:00.5"));
    }
  }

  #[test]
  fn series_merge_partial_rows_and_downsample_after_summaries() {
    let dir = temp_dir("series");
    let db = dir.join("p.db");
    fixture::standard(&db, 2, false);
    let request = SeriesRequest {
      runs: vec!["exp_1".into(), "exp_2".into(), "ghost".into()],
      keys: vec!["train/loss/ce".into(), "val/loss/ce".into()],
      max_points: Some(4),
      ..Default::default()
    };
    let SeriesResponse::Data {
      series,
      missing,
      version,
      ..
    } = fetch_series(&db, &request).unwrap()
    else {
      panic!("expected data");
    };
    assert_eq!(series.len(), 4);
    let train = &series[0];
    assert_eq!(
      (train.run.as_str(), train.key.as_str()),
      ("exp_1", "train/loss/ce")
    );
    assert_eq!(train.n, 10);
    assert!(train.downsampled);
    assert_eq!(train.points.len(), 4);
    assert_eq!(train.points[0].0, 0);
    assert_eq!(train.points[3].0, 9);
    let summary = train.summary.as_ref().unwrap();
    assert_eq!((summary.first, summary.last, summary.min), (10.0, 1.0, 1.0));
    let val = &series[1];
    assert_eq!((val.n, val.n_nonfinite), (9, 1));
    assert_eq!(missing.len(), 2);
    assert!(missing.iter().all(|m| m.run == "ghost"));

    // The same version answers unchanged.
    let again = SeriesRequest {
      if_version: Some(version),
      ..request.clone()
    };
    assert!(matches!(
      fetch_series(&db, &again).unwrap(),
      SeriesResponse::Unchanged { .. }
    ));

    // Summaries only.
    let summaries = SeriesRequest {
      max_points: Some(0),
      if_version: None,
      ..request
    };
    let SeriesResponse::Data { series, .. } = fetch_series(&db, &summaries).unwrap() else {
      panic!("expected data");
    };
    assert!(series
      .iter()
      .all(|s| s.points.is_empty() && s.summary.is_some()));
  }

  #[test]
  fn duplicate_steps_keep_the_last_value_unless_asked() {
    let dir = temp_dir("dupes");
    let db = dir.join("d.db");
    let rows = [
      fixture::Row {
        run: "r",
        step: 1,
        timestamp: "2026-01-01T00:00:01",
        metrics: json!({"x": 1.0}),
      },
      fixture::Row {
        run: "r",
        step: 1,
        timestamp: "2026-01-01T00:00:02",
        metrics: json!({"x": 2.0}),
      },
      fixture::Row {
        run: "r",
        step: 2,
        timestamp: "2026-01-01T00:00:03",
        metrics: json!({"x": 3.0}),
      },
    ];
    fixture::write(&db, 2, &rows, &[], false);
    let mut request = SeriesRequest {
      runs: vec!["r".into()],
      keys: vec!["x".into()],
      ..Default::default()
    };
    let SeriesResponse::Data { series, .. } = fetch_series(&db, &request).unwrap() else {
      panic!()
    };
    let values: Vec<f64> = series[0].points.iter().map(|p| p.1).collect();
    assert_eq!(values, [2.0, 3.0]);
    request.keep_duplicate_steps = true;
    let SeriesResponse::Data { series, .. } = fetch_series(&db, &request).unwrap() else {
      panic!()
    };
    assert_eq!(series[0].points.len(), 3);
  }

  #[test]
  fn databases_open_read_only() {
    let dir = temp_dir("readonly");
    let db = dir.join("r.db");
    fixture::standard(&db, 2, false);
    let opened = open(&db).unwrap();
    assert!(opened.conn.execute("DELETE FROM metrics", []).is_err());
  }

  #[test]
  fn wal_databases_are_readable_while_a_writer_holds_them() {
    let dir = temp_dir("wal");
    let db = dir.join("w.db");
    fixture::standard(&db, 2, true);
    let writer = Connection::open(&db).unwrap();
    writer.execute_batch("BEGIN; INSERT INTO metrics (run_id, timestamp, run_name, step, metrics) VALUES ('id-exp_1', '2026-01-01T00:01:00', 'exp_1', 10, '{\"train/loss/ce\": 0.5}');").unwrap();
    let runs = list_runs(&db).unwrap();
    assert_eq!(runs.runs[0].last_step, 9, "uncommitted rows are invisible");
    writer.execute_batch("COMMIT").unwrap();
    let runs = list_runs(&db).unwrap();
    assert_eq!(
      runs.runs[0].last_step, 10,
      "a new version is read, not the cache"
    );
  }

  #[cfg(unix)]
  #[test]
  fn a_wal_database_in_a_read_only_directory_is_read_as_a_snapshot() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir("immutable");
    let db = dir.join("i.db");
    fixture::standard(&db, 2, true);
    // Leave the database in WAL mode without -shm, then lock the directory.
    let _ = std::fs::remove_file(dir.join("i.db-shm"));
    let _ = std::fs::remove_file(dir.join("i.db-wal"));
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    let result = list_runs(&db);
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    let runs = result.unwrap();
    assert!(runs.immutable);
    assert_eq!(runs.runs.len(), 2);
  }

  #[test]
  fn a_file_without_metrics_is_not_a_project() {
    let dir = temp_dir("notrackio");
    let db = dir.join("other.db");
    Connection::open(&db)
      .unwrap()
      .execute_batch("CREATE TABLE t (x)")
      .unwrap();
    assert_eq!(list_runs(&db).unwrap_err().error, "bad_schema");
    let text = dir.join("plain.db");
    std::fs::write(
      &text,
      "hello, not sqlite at all, just some text padding it out",
    )
    .unwrap();
    assert!(list_runs(&text).is_err());
  }
}
