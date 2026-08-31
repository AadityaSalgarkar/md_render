mod attach;
mod cli;
mod server;
mod state;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

// Global state to store the launch file path
static LAUNCH_FILE: Mutex<Option<String>> = Mutex::new(None);

/// The path arguments as given, so a refresh can rescan directories and pick
/// up markdown added since launch.
static LAUNCH_SOURCES: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Documents named on the command line (and added since), surfaced to the
/// frontend as tabs.
static DOCUMENTS: OnceLock<Mutex<DocumentStore>> = OnceLock::new();

fn store() -> &'static Mutex<DocumentStore> {
  DOCUMENTS.get_or_init(|| Mutex::new(DocumentStore::default()))
}

#[derive(serde::Serialize)]
pub struct DocumentMeta {
  id: u64,
  label: String,
  path: String,
}

/// One open document plus the id the frontend addresses it by.
struct DocEntry {
  id: u64,
  document: cli::Document,
}

/// The open-document set behind the tab strip. Ids are handed out once and
/// never reused, so closing a tab never renumbers the others — the frontend's
/// active id, its `?doc=` URL and any in-flight read all stay valid.
#[derive(Default)]
pub struct DocumentStore {
  next_id: u64,
  entries: Vec<DocEntry>,
  /// Paths the user closed. A rescan (refresh) leaves these closed; only an
  /// explicit re-add opens them again.
  closed: HashSet<PathBuf>,
}

impl DocumentStore {
  /// Add documents, skipping ones already open. `explicit` marks paths the
  /// user named just now, which re-opens a previously closed document; a
  /// background rescan leaves closed documents closed.
  fn merge(&mut self, found: Vec<cli::Document>, explicit: bool) {
    for document in found {
      if explicit {
        self.closed.remove(&document.path);
      } else if self.closed.contains(&document.path) {
        continue;
      }
      if self.entries.iter().any(|e| e.document.path == document.path) {
        continue;
      }
      self.entries.push(DocEntry {
        id: self.next_id,
        document,
      });
      self.next_id += 1;
    }
  }

  /// Close a tab. The path is remembered so a refresh does not bring it back.
  fn remove(&mut self, id: u64) -> bool {
    let Some(index) = self.entries.iter().position(|e| e.id == id) else {
      return false;
    };
    let entry = self.entries.remove(index);
    self.closed.insert(entry.document.path);
    true
  }

  fn as_meta(&self) -> Vec<DocumentMeta> {
    self
      .entries
      .iter()
      .map(|entry| DocumentMeta {
        id: entry.id,
        label: entry.document.label.clone(),
        path: entry.document.path.to_string_lossy().to_string(),
      })
      .collect()
  }
}

fn documents_as_meta() -> Vec<DocumentMeta> {
  store().lock().map(|s| s.as_meta()).unwrap_or_default()
}

/// The open documents, mirroring the server's `/api/files` so the frontend can
/// build tabs the same way in either mode.
#[tauri::command]
fn list_documents() -> Vec<DocumentMeta> {
  documents_as_meta()
}

/// Rescan the original path arguments and return the tab list. Markdown added
/// to a directory that was named on the command line shows up here.
#[tauri::command]
fn refresh_documents() -> Vec<DocumentMeta> {
  let sources = LAUNCH_SOURCES.lock().map(|s| s.clone()).unwrap_or_default();
  if let Ok(found) = cli::collect_documents(&sources) {
    if let Ok(mut open) = store().lock() {
      // A rescan, not an explicit ask: closed tabs stay closed.
      open.merge(found, false);
    }
  }
  documents_as_meta()
}

/// Open a file that arrived while the app was running — a Finder double-click
/// or a deep link — as another tab rather than replacing the current one.
#[tauri::command]
fn add_document(path: String) -> Vec<DocumentMeta> {
  if let Ok(found) = cli::collect_documents(&[path]) {
    if let Ok(mut open) = store().lock() {
      open.merge(found, true);
    }
  }
  documents_as_meta()
}

/// Close a tab. The id is the string the frontend got from `list_documents`;
/// the updated tab list comes back so the caller need not re-fetch.
#[tauri::command]
fn remove_document(id: String) -> Vec<DocumentMeta> {
  if let Ok(id) = id.parse::<u64>() {
    if let Ok(mut open) = store().lock() {
      open.remove(id);
    }
  }
  documents_as_meta()
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
  fs::read_to_string(&path)
    .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
  fs::write(&path, content)
    .map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn export_markdown(path: String, content: String) -> Result<String, String> {
  let output_path = export_path(&path);
  fs::write(&output_path, content)
    .map_err(|e| format!("Failed to export file: {}", e))?;
  Ok(output_path.to_string_lossy().to_string())
}

pub(crate) fn export_path(path: &str) -> PathBuf {
  let source = Path::new(path);
  let stem = source
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or("export");
  let extension = source
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("md");
  let file_name = format!("{}.clean.{}", stem, extension);

  source
    .parent()
    .map(|parent| parent.join(&file_name))
    .unwrap_or_else(|| PathBuf::from(file_name))
}

#[tauri::command]
fn get_launch_file() -> Option<String> {
  // First check the global state (set from command-line args)
  if let Ok(guard) = LAUNCH_FILE.lock() {
    if let Some(ref path) = *guard {
      return Some(path.clone());
    }
  }
  // Fall back to environment variable (for wrapper script)
  std::env::var("TAURI_LAUNCH_FILE").ok()
}

/// First port from `start` that is free or already an md-render server —
/// anything held by another program is skipped.
fn pick_port(host: &str, start: u16, attempts: u16) -> Result<u16, String> {
  for offset in 0..attempts {
    let Some(candidate) = start.checked_add(offset) else {
      break;
    };
    if attach::probe(host, candidate) != attach::Probe::Occupied {
      return Ok(candidate);
    }
  }
  Err(format!(
    "no usable port between {} and {}; pass --port to pick one explicitly",
    start,
    start.saturating_add(attempts.saturating_sub(1))
  ))
}

/// Serve mode: either start a server, or hand the documents to one that is
/// already holding the port. Without an explicit port, scan forward from the
/// default so the user never has to pick one.
fn run_server(host: String, port: Option<u16>, sources: Vec<String>) -> Result<(), String> {
  let port = match port {
    Some(explicit) => explicit,
    None => pick_port(&host, cli::DEFAULT_PORT, cli::PORT_SCAN_ATTEMPTS)?,
  };

  match attach::probe(&host, port) {
    attach::Probe::MdRender => {
      let record = state::read(port).ok_or_else(|| {
        format!(
          "a md-render server is already on port {}, but its token could not be read; \
           it may have been started by another user",
          port
        )
      })?;

      let (added, workspaces) = attach::add_documents(&host, port, &record.token, &sources)?;
      if added.is_empty() {
        println!("already open on http://{}:{}", host, port);
      } else {
        println!("added to http://{}:{}", host, port);
        for label in added {
          println!("  {}", label);
        }
      }
      for workspace in workspaces {
        println!("open: http://{}:{}/{}/", host, port, workspace);
      }
      Ok(())
    }
    attach::Probe::Occupied => Err(format!(
      "port {} is in use by another program",
      port
    )),
    attach::Probe::Free => {
      let specs = cli::group_workspaces(&sources).map_err(|err| err.to_string())?;
      server::run(&host, port, specs)
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let args: Vec<String> = std::env::args().skip(1).collect();

  let mode = match cli::parse(&args) {
    Ok(mode) => mode,
    Err(err) => {
      eprintln!("md-render: {}", err);
      eprintln!("\n{}", cli::USAGE);
      std::process::exit(2);
    }
  };

  let (documents, sources) = match mode {
    cli::Mode::Help => {
      println!("{}", cli::USAGE);
      return;
    }
    cli::Mode::Serve {
      host,
      port,
      sources,
      ..
    } => {
      if let Err(err) = run_server(host, port, sources) {
        eprintln!("md-render: {}", err);
        std::process::exit(1);
      }
      return;
    }
    cli::Mode::Desktop { documents, sources } => (documents, sources),
  };

  // Check for launch file from command-line args before building the app
  if let Some(first) = documents.first() {
    if let Ok(mut guard) = LAUNCH_FILE.lock() {
      *guard = Some(first.path.to_string_lossy().to_string());
    }
  }
  if let Ok(mut open) = store().lock() {
    open.merge(documents, true);
  }
  if let Ok(mut guard) = LAUNCH_SOURCES.lock() {
    *guard = sources;
  }

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      read_file,
      write_file,
      export_markdown,
      get_launch_file,
      list_documents,
      refresh_documents,
      add_document,
      remove_document
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;

  fn doc(path: &str) -> cli::Document {
    cli::Document {
      path: PathBuf::from(path),
      label: Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default(),
    }
  }

  #[test]
  fn ids_are_stable_across_a_removal() {
    let mut open = DocumentStore::default();
    open.merge(vec![doc("/tmp/a.md"), doc("/tmp/b.md"), doc("/tmp/c.md")], true);

    let before = open.as_meta();
    assert_eq!(before.iter().map(|m| m.id).collect::<Vec<_>>(), vec![0, 1, 2]);

    assert!(open.remove(1));

    // The neighbours keep the exact ids the frontend already holds.
    let after = open.as_meta();
    assert_eq!(after.len(), 2);
    assert_eq!(after[0].id, 0);
    assert_eq!(after[1].id, 2);
    assert_eq!(after[1].label, "c.md");
  }

  #[test]
  fn removing_an_unknown_id_is_a_no_op() {
    let mut open = DocumentStore::default();
    open.merge(vec![doc("/tmp/a.md")], true);

    assert!(!open.remove(99));
    assert_eq!(open.as_meta().len(), 1);
  }

  #[test]
  fn a_rescan_does_not_resurrect_a_closed_document() {
    let mut open = DocumentStore::default();
    open.merge(vec![doc("/tmp/a.md"), doc("/tmp/b.md")], true);
    assert!(open.remove(0));

    // The refresh path finds the same files on disk again.
    open.merge(vec![doc("/tmp/a.md"), doc("/tmp/b.md")], false);

    let labels: Vec<_> = open.as_meta().into_iter().map(|m| m.label).collect();
    assert_eq!(labels, vec!["b.md"]);
  }

  #[test]
  fn an_explicit_add_reopens_a_closed_document_under_a_fresh_id() {
    let mut open = DocumentStore::default();
    open.merge(vec![doc("/tmp/a.md")], true);
    assert!(open.remove(0));

    open.merge(vec![doc("/tmp/a.md")], true);

    let meta = open.as_meta();
    assert_eq!(meta.len(), 1);
    // Never reuse an id: anything still holding id 0 must not suddenly point
    // at the re-opened document.
    assert_eq!(meta[0].id, 1);
  }

  #[test]
  fn duplicates_are_skipped_without_burning_ids() {
    let mut open = DocumentStore::default();
    open.merge(vec![doc("/tmp/a.md")], true);
    open.merge(vec![doc("/tmp/a.md")], true);
    open.merge(vec![doc("/tmp/b.md")], true);

    let meta = open.as_meta();
    assert_eq!(meta.len(), 2);
    assert_eq!(meta[1].id, 1);
  }

  #[test]
  fn pick_port_skips_a_port_held_by_another_program() {
    use std::io::{Read, Write};

    // A non-mdrender HTTP server squats on the first candidate port.
    let blocker = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let held = blocker.local_addr().unwrap().port();
    std::thread::spawn(move || {
      for stream in blocker.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut buffer = [0u8; 512];
        let _ = stream.read(&mut buffer);
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nsomething else");
        let _ = stream.shutdown(std::net::Shutdown::Both);
      }
    });

    let picked = pick_port("127.0.0.1", held, 5).unwrap();
    assert_ne!(picked, held);
    assert!(picked > held && picked < held + 5);
  }
}
