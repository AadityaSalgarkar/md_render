mod attach;
mod cli;
mod server;
mod state;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// Global state to store the launch file path
static LAUNCH_FILE: Mutex<Option<String>> = Mutex::new(None);

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

fn export_path(path: &str) -> PathBuf {
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
fn run_server(host: String, port: u16, documents: Vec<cli::Document>) -> Result<(), String> {
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
    attach::Probe::Free => server::run(&host, port, documents),
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

  let launch_file = match mode {
    cli::Mode::Help => {
      println!("{}", cli::USAGE);
      return;
    }
    cli::Mode::Serve {
      host,
      port,
      documents,
    } => {
      if let Err(err) = run_server(host, port, documents) {
        eprintln!("md-render: {}", err);
        std::process::exit(1);
      }
      return;
    }
    cli::Mode::Desktop { launch_file } => launch_file,
  };

  // Check for launch file from command-line args before building the app
  if let Some(file_path) = launch_file {
    if let Ok(mut guard) = LAUNCH_FILE.lock() {
      *guard = Some(file_path.to_string_lossy().to_string());
    }
  }

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![read_file, write_file, export_markdown, get_launch_file])
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
