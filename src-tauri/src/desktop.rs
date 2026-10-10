//! The Tauri window: the commands the frontend invokes, and the app itself.
//! Compiled only with the `desktop` feature (the default); the server-only
//! build in the Docker image leaves it, and WebKit, out.

use std::fs;
use std::path::Path;

use crate::{cli, experiments, export_path, remote, store, tikz, DocumentMeta, LAUNCH_FILE, LAUNCH_SOURCES};

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

/// Save a document. A remote document's edit is also kept outside /tmp,
/// the same as in server mode; see `remote::save`.
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
  remote::save(Path::new(&path), &content)
    .map(|_| ())
    .map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn export_markdown(path: String, content: String) -> Result<String, String> {
  let output_path = export_path(&path);
  fs::write(&output_path, content)
    .map_err(|e| format!("Failed to export file: {}", e))?;
  Ok(output_path.to_string_lossy().to_string())
}

/// Experiment databases in the trackio directory.
#[tauri::command]
fn list_experiment_projects() -> experiments::ProjectsResponse {
  experiments::list_projects()
}

/// Runs, metric keys and configs of one experiment database. The desktop
/// window reads any path, as `read_file` does.
#[tauri::command]
async fn list_experiment_runs(
  source: experiments::DbSource,
  base_dir: Option<String>,
) -> Result<experiments::RunsResponse, experiments::ExpError> {
  tauri::async_runtime::spawn_blocking(move || {
    let path = experiments::resolve_source(&source, base_dir.as_deref().map(Path::new))?;
    experiments::list_runs(&path)
  })
  .await
  .map_err(|e| experiments::ExpError::bad_request(e.to_string()))?
}

/// Series for (runs x keys) from one experiment database.
#[tauri::command]
async fn fetch_experiment_series(
  source: experiments::DbSource,
  base_dir: Option<String>,
  request: experiments::SeriesRequest,
) -> Result<experiments::SeriesResponse, experiments::ExpError> {
  tauri::async_runtime::spawn_blocking(move || {
    let path = experiments::resolve_source(&source, base_dir.as_deref().map(Path::new))?;
    experiments::fetch_series(&path, &request)
  })
  .await
  .map_err(|e| experiments::ExpError::bad_request(e.to_string()))?
}

/// Compile a TikZ block to SVG (cached). Runs off the main thread: a first
/// compile can take seconds.
#[tauri::command]
async fn render_tikz(source: String) -> Result<tikz::Rendered, tikz::TikzError> {
  tauri::async_runtime::spawn_blocking(move || tikz::render(&source))
    .await
    .map_err(|e| tikz::TikzError {
      error: "engine",
      message: e.to_string(),
      log: Vec::new(),
    })?
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

/// Open the window with these documents as tabs.
pub fn run(documents: Vec<cli::Document>, sources: Vec<String>) {
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
      remove_document,
      list_experiment_projects,
      list_experiment_runs,
      fetch_experiment_series,
      render_tikz
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
