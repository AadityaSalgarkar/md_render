mod attach;
mod cli;
mod server;
mod state;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// Global state to store the launch file path
static LAUNCH_FILE: Mutex<Option<String>> = Mutex::new(None);

/// Documents named on the command line, surfaced to the frontend as tabs.
static LAUNCH_DOCUMENTS: Mutex<Vec<cli::Document>> = Mutex::new(Vec::new());

/// The path arguments as given, so a refresh can rescan directories and pick
/// up markdown added since launch.
static LAUNCH_SOURCES: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(serde::Serialize)]
pub struct DocumentMeta {
  id: usize,
  label: String,
  path: String,
}

fn documents_as_meta() -> Vec<DocumentMeta> {
  LAUNCH_DOCUMENTS
    .lock()
    .map(|documents| {
      documents
        .iter()
        .enumerate()
        .map(|(id, doc)| DocumentMeta {
          id,
          label: doc.label.clone(),
          path: doc.path.to_string_lossy().to_string(),
        })
        .collect()
    })
    .unwrap_or_default()
}

/// Add documents to the open set, skipping ones already there. Returns whether
/// anything was added.
fn merge_documents(found: Vec<cli::Document>) -> bool {
  let Ok(mut open) = LAUNCH_DOCUMENTS.lock() else {
    return false;
  };

  let existing: std::collections::HashSet<PathBuf> =
    open.iter().map(|doc| doc.path.clone()).collect();
  let mut added = false;

  for document in found {
    if existing.contains(&document.path) {
      continue;
    }
    open.push(document);
    added = true;
  }

  added
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
    merge_documents(found);
  }
  documents_as_meta()
}

/// Open a file that arrived while the app was running — a Finder double-click
/// or a deep link — as another tab rather than replacing the current one.
#[tauri::command]
fn add_document(path: String) -> Vec<DocumentMeta> {
  if let Ok(found) = cli::collect_documents(&[path]) {
    merge_documents(found);
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

/// Serve mode: either start a server, or hand the documents to one that is
/// already holding the port.
fn run_server(
  host: String,
  port: u16,
  documents: Vec<cli::Document>,
  sources: Vec<String>,
) -> Result<(), String> {
  match attach::probe(&host, port) {
    attach::Probe::MdRender => {
      let record = state::read(port).ok_or_else(|| {
        format!(
          "a md-render server is already on port {}, but its token could not be read; \
           it may have been started by another user",
          port
        )
      })?;

      let paths: Vec<String> = documents
        .iter()
        .map(|doc| doc.path.to_string_lossy().to_string())
        .collect();

      let added = attach::add_documents(&host, port, &record.token, &paths)?;
      if added.is_empty() {
        println!("already open on http://{}:{}", host, port);
      } else {
        println!("added to http://{}:{}", host, port);
        for label in added {
          println!("  {}", label);
        }
      }
      Ok(())
    }
    attach::Probe::Occupied => Err(format!(
      "port {} is in use by another program",
      port
    )),
    attach::Probe::Free => server::run(&host, port, documents, sources),
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
      documents,
      sources,
    } => {
      if let Err(err) = run_server(host, port, documents, sources) {
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
  if let Ok(mut guard) = LAUNCH_DOCUMENTS.lock() {
    *guard = documents;
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
      add_document
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
