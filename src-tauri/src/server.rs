//! Headless HTTP mode: serves the embedded SPA plus a small read-only API over
//! the documents named on the command line.

use axum::{
  extract::{Query, State},
  http::{header, HeaderMap, StatusCode, Uri},
  response::{IntoResponse, Response},
  routing::{get, post},
  Json, Router,
};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use crate::cli::Document;
use crate::state::{self, ServerRecord};

#[derive(RustEmbed)]
#[folder = "../dist"]
struct Assets;

/// Extensions `/api/asset` will serve. Anything else is refused, so the asset
/// route cannot be turned into a general file-read primitive.
const ASSET_EXTENSIONS: [&str; 9] = [
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico",
];

pub struct ServerState {
  documents: Vec<Document>,
  /// Directories under which `/api/asset` may read. One per document parent.
  roots: HashSet<PathBuf>,
  token: String,
}

impl ServerState {
  pub fn new(documents: Vec<Document>, token: String) -> Self {
    let mut state = ServerState {
      documents: Vec::new(),
      roots: HashSet::new(),
      token,
    };
    state.add_documents(documents);
    state
  }

  /// Add documents, ignoring ones already open, and widen the asset roots to
  /// cover their directories.
  fn add_documents(&mut self, documents: Vec<Document>) -> Vec<Document> {
    let existing: HashSet<PathBuf> = self.documents.iter().map(|d| d.path.clone()).collect();
    let mut added = Vec::new();

    for document in documents {
      if existing.contains(&document.path) {
        continue;
      }
      if let Some(parent) = document.path.parent() {
        self.roots.insert(parent.to_path_buf());
      }
      added.push(document.clone());
      self.documents.push(document);
    }

    added
  }

  /// Whether `path` is one of the documents this server was asked to open.
  /// Reads and writes are limited to exactly these files — being inside a
  /// served directory is not enough.
  fn is_open_document(&self, path: &Path) -> bool {
    self.documents.iter().any(|doc| doc.path == path)
  }

  /// Whether `path` may be served as an asset: it must sit under a known root
  /// and carry an image extension.
  fn allows_asset(&self, path: &Path) -> bool {
    let has_image_extension = path
      .extension()
      .and_then(|ext| ext.to_str())
      .map(|ext| ASSET_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
      .unwrap_or(false);

    has_image_extension && self.roots.iter().any(|root| path.starts_with(root))
  }
}

type Shared = Arc<RwLock<ServerState>>;

#[derive(Serialize)]
struct DocumentMeta {
  id: usize,
  label: String,
  path: String,
}

#[derive(Serialize)]
struct DocumentBody {
  id: usize,
  label: String,
  path: String,
  base_dir: String,
  content: String,
}

#[derive(Deserialize)]
struct IdQuery {
  id: usize,
}

#[derive(Deserialize)]
struct PathQuery {
  path: String,
}

#[derive(Deserialize)]
struct AddDocuments {
  paths: Vec<String>,
}

#[derive(Deserialize)]
struct WriteBody {
  path: String,
  content: String,
}

/// Every mutating route carries the token the server handed to the page it
/// served. Anything that can reach the port can read, but a drive-by request
/// from another origin cannot read the token, so it cannot write.
fn authorised(headers: &HeaderMap, state: &Shared) -> bool {
  let presented = headers
    .get(header::AUTHORIZATION)
    .and_then(|value| value.to_str().ok())
    .and_then(|value| value.strip_prefix("Bearer "))
    .unwrap_or_default();

  !presented.is_empty() && presented == state.read().unwrap().token
}

/// Resolve a caller-supplied path and confirm it is an open document.
fn resolve_open_document(state: &Shared, raw: &str) -> Result<PathBuf, Response> {
  let path = PathBuf::from(raw)
    .canonicalize()
    .map_err(|_| (StatusCode::NOT_FOUND, "no such document").into_response())?;

  if !state.read().unwrap().is_open_document(&path) {
    return Err(
      (
        StatusCode::FORBIDDEN,
        "that file is not one of the served documents",
      )
        .into_response(),
    );
  }

  Ok(path)
}

fn documents_of(state: &Shared) -> Vec<DocumentMeta> {
  state
    .read()
    .unwrap()
    .documents
    .iter()
    .enumerate()
    .map(|(id, doc)| DocumentMeta {
      id,
      label: doc.label.clone(),
      path: doc.path.to_string_lossy().to_string(),
    })
    .collect()
}

async fn health() -> impl IntoResponse {
  Json(serde_json::json!({
    "app": "md-render",
    "version": env!("CARGO_PKG_VERSION"),
  }))
}

async fn list_files(State(state): State<Shared>) -> impl IntoResponse {
  Json(documents_of(&state))
}

async fn read_file(State(state): State<Shared>, Query(query): Query<IdQuery>) -> Response {
  let document = {
    let guard = state.read().unwrap();
    guard.documents.get(query.id).cloned()
  };

  let Some(document) = document else {
    return (StatusCode::NOT_FOUND, "no such document").into_response();
  };

  match std::fs::read_to_string(&document.path) {
    Ok(content) => Json(DocumentBody {
      id: query.id,
      label: document.label.clone(),
      path: document.path.to_string_lossy().to_string(),
      base_dir: document
        .path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default(),
      content,
    })
    .into_response(),
    Err(err) => (
      StatusCode::INTERNAL_SERVER_ERROR,
      format!("could not read document: {}", err),
    )
      .into_response(),
  }
}

/// Read an open document by path. The desktop app refreshes this way, so
/// server mode needs it too for the two to behave identically.
async fn read_by_path(State(state): State<Shared>, Query(query): Query<PathQuery>) -> Response {
  let path = match resolve_open_document(&state, &query.path) {
    Ok(path) => path,
    Err(response) => return response,
  };

  match std::fs::read_to_string(&path) {
    Ok(content) => Json(serde_json::json!({ "content": content })).into_response(),
    Err(err) => (
      StatusCode::INTERNAL_SERVER_ERROR,
      format!("could not read document: {}", err),
    )
      .into_response(),
  }
}

/// Save an open document back to disk.
async fn write_by_path(
  State(state): State<Shared>,
  headers: HeaderMap,
  Json(body): Json<WriteBody>,
) -> Response {
  if !authorised(&headers, &state) {
    return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
  }

  let path = match resolve_open_document(&state, &body.path) {
    Ok(path) => path,
    Err(response) => return response,
  };

  match std::fs::write(&path, body.content) {
    Ok(()) => Json(serde_json::json!({ "written": true })).into_response(),
    Err(err) => (
      StatusCode::INTERNAL_SERVER_ERROR,
      format!("could not write document: {}", err),
    )
      .into_response(),
  }
}

/// Write the comment-stripped copy beside an open document, mirroring the
/// desktop export command.
async fn export_by_path(
  State(state): State<Shared>,
  headers: HeaderMap,
  Json(body): Json<WriteBody>,
) -> Response {
  if !authorised(&headers, &state) {
    return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
  }

  let path = match resolve_open_document(&state, &body.path) {
    Ok(path) => path,
    Err(response) => return response,
  };

  let output = crate::export_path(&path.to_string_lossy());
  match std::fs::write(&output, body.content) {
    Ok(()) => {
      Json(serde_json::json!({ "path": output.to_string_lossy() })).into_response()
    }
    Err(err) => (
      StatusCode::INTERNAL_SERVER_ERROR,
      format!("could not export document: {}", err),
    )
      .into_response(),
  }
}

async fn read_asset(State(state): State<Shared>, Query(query): Query<PathQuery>) -> Response {
  // Canonicalise before checking: this resolves `..` and symlinks, so the
  // allowlist cannot be walked out of.
  let Ok(path) = PathBuf::from(&query.path).canonicalize() else {
    return (StatusCode::NOT_FOUND, "no such asset").into_response();
  };

  if !state.read().unwrap().allows_asset(&path) {
    return (StatusCode::FORBIDDEN, "asset outside the served directories").into_response();
  }

  match std::fs::read(&path) {
    Ok(bytes) => {
      let mime = mime_guess::from_path(&path).first_or_octet_stream();
      ([(header::CONTENT_TYPE, mime.to_string())], bytes).into_response()
    }
    Err(_) => (StatusCode::NOT_FOUND, "no such asset").into_response(),
  }
}

/// Add tabs to a running server. Guarded by the token from the state file, so
/// only processes running as the same user can widen what the server reads.
async fn add_documents(
  State(state): State<Shared>,
  headers: HeaderMap,
  Json(body): Json<AddDocuments>,
) -> Response {
  if !authorised(&headers, &state) {
    return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
  }

  let documents = match crate::cli::collect_documents(&body.paths) {
    Ok(documents) => documents,
    Err(err) => return (StatusCode::BAD_REQUEST, err.to_string()).into_response(),
  };

  let added = state.write().unwrap().add_documents(documents);
  let labels: Vec<String> = added.into_iter().map(|doc| doc.label).collect();

  Json(serde_json::json!({ "added": labels })).into_response()
}

/// Marker the frontend reads to know it is running against this server rather
/// than inside the desktop shell, plus the token it needs for saving. Injected
/// rather than probed so the very first render already knows which mode it is
/// in.
///
/// Handing the token to the page gives it exactly the trust already implied by
/// being able to reach the port. What it buys is that a page on another origin
/// cannot read the token, so it cannot forge a write.
pub fn inject_marker(html: &str, token: &str) -> String {
  let marker = format!(
    "<script>window.__MD_RENDER_SERVER__=true;window.__MD_RENDER_TOKEN__={}</script>",
    serde_json::to_string(token).unwrap_or_else(|_| "\"\"".to_string())
  );

  match html.find("</head>") {
    Some(index) => format!("{}{}{}", &html[..index], marker, &html[index..]),
    // No </head> to anchor to: prepending still runs before the app bundle.
    None => format!("{}{}", marker, html),
  }
}

/// Serve the built frontend out of the binary, falling back to `index.html` so
/// client-side routing works.
async fn static_handler(State(state): State<Shared>, uri: Uri) -> Response {
  let path = uri.path().trim_start_matches('/');
  let path = if path.is_empty() { "index.html" } else { path };

  let (asset, is_index) = match Assets::get(path) {
    Some(asset) => (Some(asset), path == "index.html"),
    None => (Assets::get("index.html"), true),
  };

  match asset {
    Some(file) => {
      if is_index {
        let token = state.read().unwrap().token.clone();
        let html = inject_marker(&String::from_utf8_lossy(&file.data), &token);
        return ([(header::CONTENT_TYPE, "text/html")], html).into_response();
      }
      let mime = mime_guess::from_path(path).first_or_octet_stream();
      ([(header::CONTENT_TYPE, mime.to_string())], file.data).into_response()
    }
    None => (
      StatusCode::NOT_FOUND,
      "frontend assets are missing from this build",
    )
      .into_response(),
  }
}

pub fn router(state: Shared) -> Router {
  Router::new()
    .route("/api/health", get(health))
    .route("/api/files", get(list_files))
    .route("/api/file", get(read_file).put(write_by_path))
    .route("/api/read", get(read_by_path))
    .route("/api/export", post(export_by_path))
    .route("/api/asset", get(read_asset))
    .route("/api/documents", post(add_documents))
    .fallback(static_handler)
    .with_state(state)
}

/// Run the server until Ctrl-C.
pub fn run(host: &str, port: u16, documents: Vec<Document>) -> Result<(), String> {
  let token = uuid::Uuid::new_v4().to_string();
  let shared: Shared = Arc::new(RwLock::new(ServerState::new(documents, token.clone())));

  let runtime = tokio::runtime::Builder::new_multi_thread()
    .enable_all()
    .build()
    .map_err(|err| format!("could not start async runtime: {}", err))?;

  runtime.block_on(async move {
    let address = format!("{}:{}", host, port);
    let listener = tokio::net::TcpListener::bind(&address)
      .await
      .map_err(|err| format!("could not bind {}: {}", address, err))?;

    if let Err(err) = state::write(&ServerRecord {
      port,
      token,
      pid: std::process::id(),
    }) {
      eprintln!("warning: could not record server state: {}", err);
    }

    print_banner(host, port, &shared);

    let result = axum::serve(listener, router(shared))
      .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
      })
      .await
      .map_err(|err| format!("server error: {}", err));

    state::remove(port);
    result
  })
}

fn print_banner(host: &str, port: u16, shared: &Shared) {
  let documents = documents_of(shared);
  println!(
    "serving {} file{} on http://{}:{}",
    documents.len(),
    if documents.len() == 1 { "" } else { "s" },
    host,
    port
  );
  for document in &documents {
    println!("  [{}] {}", document.id + 1, document.label);
  }
  if host != "127.0.0.1" && host != "localhost" {
    println!("warning: bound to {} — file contents are reachable from the network", host);
  }
  println!("(ctrl-c to stop)");
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("md-render-server-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
  }

  fn state_with(dir: &Path) -> ServerState {
    let doc = dir.join("a.md");
    fs::write(&doc, "# a").unwrap();
    ServerState::new(
      vec![Document {
        path: doc,
        label: "a.md".to_string(),
      }],
      "token".to_string(),
    )
  }

  #[test]
  fn marker_goes_into_the_head_before_the_app_bundle() {
    let html = "<html><head><title>MD</title></head><body><script src=\"/app.js\"></script></body></html>";
    let injected = inject_marker(html, "tok");

    assert!(injected.contains("__MD_RENDER_SERVER__"));
    assert!(injected.find("__MD_RENDER_SERVER__").unwrap() < injected.find("/app.js").unwrap());
    assert!(injected.find("__MD_RENDER_SERVER__").unwrap() < injected.find("</head>").unwrap());
  }

  #[test]
  fn marker_carries_the_token_the_page_needs_for_saving() {
    let injected = inject_marker("<html><head></head></html>", "s3cret");

    assert!(injected.contains("__MD_RENDER_TOKEN__"));
    assert!(injected.contains("\"s3cret\""));
  }

  #[test]
  fn marker_escapes_a_token_containing_quotes() {
    // Serialised as JSON so an awkward token cannot break out of the script.
    let injected = inject_marker("<html><head></head></html>", "a\"b");

    assert!(injected.contains("\"a\\\"b\""));
  }

  #[test]
  fn marker_still_injected_without_a_head_tag() {
    assert!(inject_marker("<div>bare</div>", "tok").contains("__MD_RENDER_SERVER__"));
  }

  #[test]
  fn allows_images_beside_the_document() {
    let dir = temp_dir("allow");
    let state = state_with(&dir);

    let image = dir.join("picture.png");
    fs::write(&image, [0u8; 4]).unwrap();

    assert!(state.allows_asset(&image));
  }

  #[test]
  fn refuses_files_outside_the_served_directories() {
    let dir = temp_dir("outside");
    let state = state_with(&dir);

    // The classic traversal target, and a plausible sibling.
    assert!(!state.allows_asset(Path::new("/etc/passwd")));
    assert!(!state.allows_asset(Path::new("/tmp/elsewhere/photo.png")));
  }

  #[test]
  fn refuses_non_image_extensions_even_inside_a_served_directory() {
    let dir = temp_dir("extension");
    let state = state_with(&dir);

    // Sitting next to the document is not enough; the app only needs images.
    let secret = dir.join("id_rsa");
    fs::write(&secret, "key").unwrap();
    assert!(!state.allows_asset(&secret));

    let markdown = dir.join("a.md");
    assert!(!state.allows_asset(&markdown));
  }

  /// Minimal HTTP/1.1 client so the integration test drives a real socket.
  async fn http(addr: std::net::SocketAddr, raw: String) -> (u16, String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream.write_all(raw.as_bytes()).await.unwrap();

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();

    let text = String::from_utf8_lossy(&response).to_string();
    let mut parts = text.splitn(2, "\r\n\r\n");
    let head = parts.next().unwrap_or_default();
    let body = parts.next().unwrap_or_default().to_string();
    let status = head
      .lines()
      .next()
      .and_then(|line| line.split_whitespace().nth(1))
      .and_then(|code| code.parse::<u16>().ok())
      .unwrap_or(0);
    (status, body)
  }

  fn get(addr: std::net::SocketAddr, path: &str) -> String {
    format!(
      "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
      path, addr
    )
  }

  #[test]
  fn serves_documents_and_refuses_anything_outside_them() {
    let dir = temp_dir("http");
    fs::write(dir.join("a.md"), "# hello from disk").unwrap();
    fs::write(dir.join("pic.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
    fs::write(dir.join("secret.key"), "private").unwrap();

    let outside = temp_dir("http-outside");
    let outside_image = outside.join("other.png");
    fs::write(&outside_image, [0u8; 4]).unwrap();

    let second = dir.join("b.md");
    fs::write(&second, "# second").unwrap();

    let shared: Shared = Arc::new(RwLock::new(ServerState::new(
      vec![Document {
        path: dir.join("a.md"),
        label: "a.md".to_string(),
      }],
      "test-token".to_string(),
    )));

    let runtime = tokio::runtime::Builder::new_multi_thread()
      .enable_all()
      .build()
      .unwrap();

    runtime.block_on(async move {
      let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
      let addr = listener.local_addr().unwrap();
      tokio::spawn(async move {
        let _ = axum::serve(listener, router(shared)).await;
      });

      // Identifies itself, which is how a second invocation finds this server.
      let (status, body) = http(addr, get(addr, "/api/health")).await;
      assert_eq!(status, 200);
      assert!(body.contains("md-render"));

      let (status, body) = http(addr, get(addr, "/api/files")).await;
      assert_eq!(status, 200);
      assert!(body.contains("a.md"));

      // Document content comes back by opaque id, never by caller-supplied path.
      let (status, body) = http(addr, get(addr, "/api/file?id=0")).await;
      assert_eq!(status, 200);
      assert!(body.contains("hello from disk"));

      let (status, _) = http(addr, get(addr, "/api/file?id=99")).await;
      assert_eq!(status, 404);

      // An image beside the document is fine.
      let allowed = format!("/api/asset?path={}", dir.join("pic.png").display());
      let (status, _) = http(addr, get(addr, &allowed)).await;
      assert_eq!(status, 200);

      // The classic traversal target, a non-image sibling, and an image in an
      // unrelated directory are all refused.
      for path in [
        "/etc/passwd".to_string(),
        dir.join("secret.key").display().to_string(),
        outside_image.display().to_string(),
      ] {
        let (status, _) = http(addr, get(addr, &format!("/api/asset?path={}", path))).await;
        assert!(
          status == 403 || status == 404,
          "expected {} to be refused, got {}",
          path,
          status
        );
      }

      // Adding a tab requires the token.
      let body = serde_json::json!({ "paths": [second.display().to_string()] }).to_string();
      let unauthorised = format!(
        "POST /api/documents HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        addr,
        body.len(),
        body
      );
      let (status, _) = http(addr, unauthorised).await;
      assert_eq!(status, 401);

      let authorised = format!(
        "POST /api/documents HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer test-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        addr,
        body.len(),
        body
      );
      let (status, response) = http(addr, authorised).await;
      assert_eq!(status, 200);
      assert!(response.contains("b.md"));

      // The new document shows up as a tab, which is what the browser polls for.
      let (_, files) = http(addr, get(addr, "/api/files")).await;
      assert!(files.contains("b.md"));
    });
  }

  #[test]
  fn saves_open_documents_and_refuses_everything_else() {
    let dir = temp_dir("write");
    let doc = dir.join("a.md");
    fs::write(&doc, "# before").unwrap();

    let outsider = dir.join("not-open.md");
    fs::write(&outsider, "# untouched").unwrap();

    let shared: Shared = Arc::new(RwLock::new(ServerState::new(
      vec![Document {
        path: doc.clone(),
        label: "a.md".to_string(),
      }],
      "write-token".to_string(),
    )));

    let runtime = tokio::runtime::Builder::new_multi_thread()
      .enable_all()
      .build()
      .unwrap();

    runtime.block_on(async move {
      let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
      let addr = listener.local_addr().unwrap();
      tokio::spawn(async move {
        let _ = axum::serve(listener, router(shared)).await;
      });

      let put = |path: &Path, content: &str, token: Option<&str>| {
        let body =
          serde_json::json!({ "path": path.display().to_string(), "content": content }).to_string();
        let auth = token
          .map(|t| format!("Authorization: Bearer {}\r\n", t))
          .unwrap_or_default();
        format!(
          "PUT /api/file HTTP/1.1\r\nHost: {}\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
          addr,
          auth,
          body.len(),
          body
        )
      };

      // No token: refused, and the file on disk is untouched.
      let (status, _) = http(addr, put(&doc, "# forged", None)).await;
      assert_eq!(status, 401);
      assert_eq!(fs::read_to_string(&doc).unwrap(), "# before");

      // Wrong token: same.
      let (status, _) = http(addr, put(&doc, "# forged", Some("nope"))).await;
      assert_eq!(status, 401);
      assert_eq!(fs::read_to_string(&doc).unwrap(), "# before");

      // With the token, the save lands.
      let (status, _) = http(addr, put(&doc, "# after", Some("write-token"))).await;
      assert_eq!(status, 200);
      assert_eq!(fs::read_to_string(&doc).unwrap(), "# after");

      // A file that is not an open document cannot be written even with the
      // token — being next to one is not enough.
      let (status, _) = http(addr, put(&outsider, "# hijacked", Some("write-token"))).await;
      assert_eq!(status, 403);
      assert_eq!(fs::read_to_string(&outsider).unwrap(), "# untouched");

      // Reading back by path works, mirroring how the desktop app refreshes.
      let (status, body) = http(
        addr,
        get(addr, &format!("/api/read?path={}", doc.display())),
      )
      .await;
      assert_eq!(status, 200);
      assert!(body.contains("# after"));

      // And reading a non-document by path is refused too.
      let (status, _) = http(
        addr,
        get(addr, &format!("/api/read?path={}", outsider.display())),
      )
      .await;
      assert_eq!(status, 403);

      // Export writes the clean copy beside the document.
      let export_body =
        serde_json::json!({ "path": doc.display().to_string(), "content": "# clean" }).to_string();
      let export = format!(
        "POST /api/export HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer write-token\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        addr,
        export_body.len(),
        export_body
      );
      let (status, response) = http(addr, export).await;
      assert_eq!(status, 200);
      assert!(response.contains("a.clean.md"));
      assert_eq!(fs::read_to_string(dir.join("a.clean.md")).unwrap(), "# clean");
    });
  }

  #[test]
  fn adding_a_document_widens_the_roots_and_skips_duplicates() {
    let dir = temp_dir("add");
    let mut state = state_with(&dir);

    let other_dir = temp_dir("add-other");
    let other = other_dir.join("b.md");
    fs::write(&other, "# b").unwrap();

    let added = state.add_documents(vec![Document {
      path: other.clone(),
      label: "b.md".to_string(),
    }]);
    assert_eq!(added.len(), 1);
    assert_eq!(state.documents.len(), 2);

    let image = other_dir.join("shot.png");
    fs::write(&image, [0u8; 4]).unwrap();
    assert!(state.allows_asset(&image));

    // Adding the same path again is a no-op.
    let repeat = state.add_documents(vec![Document {
      path: other,
      label: "b.md".to_string(),
    }]);
    assert!(repeat.is_empty());
    assert_eq!(state.documents.len(), 2);
  }
}
