use std::path::{Path, PathBuf};

/// Markdown extensions that a directory scan will pick up.
const MARKDOWN_EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// How deep a directory argument is scanned. Guards against pathological trees.
const MAX_SCAN_DEPTH: usize = 16;

/// First port tried when `--port` is given without a number.
pub const DEFAULT_PORT: u16 = 9999;

/// How many consecutive ports to try when none is given explicitly and the
/// default is held by another program.
pub const PORT_SCAN_ATTEMPTS: u16 = 50;

/// A document the app was asked to open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Document {
  /// Absolute path on disk.
  pub path: PathBuf,
  /// Label for the tab: file name, or path relative to the directory argument
  /// it came from, so files with the same name stay distinguishable.
  pub label: String,
}

/// What the process should do, decided entirely by argv.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mode {
  /// Print usage and exit.
  Help,
  /// Normal Tauri window. More than one document opens as tabs, matching what
  /// server mode does with the same arguments.
  Desktop {
    documents: Vec<Document>,
    /// The path arguments as given, kept so directories can be rescanned when
    /// the user asks to refresh.
    sources: Vec<String>,
  },
  /// Headless HTTP server.
  Serve {
    host: String,
    /// `None` means no port was named: start at [`DEFAULT_PORT`] and fall
    /// forward to the next usable one. An explicit port is used exactly.
    port: Option<u16>,
    documents: Vec<Document>,
    sources: Vec<String>,
  },
}

/// One URL namespace on the server: a directory and the documents under it.
/// Every directory argument is (or joins) the workspace of its canonical
/// path; every file joins the workspace of its parent directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSpec {
  /// Canonical directory this workspace represents.
  pub dir: PathBuf,
  /// Suggested URL segment: the directory's last component, sanitised.
  /// Uniqueness across workspaces is the server's job.
  pub name_hint: String,
  pub documents: Vec<Document>,
  /// The path arguments feeding this workspace, rescanned on refresh.
  pub sources: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CliError {
  MissingValue(&'static str),
  InvalidPort(String),
  NoDocuments,
  UnreadablePath(String),
  UnknownFlag(String),
}

impl std::fmt::Display for CliError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      CliError::MissingValue(flag) => write!(f, "{} requires a value", flag),
      CliError::InvalidPort(value) => write!(
        f,
        "invalid port '{}': expected a number between 1 and 65535",
        value
      ),
      CliError::NoDocuments => write!(
        f,
        "--port requires at least one markdown file or directory to serve"
      ),
      CliError::UnreadablePath(path) => write!(f, "cannot read '{}'", path),
      CliError::UnknownFlag(flag) => write!(f, "unknown option '{}'", flag),
    }
  }
}

pub const USAGE: &str = "\
Usage:
  md-render [FILE|DIR]...                open the desktop app (several files: tabs)
  md-render --port [PORT] [FILE|DIR]...  serve rendered markdown over HTTP

Serving:
  Without a PORT the server takes 9999, or the next free port when another
  program holds it. Each directory (or a file's parent directory) becomes a
  workspace at http://127.0.0.1:PORT/<dirname>/ with one tab per markdown
  file. Re-running the command against a live server adds to it.

Options:
  -p, --port [PORT]   port to listen on, 1-65535 (default 9999, auto-fallback)
      --host <ADDR>   address to bind (default 127.0.0.1)
  -h, --help          show this help";

/// Parse argv (already stripped of the binary name).
pub fn parse(args: &[String]) -> Result<Mode, CliError> {
  let mut serve = false;
  let mut port: Option<u16> = None;
  let mut host: Option<String> = None;
  let mut paths: Vec<String> = Vec::new();

  let mut idx = 0;
  while idx < args.len() {
    let arg = &args[idx];
    match arg.as_str() {
      "--help" | "-h" => return Ok(Mode::Help),
      "--port" | "-p" => {
        // The value is optional: `--port 8080 a.md` picks 8080, while
        // `--port a.md` leaves the port to be chosen automatically rather
        // than swallowing the path as a port.
        serve = true;
        match args.get(idx + 1) {
          Some(value) if is_numeric(value) => {
            port = Some(parse_port(value)?);
            idx += 2;
          }
          _ => {
            idx += 1;
          }
        }
      }
      "--host" => {
        let value = args.get(idx + 1).ok_or(CliError::MissingValue("--host"))?;
        host = Some(value.clone());
        idx += 2;
      }
      _ => {
        if let Some(value) = arg.strip_prefix("--port=") {
          serve = true;
          port = Some(parse_port(value)?);
        } else if let Some(value) = arg.strip_prefix("--host=") {
          host = Some(value.to_string());
        } else if arg.starts_with('-') && arg.len() > 1 {
          // Leave unknown flags alone in desktop mode: the OS may append its
          // own (macOS passes -psn_… when launching from Finder).
          if serve || arg.starts_with("--") {
            return Err(CliError::UnknownFlag(arg.clone()));
          }
        } else {
          paths.push(arg.clone());
        }
        idx += 1;
      }
    }
  }

  if serve {
    let documents = collect_documents(&paths)?;
    if documents.is_empty() {
      return Err(CliError::NoDocuments);
    }
    Ok(Mode::Serve {
      host: host.unwrap_or_else(|| "127.0.0.1".to_string()),
      port,
      documents,
      sources: paths,
    })
  } else {
    // Unreadable paths are not fatal here: the desktop app opens with its
    // local draft rather than refusing to start, as it always has.
    let documents = collect_documents(&paths).unwrap_or_default();
    Ok(Mode::Desktop {
      documents,
      sources: paths,
    })
  }
}

/// URL segment for a directory: its last component restricted to characters
/// that need no escaping. A root path (no components) falls back to "root".
pub fn workspace_name(dir: &Path) -> String {
  let raw = dir
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("root");

  let cleaned: String = raw
    .chars()
    .map(|c| {
      if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
        c
      } else {
        '-'
      }
    })
    .collect();

  if cleaned.is_empty() || cleaned.chars().all(|c| c == '.' || c == '-') {
    "root".to_string()
  } else {
    cleaned
  }
}

/// Group the path arguments into workspaces. Every directory argument is (or
/// joins) the workspace of its canonical path; every file joins the workspace
/// of its parent directory. Name collisions between *different* directories
/// are left for the server to resolve, since it owns the URL namespace.
pub fn group_workspaces(paths: &[String]) -> Result<Vec<WorkspaceSpec>, CliError> {
  let mut specs: Vec<WorkspaceSpec> = Vec::new();

  for raw in paths {
    let path = Path::new(raw)
      .canonicalize()
      .map_err(|_| CliError::UnreadablePath(raw.clone()))?;

    let dir = if path.is_dir() {
      path.clone()
    } else {
      path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("/"))
    };

    let documents = collect_documents(&[raw.clone()])?;

    match specs.iter_mut().find(|spec| spec.dir == dir) {
      Some(spec) => {
        for document in documents {
          if !spec.documents.iter().any(|d| d.path == document.path) {
            spec.documents.push(document);
          }
        }
        if !spec.sources.contains(raw) {
          spec.sources.push(raw.clone());
        }
      }
      None => specs.push(WorkspaceSpec {
        name_hint: workspace_name(&dir),
        dir,
        documents,
        sources: vec![raw.clone()],
      }),
    }
  }

  Ok(specs)
}

/// Digits only — used to tell a port from a path following `--port`.
fn is_numeric(value: &str) -> bool {
  !value.is_empty() && value.chars().all(|c| c.is_ascii_digit())
}

fn parse_port(value: &str) -> Result<u16, CliError> {
  // `u16::from_str` already rejects >65535 and negatives, which covers the
  // out-of-range case (e.g. 99999). Zero is rejected separately: binding port 0
  // would pick an arbitrary port the user was not told about.
  match value.parse::<u16>() {
    Ok(0) | Err(_) => Err(CliError::InvalidPort(value.to_string())),
    Ok(port) => Ok(port),
  }
}

fn has_markdown_extension(path: &Path) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| MARKDOWN_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
    .unwrap_or(false)
}

fn is_hidden(path: &Path) -> bool {
  path
    .file_name()
    .and_then(|name| name.to_str())
    .map(|name| name.starts_with('.'))
    .unwrap_or(false)
}

/// Turn the path arguments into the ordered document list backing the tabs.
/// Files are taken as given; directories are scanned for markdown.
pub fn collect_documents(paths: &[String]) -> Result<Vec<Document>, CliError> {
  let mut documents = Vec::new();

  for raw in paths {
    let path = Path::new(raw)
      .canonicalize()
      .map_err(|_| CliError::UnreadablePath(raw.clone()))?;

    if path.is_dir() {
      let mut found = Vec::new();
      scan_directory(&path, &path, 0, &mut found);
      // Stable ordering so tabs do not shuffle between runs.
      found.sort_by(|a, b| a.label.cmp(&b.label));
      documents.extend(found);
    } else {
      let label = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(raw)
        .to_string();
      documents.push(Document { path, label });
    }
  }

  // Drop duplicates (same file named twice, or named and also inside a scanned
  // directory) while preserving first-seen order.
  let mut seen = std::collections::HashSet::new();
  documents.retain(|doc| seen.insert(doc.path.clone()));

  Ok(documents)
}

fn scan_directory(root: &Path, dir: &Path, depth: usize, out: &mut Vec<Document>) {
  if depth > MAX_SCAN_DEPTH {
    return;
  }

  let entries = match std::fs::read_dir(dir) {
    Ok(entries) => entries,
    Err(_) => return,
  };

  for entry in entries.flatten() {
    let path = entry.path();
    if is_hidden(&path) {
      continue;
    }

    // `symlink_metadata` does not follow links, so a symlinked directory cannot
    // walk us outside the root.
    let metadata = match std::fs::symlink_metadata(&path) {
      Ok(metadata) => metadata,
      Err(_) => continue,
    };
    if metadata.file_type().is_symlink() {
      continue;
    }

    if metadata.is_dir() {
      scan_directory(root, &path, depth + 1, out);
    } else if has_markdown_extension(&path) {
      let label = path
        .strip_prefix(root)
        .unwrap_or(&path)
        .to_string_lossy()
        .to_string();
      out.push(Document { path, label });
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
  }

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("md-render-cli-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn help_is_requested_explicitly() {
    assert_eq!(parse(&args(&["--help"])).unwrap(), Mode::Help);
    assert_eq!(parse(&args(&["-h"])).unwrap(), Mode::Help);
  }

  #[test]
  fn no_port_means_desktop_mode() {
    assert_eq!(
      parse(&args(&[])).unwrap(),
      Mode::Desktop {
        documents: vec![],
        sources: vec![]
      }
    );
  }

  #[test]
  fn desktop_mode_picks_up_a_markdown_argument() {
    let dir = temp_dir("desktop-one");
    let file = dir.join("notes.md");
    fs::write(&file, "# notes").unwrap();

    match parse(&args(&[file.to_str().unwrap()])).unwrap() {
      Mode::Desktop { documents, .. } => {
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].label, "notes.md");
      }
      other => panic!("expected desktop mode, got {:?}", other),
    }
  }

  #[test]
  fn desktop_mode_opens_several_documents_as_tabs() {
    // The same arguments that produce tabs in server mode produce tabs here.
    let dir = temp_dir("desktop-many");
    let a = dir.join("a.md");
    let b = dir.join("b.md");
    fs::write(&a, "# a").unwrap();
    fs::write(&b, "# b").unwrap();

    match parse(&args(&[a.to_str().unwrap(), b.to_str().unwrap()])).unwrap() {
      Mode::Desktop { documents, .. } => {
        assert_eq!(documents.len(), 2);
        assert_eq!(documents[0].label, "a.md");
        assert_eq!(documents[1].label, "b.md");
      }
      other => panic!("expected desktop mode, got {:?}", other),
    }
  }

  #[test]
  fn desktop_mode_survives_a_path_that_does_not_exist() {
    // Finder and the wrapper can hand us odd arguments; opening the draft is
    // better than refusing to start.
    match parse(&args(&["/definitely/not/here.md"])).unwrap() {
      Mode::Desktop { documents, .. } => assert!(documents.is_empty()),
      other => panic!("expected desktop mode, got {:?}", other),
    }
  }

  #[test]
  fn rejects_ports_above_the_valid_range() {
    // The port from the original feature request: out of range for TCP.
    let err = parse(&args(&["--port", "99999", "a.md"])).unwrap_err();
    assert_eq!(err, CliError::InvalidPort("99999".to_string()));
    assert!(err.to_string().contains("between 1 and 65535"));
  }

  #[test]
  fn rejects_port_zero() {
    // Binding port 0 would pick an arbitrary port the user was never told.
    assert!(matches!(
      parse(&args(&["--port", "0", "a.md"])),
      Err(CliError::InvalidPort(_))
    ));
  }

  #[test]
  fn rejects_a_non_numeric_port_given_explicitly() {
    // With `=` the intent is unambiguous, so this is an error rather than a
    // fallback to the default port.
    assert!(matches!(
      parse(&args(&["--port=http", "a.md"])),
      Err(CliError::InvalidPort(_))
    ));
  }

  #[test]
  fn port_value_is_optional_and_defaults() {
    let dir = temp_dir("default-port");
    let file = dir.join("a.md");
    fs::write(&file, "# a").unwrap();

    let mode = parse(&args(&["--port", file.to_str().unwrap()])).unwrap();
    match mode {
      Mode::Serve {
        port, documents, ..
      } => {
        // No port named: the server picks one, starting from DEFAULT_PORT.
        assert_eq!(port, None);
        // The path must not have been swallowed as the port value.
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].label, "a.md");
      }
      other => panic!("expected serve mode, got {:?}", other),
    }
  }

  #[test]
  fn the_default_port_is_9999() {
    assert_eq!(DEFAULT_PORT, 9999);
  }

  #[test]
  fn bare_port_flag_still_needs_something_to_serve() {
    assert_eq!(
      parse(&args(&["--port"])).unwrap_err(),
      CliError::NoDocuments
    );
  }

  #[test]
  fn host_without_a_value_is_still_an_error() {
    assert_eq!(
      parse(&args(&["--host"])).unwrap_err(),
      CliError::MissingValue("--host")
    );
  }

  #[test]
  fn serving_without_documents_is_an_error() {
    assert_eq!(
      parse(&args(&["--port", "8080"])).unwrap_err(),
      CliError::NoDocuments
    );
  }

  #[test]
  fn serves_an_explicit_file_and_defaults_to_loopback() {
    let dir = temp_dir("explicit");
    let file = dir.join("a.md");
    fs::write(&file, "# a").unwrap();

    let mode = parse(&args(&["--port", "8080", file.to_str().unwrap()])).unwrap();
    match mode {
      Mode::Serve {
        host,
        port,
        documents,
        ..
      } => {
        assert_eq!(host, "127.0.0.1");
        assert_eq!(port, Some(8080));
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].label, "a.md");
      }
      other => panic!("expected serve mode, got {:?}", other),
    }
  }

  #[test]
  fn host_can_be_overridden() {
    let dir = temp_dir("host");
    let file = dir.join("a.md");
    fs::write(&file, "# a").unwrap();

    let mode = parse(&args(&[
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
      file.to_str().unwrap(),
    ]))
    .unwrap();
    match mode {
      Mode::Serve { host, .. } => assert_eq!(host, "0.0.0.0"),
      other => panic!("expected serve mode, got {:?}", other),
    }
  }

  #[test]
  fn equals_form_is_accepted() {
    let dir = temp_dir("equals");
    let file = dir.join("a.md");
    fs::write(&file, "# a").unwrap();

    let mode = parse(&args(&["--port=8081", file.to_str().unwrap()])).unwrap();
    match mode {
      Mode::Serve { port, .. } => assert_eq!(port, Some(8081)),
      other => panic!("expected serve mode, got {:?}", other),
    }
  }

  #[test]
  fn a_directory_groups_into_a_workspace_named_after_it() {
    let dir = temp_dir("ws-dir");
    fs::write(dir.join("a.md"), "# a").unwrap();
    fs::create_dir_all(dir.join("nested")).unwrap();
    fs::write(dir.join("nested/c.md"), "# c").unwrap();

    let specs = group_workspaces(&args(&[dir.to_str().unwrap()])).unwrap();

    assert_eq!(specs.len(), 1);
    let canonical = dir.canonicalize().unwrap();
    assert_eq!(specs[0].dir, canonical);
    assert_eq!(specs[0].name_hint, workspace_name(&canonical));
    assert_eq!(specs[0].documents.len(), 2);
  }

  #[test]
  fn a_file_joins_the_workspace_of_its_parent_directory() {
    let dir = temp_dir("ws-file");
    let file = dir.join("a.md");
    fs::write(&file, "# a").unwrap();

    let specs = group_workspaces(&args(&[file.to_str().unwrap()])).unwrap();

    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].dir, dir.canonicalize().unwrap());
    assert_eq!(specs[0].documents.len(), 1);
    assert_eq!(specs[0].documents[0].label, "a.md");
  }

  #[test]
  fn a_file_and_its_directory_share_one_workspace_without_duplicates() {
    let dir = temp_dir("ws-both");
    let a = dir.join("a.md");
    fs::write(&a, "# a").unwrap();
    fs::write(dir.join("b.md"), "# b").unwrap();

    let specs =
      group_workspaces(&args(&[a.to_str().unwrap(), dir.to_str().unwrap()])).unwrap();

    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].documents.len(), 2);
    // Both invocation styles must rescan on refresh.
    assert_eq!(specs[0].sources.len(), 2);
  }

  #[test]
  fn directories_with_the_same_name_stay_separate_workspaces() {
    let first = temp_dir("ws-same-a").join("notes");
    let second = temp_dir("ws-same-b").join("notes");
    for dir in [&first, &second] {
      fs::create_dir_all(dir).unwrap();
      fs::write(dir.join("a.md"), "# a").unwrap();
    }

    let specs =
      group_workspaces(&args(&[first.to_str().unwrap(), second.to_str().unwrap()])).unwrap();

    assert_eq!(specs.len(), 2);
    assert_eq!(specs[0].name_hint, "notes");
    assert_eq!(specs[1].name_hint, "notes");
    assert_ne!(specs[0].dir, specs[1].dir);
  }

  #[test]
  fn workspace_names_are_url_safe() {
    assert_eq!(workspace_name(Path::new("/tmp/my notes")), "my-notes");
    assert_eq!(workspace_name(Path::new("/tmp/a&b (final)")), "a-b--final-");
    assert_eq!(workspace_name(Path::new("/")), "root");
  }

  #[test]
  fn directory_argument_expands_to_markdown_sorted_and_skips_others() {
    let dir = temp_dir("scan");
    fs::write(dir.join("b.md"), "# b").unwrap();
    fs::write(dir.join("a.markdown"), "# a").unwrap();
    fs::write(dir.join("notes.txt"), "ignore me").unwrap();
    fs::write(dir.join(".hidden.md"), "# hidden").unwrap();
    fs::create_dir_all(dir.join("nested")).unwrap();
    fs::write(dir.join("nested/c.md"), "# c").unwrap();

    let documents = collect_documents(&args(&[dir.to_str().unwrap()])).unwrap();
    let labels: Vec<_> = documents.iter().map(|d| d.label.as_str()).collect();

    assert_eq!(labels, vec!["a.markdown", "b.md", "nested/c.md"]);
  }

  #[test]
  fn files_and_directories_can_be_mixed_without_duplicates() {
    let dir = temp_dir("mixed");
    let a = dir.join("a.md");
    fs::write(&a, "# a").unwrap();
    fs::write(dir.join("b.md"), "# b").unwrap();

    // The same file named explicitly and also found by the directory scan.
    let documents =
      collect_documents(&args(&[a.to_str().unwrap(), dir.to_str().unwrap()])).unwrap();

    assert_eq!(documents.len(), 2);
    assert_eq!(documents[0].label, "a.md");
  }

  #[test]
  fn unreadable_paths_are_reported() {
    let err = collect_documents(&args(&["/definitely/not/here.md"])).unwrap_err();
    assert!(matches!(err, CliError::UnreadablePath(_)));
  }
}
