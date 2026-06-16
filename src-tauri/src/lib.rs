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

fn find_launch_file_from_args() -> Option<String> {
  let args: Vec<String> = std::env::args().collect();
  // Skip the first arg (binary path), look for file paths
  for arg in args.iter().skip(1) {
    // Skip flags
    if arg.starts_with('-') {
      continue;
    }
    // Check if it's a valid file path
    let path = std::path::Path::new(arg);
    if path.exists() && path.is_file() {
      return Some(arg.clone());
    }
    // Also try without checking existence (macOS might pass relative paths)
    if arg.ends_with(".md") || arg.ends_with(".markdown") {
      return Some(arg.clone());
    }
  }
  None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Check for launch file from command-line args before building the app
  if let Some(file_path) = find_launch_file_from_args() {
    if let Ok(mut guard) = LAUNCH_FILE.lock() {
      *guard = Some(file_path);
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
