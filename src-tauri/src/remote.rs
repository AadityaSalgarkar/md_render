//! Markdown from the internet.
//!
//! A URL given where a path is expected is downloaded into a temporary
//! directory and opened from there like any local file, in the window and
//! in server mode alike. The local path is derived from the URL, so the same
//! URL always lands in the same place: naming it again re-opens the same
//! tab, and a refresh downloads it again in place.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(30);

/// Largest document accepted, so a wrong URL cannot fill the disk.
const MAX_BYTES: u64 = 20 * 1024 * 1024;

/// A downloaded document: where it sits, and the directory that plays the
/// part of "the directory it came from" for workspace and label purposes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fetched {
  /// Local copy of the document.
  pub path: PathBuf,
  /// Directory standing in for the remote location — one per repository
  /// on GitHub, one per host and directory elsewhere.
  pub root: PathBuf,
  /// Tab label: the document's path relative to `root`.
  pub label: String,
}

pub fn is_url(arg: &str) -> bool {
  arg.starts_with("http://") || arg.starts_with("https://")
}

/// `/tmp/md-render/remote` where `/tmp` exists (macOS and Linux), otherwise
/// the platform's temporary directory. `MDRENDER_REMOTE_DIR` overrides.
pub fn base_dir() -> PathBuf {
  if let Some(dir) = std::env::var_os("MDRENDER_REMOTE_DIR") {
    if !dir.is_empty() {
      return PathBuf::from(dir);
    }
  }
  let tmp = PathBuf::from("/tmp");
  let base = if tmp.is_dir() {
    tmp
  } else {
    std::env::temp_dir()
  };
  base.join("md-render").join("remote")
}

/// The URL actually downloaded. GitHub's HTML "blob" pages become their raw
/// counterparts; anything else is taken as given.
pub fn raw_url(url: &str) -> String {
  if let Some(rest) = url.strip_prefix("https://github.com/") {
    // owner/repo/blob/ref/path...
    let parts: Vec<&str> = rest.splitn(5, '/').collect();
    if parts.len() == 5 && (parts[2] == "blob" || parts[2] == "raw") {
      return format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        parts[0], parts[1], parts[3], parts[4]
      );
    }
  }
  url.to_string()
}

/// One path segment that needs no escaping and cannot walk anywhere.
fn clean_segment(raw: &str) -> String {
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
  if cleaned.is_empty() || cleaned.chars().all(|c| c == '.') {
    "_".to_string()
  } else {
    cleaned
  }
}

/// Where a URL lives locally, relative to [`base_dir`]: the root directory
/// and the document's path beneath it.
///
/// GitHub: `github.com-OWNER-REPO/PATH` (the ref is dropped so a branch and
/// its files keep one workspace). Elsewhere: `HOST/DIRS.../FILE`, with the
/// root at `HOST/DIRS...`. A URL ending in `/` or without an extension gets
/// `index.md` / `.md` so the app treats it as markdown.
pub fn local_layout(url: &str) -> Option<(PathBuf, PathBuf)> {
  let without_scheme = url
    .strip_prefix("https://")
    .or_else(|| url.strip_prefix("http://"))?;
  let without_query = without_scheme
    .split(['?', '#'])
    .next()
    .unwrap_or(without_scheme);
  let (host, path) = match without_query.find('/') {
    Some(index) => (&without_query[..index], &without_query[index + 1..]),
    None => (without_query, ""),
  };
  if host.is_empty() {
    return None;
  }

  let mut segments: Vec<String> = path
    .split('/')
    .filter(|s| !s.is_empty())
    .map(clean_segment)
    .collect();

  let (root, rest): (PathBuf, Vec<String>) = if host == "github.com" && segments.len() >= 4 {
    // owner/repo/blob/ref/... -> github.com-owner-repo / ...
    let root = PathBuf::from(format!("{}-{}-{}", clean_segment(host), segments[0], segments[1]));
    (root, segments.split_off(4))
  } else if host == "raw.githubusercontent.com" && segments.len() >= 3 {
    // owner/repo/ref/... -> github.com-owner-repo / ...
    let root = PathBuf::from(format!("github.com-{}-{}", segments[0], segments[1]));
    (root, segments.split_off(3))
  } else {
    let file = segments.pop();
    let mut root = PathBuf::from(clean_segment(host));
    for dir in &segments {
      root.push(dir);
    }
    (root, file.into_iter().collect())
  };

  let mut file: Vec<String> = if rest.is_empty() {
    vec!["index.md".to_string()]
  } else {
    rest
  };
  let last = file.last_mut().unwrap();
  let is_markdown = Path::new(last)
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown"))
    .unwrap_or(false);
  if !is_markdown {
    last.push_str(".md");
  }

  let mut relative = PathBuf::new();
  for segment in file {
    relative.push(segment);
  }
  Some((root, relative))
}

fn cache() -> &'static Mutex<HashMap<String, Fetched>> {
  static CACHE: OnceLock<Mutex<HashMap<String, Fetched>>> = OnceLock::new();
  CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Download `url` into its local place. `refresh` forces a new download;
/// otherwise a URL already fetched by this process is returned as is, so
/// parsing the command line and then serving it does not download twice.
pub fn fetch(url: &str, refresh: bool) -> Result<Fetched, String> {
  if !refresh {
    if let Some(hit) = cache().lock().ok().and_then(|c| c.get(url).cloned()) {
      return Ok(hit);
    }
  }

  let (root_rel, file_rel) =
    local_layout(url).ok_or_else(|| format!("'{}' is not a URL that can be fetched", url))?;
  let root = base_dir().join(root_rel);
  let path = root.join(file_rel);

  let body = download(&raw_url(url))?;

  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|err| format!("could not create {}: {}", parent.display(), err))?;
  }
  std::fs::write(&path, body).map_err(|err| format!("could not write {}: {}", path.display(), err))?;

  let root = root
    .canonicalize()
    .map_err(|err| format!("could not resolve {}: {}", root.display(), err))?;
  let path = path
    .canonicalize()
    .map_err(|err| format!("could not resolve {}: {}", path.display(), err))?;
  let label = path
    .strip_prefix(&root)
    .unwrap_or(&path)
    .to_string_lossy()
    .to_string();

  let fetched = Fetched { path, root, label };
  if let Ok(mut c) = cache().lock() {
    c.insert(url.to_string(), fetched.clone());
  }
  Ok(fetched)
}

fn download(url: &str) -> Result<Vec<u8>, String> {
  let client = reqwest::blocking::Client::builder()
    .timeout(TIMEOUT)
    .user_agent(concat!("md-render/", env!("CARGO_PKG_VERSION")))
    .build()
    .map_err(|err| format!("could not set up the download: {}", err))?;

  let response = client
    .get(url)
    .send()
    .map_err(|err| format!("could not fetch {}: {}", url, err))?;
  let status = response.status();
  if !status.is_success() {
    return Err(format!("could not fetch {}: HTTP {}", url, status.as_u16()));
  }
  if response.content_length().unwrap_or(0) > MAX_BYTES {
    return Err(format!("{} is larger than {} MB", url, MAX_BYTES / 1024 / 1024));
  }

  let bytes = response
    .bytes()
    .map_err(|err| format!("could not read {}: {}", url, err))?;
  if bytes.len() as u64 > MAX_BYTES {
    return Err(format!("{} is larger than {} MB", url, MAX_BYTES / 1024 / 1024));
  }
  Ok(bytes.to_vec())
}

/// A loopback HTTP server handing out fixed markdown, for tests that need a
/// real download without the internet. Returns its port; every request to a
/// known path bumps the shared counter so callers can count downloads.
#[cfg(test)]
pub(crate) fn serve_markdown(
  files: Vec<(&'static str, &'static str)>,
) -> (u16, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
  use std::io::{Read, Write};
  use std::sync::atomic::{AtomicUsize, Ordering};
  use std::sync::Arc;

  let hits = Arc::new(AtomicUsize::new(0));
  let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
  let port = listener.local_addr().unwrap().port();
  let counter = Arc::clone(&hits);
  std::thread::spawn(move || {
    for stream in listener.incoming() {
      let Ok(mut stream) = stream else { continue };
      let mut buffer = [0u8; 2048];
      let _ = stream.read(&mut buffer);
      let request = String::from_utf8_lossy(&buffer);
      let requested = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("");
      let (status, body) = match files.iter().find(|(path, _)| *path == requested) {
        Some((_, body)) => {
          let n = counter.fetch_add(1, Ordering::SeqCst) + 1;
          ("200 OK", body.replace("{n}", &n.to_string()))
        }
        None => ("404 Not Found", "nope".to_string()),
      };
      let _ = write!(
        stream,
        "HTTP/1.1 {}\r\nContent-Type: text/markdown\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.len(),
        body
      );
    }
  });
  (port, hits)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn recognises_only_http_urls() {
    assert!(is_url("https://example.com/a.md"));
    assert!(is_url("http://127.0.0.1:8000/a.md"));
    assert!(!is_url("/tmp/a.md"));
    assert!(!is_url("notes.md"));
    assert!(!is_url("ftp://example.com/a.md"));
  }

  #[test]
  fn github_blob_pages_download_as_raw() {
    assert_eq!(
      raw_url("https://github.com/anthropics/skills/blob/main/README.md"),
      "https://raw.githubusercontent.com/anthropics/skills/main/README.md"
    );
    assert_eq!(
      raw_url("https://github.com/o/r/blob/v1.2/docs/guide/setup.md"),
      "https://raw.githubusercontent.com/o/r/v1.2/docs/guide/setup.md"
    );
    // Already raw, or not GitHub: unchanged.
    let raw = "https://raw.githubusercontent.com/o/r/main/x.md";
    assert_eq!(raw_url(raw), raw);
    let other = "https://example.com/notes/today.md";
    assert_eq!(raw_url(other), other);
    // A repository page is not a file page.
    let repo = "https://github.com/anthropics/skills";
    assert_eq!(raw_url(repo), repo);
  }

  #[test]
  fn github_urls_share_one_root_per_repository() {
    let (root, file) = local_layout("https://github.com/anthropics/skills/blob/main/README.md").unwrap();
    assert_eq!(root, PathBuf::from("github.com-anthropics-skills"));
    assert_eq!(file, PathBuf::from("README.md"));

    let (root, file) =
      local_layout("https://github.com/anthropics/skills/blob/main/docs/guide/setup.md").unwrap();
    assert_eq!(root, PathBuf::from("github.com-anthropics-skills"));
    assert_eq!(file, PathBuf::from("docs/guide/setup.md"));

    // The raw host maps to the same place, so either URL re-opens one tab.
    let (root, file) =
      local_layout("https://raw.githubusercontent.com/anthropics/skills/main/README.md").unwrap();
    assert_eq!(root, PathBuf::from("github.com-anthropics-skills"));
    assert_eq!(file, PathBuf::from("README.md"));
  }

  #[test]
  fn other_hosts_map_to_host_and_directories() {
    let (root, file) = local_layout("https://example.com/notes/today.md?x=1#top").unwrap();
    assert_eq!(root, PathBuf::from("example.com/notes"));
    assert_eq!(file, PathBuf::from("today.md"));

    let (root, file) = local_layout("http://127.0.0.1:8000/a.md").unwrap();
    assert_eq!(root, PathBuf::from("127.0.0.1-8000"));
    assert_eq!(file, PathBuf::from("a.md"));

    // No file name, or no markdown extension: still opens as markdown.
    let (root, file) = local_layout("https://example.com/").unwrap();
    assert_eq!(root, PathBuf::from("example.com"));
    assert_eq!(file, PathBuf::from("index.md"));
    let (_, file) = local_layout("https://example.com/page").unwrap();
    assert_eq!(file, PathBuf::from("page.md"));
  }

  #[test]
  fn path_segments_cannot_walk_out_of_the_base() {
    let (root, file) = local_layout("https://evil.example/../../etc/passwd.md").unwrap();
    assert!(!root.to_string_lossy().contains(".."));
    assert!(!file.to_string_lossy().contains(".."));
    assert_eq!(file, PathBuf::from("passwd.md"));
    assert!(local_layout("https:///a.md").is_none());
  }

  /// A real HTTP server on loopback, so the download path is exercised for
  /// real: layout on disk, label, caching, and re-fetching on refresh.
  #[test]
  fn fetches_into_the_remote_directory_and_refreshes_in_place() {
    use std::sync::atomic::Ordering;

    let (port, hits) = serve_markdown(vec![("/docs/guide.md", "# Guide\n\nversion {n}\n")]);

    // The real base directory: the port makes this test's corner of it
    // unique, and mutating the environment would race the other tests.
    let url = format!("http://127.0.0.1:{}/docs/guide.md", port);
    let fetched = fetch(&url, false).unwrap();
    assert_eq!(fetched.label, "guide.md");
    assert!(fetched.path.starts_with(&fetched.root));
    assert!(fetched.root.starts_with(base_dir().canonicalize().unwrap()));
    assert!(fetched.root.ends_with(format!("127.0.0.1-{}/docs", port)));
    assert_eq!(std::fs::read_to_string(&fetched.path).unwrap(), "# Guide\n\nversion 1\n");

    // Naming it again in the same process does not download again.
    assert_eq!(fetch(&url, false).unwrap(), fetched);
    assert_eq!(hits.load(Ordering::SeqCst), 1);

    // A refresh does, into the same file.
    let again = fetch(&url, true).unwrap();
    assert_eq!(again.path, fetched.path);
    assert_eq!(std::fs::read_to_string(&again.path).unwrap(), "# Guide\n\nversion 2\n");

    // A missing document is an error that names the status.
    let missing = fetch(&format!("http://127.0.0.1:{}/nope.md", port), false).unwrap_err();
    assert!(missing.contains("HTTP 404"), "{}", missing);

    let _ = std::fs::remove_dir_all(fetched.root.parent().unwrap());
  }
}
