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

/// `$XDG_STATE_HOME/md-render/servers/<port>.json`, falling back to
/// `~/.local/state/...` when the variable is unset.
pub fn record_path(port: u16) -> Option<PathBuf> {
  let base = match std::env::var_os("XDG_STATE_HOME") {
    Some(dir) if !dir.is_empty() => PathBuf::from(dir),
    _ => dirs::home_dir()?.join(".local/state"),
  };
  Some(base.join("md-render/servers").join(format!("{}.json", port)))
}

/// Write the record with owner-only permissions. The token gates the endpoint
/// that adds documents, so it must not be world-readable.
pub fn write(record: &ServerRecord) -> std::io::Result<()> {
  let path = record_path(record.port).ok_or_else(|| {
    std::io::Error::new(std::io::ErrorKind::NotFound, "no state directory available")
  })?;
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

pub fn read(port: u16) -> Option<ServerRecord> {
  let path = record_path(port)?;
  let contents = fs::read_to_string(path).ok()?;
  serde_json::from_str(&contents).ok()
}

pub fn remove(port: u16) {
  if let Some(path) = record_path(port) {
    let _ = fs::remove_file(path);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn record_path_follows_xdg_state_home() {
    let dir = std::env::temp_dir().join(format!("md-render-state-{}", std::process::id()));
    std::env::set_var("XDG_STATE_HOME", &dir);

    let path = record_path(8080).unwrap();
    assert_eq!(path, dir.join("md-render/servers/8080.json"));

    std::env::remove_var("XDG_STATE_HOME");
  }

  #[test]
  fn round_trips_a_record_and_removes_it() {
    let dir = std::env::temp_dir().join(format!("md-render-state-rt-{}", std::process::id()));
    std::env::set_var("XDG_STATE_HOME", &dir);

    let record = ServerRecord {
      port: 9931,
      token: "secret-token".to_string(),
      pid: 4242,
    };
    write(&record).unwrap();

    let loaded = read(9931).expect("record should be readable");
    assert_eq!(loaded.token, "secret-token");
    assert_eq!(loaded.pid, 4242);

    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mode = std::fs::metadata(record_path(9931).unwrap())
        .unwrap()
        .permissions()
        .mode();
      // Owner-only: the token must not leak to other users on the machine.
      assert_eq!(mode & 0o077, 0);
    }

    remove(9931);
    assert!(read(9931).is_none());

    std::env::remove_var("XDG_STATE_HOME");
  }
}
