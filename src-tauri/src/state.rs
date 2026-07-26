//! On-disk record of a running server, so a second `md-render --port N` can
//! find it and hand over new documents instead of failing to bind.

use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ServerRecord {
  pub port: u16,
  pub token: String,
  pub pid: u32,
}

/// `$XDG_STATE_HOME`, falling back to `~/.local/state`.
fn base_dir() -> Option<PathBuf> {
  match std::env::var_os("XDG_STATE_HOME") {
    Some(dir) if !dir.is_empty() => Some(PathBuf::from(dir)),
    _ => Some(dirs::home_dir()?.join(".local/state")),
  }
}

fn record_path_under(base: &std::path::Path, port: u16) -> PathBuf {
  base
    .join("md-render/servers")
    .join(format!("{}.json", port))
}

/// Write the record with owner-only permissions. The token gates the endpoint
/// that adds documents, so it must not be world-readable.
fn write_under(base: &std::path::Path, record: &ServerRecord) -> std::io::Result<()> {
  let path = record_path_under(base, record.port);
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }

  let json = serde_json::to_string(record)
    .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
  fs::write(&path, json)?;

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
  }

  Ok(())
}

fn read_under(base: &std::path::Path, port: u16) -> Option<ServerRecord> {
  let contents = fs::read_to_string(record_path_under(base, port)).ok()?;
  serde_json::from_str(&contents).ok()
}

fn remove_under(base: &std::path::Path, port: u16) {
  let _ = fs::remove_file(record_path_under(base, port));
}

pub fn write(record: &ServerRecord) -> std::io::Result<()> {
  let base = base_dir().ok_or_else(|| {
    std::io::Error::new(std::io::ErrorKind::NotFound, "no state directory available")
  })?;
  write_under(&base, record)
}

pub fn read(port: u16) -> Option<ServerRecord> {
  read_under(&base_dir()?, port)
}

pub fn remove(port: u16) {
  if let Some(base) = base_dir() {
    remove_under(&base, port);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // These operate on an explicit base directory rather than mutating
  // XDG_STATE_HOME, because Rust runs tests in parallel threads and a shared
  // environment variable makes them race against each other.
  fn temp_base(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("md-render-state-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn record_path_is_namespaced_by_port() {
    let base = PathBuf::from("/tmp/state");
    assert_eq!(
      record_path_under(&base, 8080),
      PathBuf::from("/tmp/state/md-render/servers/8080.json")
    );
  }

  #[test]
  fn round_trips_a_record_and_removes_it() {
    let base = temp_base("round-trip");
    let record = ServerRecord {
      port: 9931,
      token: "secret-token".to_string(),
      pid: 4242,
    };
    write_under(&base, &record).unwrap();

    let loaded = read_under(&base, 9931).expect("record should be readable");
    assert_eq!(loaded.token, "secret-token");
    assert_eq!(loaded.pid, 4242);

    remove_under(&base, 9931);
    assert!(read_under(&base, 9931).is_none());
  }

  #[cfg(unix)]
  #[test]
  fn the_token_file_is_not_readable_by_other_users() {
    use std::os::unix::fs::PermissionsExt;

    let base = temp_base("permissions");
    write_under(
      &base,
      &ServerRecord {
        port: 9932,
        token: "secret-token".to_string(),
        pid: 1,
      },
    )
    .unwrap();

    let mode = fs::metadata(record_path_under(&base, 9932))
      .unwrap()
      .permissions()
      .mode();
    assert_eq!(mode & 0o077, 0);
  }

  #[test]
  fn missing_records_read_as_none() {
    let base = temp_base("missing");
    assert!(read_under(&base, 9933).is_none());
  }
}
