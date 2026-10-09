//! Handing a URL to the user's browser.

use std::process::{Command, Stdio};

/// URL of one document on a server: the workspace page, focused on the tab.
pub fn document_url(host: &str, port: u16, workspace: &str, id: u64) -> String {
  format!("http://{}:{}/{}/?doc={}", host, port, workspace, id)
}

/// The command that opens URLs. `MDRENDER_BROWSER` names one explicitly
/// (an empty value disables opening); otherwise the platform opener, which on
/// Linux is only worth trying when a display is around.
fn opener() -> Option<String> {
  if let Some(custom) = std::env::var_os("MDRENDER_BROWSER") {
    let custom = custom.to_string_lossy().trim().to_string();
    return if custom.is_empty() { None } else { Some(custom) };
  }
  if cfg!(target_os = "macos") {
    return Some("open".to_string());
  }
  let has_display = std::env::var_os("DISPLAY").is_some_and(|v| !v.is_empty())
    || std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty());
  has_display.then(|| "xdg-open".to_string())
}

/// Open `url` in the browser. Returns whether an opener was launched, so the
/// caller can tell the user to open the URL by hand when it was not.
pub fn open(url: &str) -> bool {
  let Some(command) = opener() else {
    return false;
  };
  Command::new(command)
    .arg(url)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .is_ok()
}

/// Open the document in the browser and say so, or say what to open when
/// no browser could be launched here.
pub fn announce_and_open(url: &str) {
  if open(url) {
    println!("opening {} in the browser", url);
  } else {
    println!("open {} in your browser", url);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_document_url_names_the_workspace_page_and_the_tab() {
    assert_eq!(
      document_url("127.0.0.1", 9999, "docs", 3),
      "http://127.0.0.1:9999/docs/?doc=3"
    );
  }
}
