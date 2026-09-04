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

use crate::cli::{Document, WorkspaceSpec};
use crate::state::{self, ServerRecord};

#[derive(RustEmbed)]
#[folder = "../dist"]
struct Assets;

/// Extensions `/api/asset` will serve. Anything else is refused, so the asset
/// route cannot be turned into a general file-read primitive.
const ASSET_EXTENSIONS: [&str; 9] = [
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico",
];

/// One open document plus the id the frontend addresses it by. Ids are handed
/// out once and never reused, so closing a tab never renumbers the others.
struct OpenDocument {
  id: u64,
  document: Document,
}

/// One URL namespace: `/<name>/` serves the SPA scoped to these documents.
struct Workspace {
  /// Unique URL segment, derived from the directory's name.
  name: String,
  /// Canonical directory this workspace represents.
  dir: PathBuf,
  /// The path arguments feeding this workspace, rescanned on refresh.
  sources: Vec<String>,
  documents: Vec<OpenDocument>,
  /// Paths the user closed. A rescan (refresh) leaves these closed; only an
  /// explicit re-add opens them again.
  closed: HashSet<PathBuf>,
}

pub struct ServerState {
  workspaces: Vec<Workspace>,
  next_id: u64,
  /// Directories under which `/api/asset` may read: the union of every open
  /// document's parent, recomputed when a document closes.
  roots: HashSet<PathBuf>,
  token: String,
}

impl ServerState {
  pub fn new(specs: Vec<WorkspaceSpec>, token: String) -> Self {
    let mut state = ServerState {
      workspaces: Vec::new(),
      next_id: 0,
      roots: HashSet::new(),
      token,
    };
    state.add_workspaces(specs, true);
    state
  }

  /// A URL segment not yet taken by another workspace, an API route, or a
  /// file bundled into the frontend. Collisions get a numeric suffix.
  fn unique_name(&self, hint: &str) -> String {
    let taken = |name: &str| {
      name == "api"
        || self.workspaces.iter().any(|ws| ws.name == name)
        || Assets::iter().any(|path| path.split('/').next().unwrap_or("") == name)
    };

    if !taken(hint) {
      return hint.to_string();
    }
    let mut n = 2;
    loop {
      let candidate = format!("{}-{}", hint, n);
      if !taken(&candidate) {
        return candidate;
      }
      n += 1;
    }
  }

  /// Merge workspace specs in: a spec whose canonical directory is already
  /// served joins that workspace, anything else becomes a new one. `explicit`
  /// marks paths the user named just now, which re-opens previously closed
  /// documents; a rescan leaves closed documents closed. Returns the
  /// documents actually added and the names of the workspaces touched.
  fn add_workspaces(
    &mut self,
    specs: Vec<WorkspaceSpec>,
    explicit: bool,
  ) -> (Vec<Document>, Vec<String>) {
    let mut added = Vec::new();
    let mut touched = Vec::new();

    for spec in specs {
      let index = match self.workspaces.iter().position(|ws| ws.dir == spec.dir) {
        Some(index) => index,
        None => {
          let name = self.unique_name(&spec.name_hint);
          self.workspaces.push(Workspace {
            name,
            dir: spec.dir.clone(),
            sources: Vec::new(),
            documents: Vec::new(),
            closed: HashSet::new(),
          });
          self.workspaces.len() - 1
        }
      };

      touched.push(self.workspaces[index].name.clone());
      for source in spec.sources {
        if !self.workspaces[index].sources.contains(&source) {
          self.workspaces[index].sources.push(source);
        }
      }

      for document in spec.documents {
        let workspace = &mut self.workspaces[index];
        if explicit {
          workspace.closed.remove(&document.path);
        } else if workspace.closed.contains(&document.path) {
          continue;
        }
        if workspace
          .documents
          .iter()
          .any(|d| d.document.path == document.path)
        {
          continue;
        }
        if let Some(parent) = document.path.parent() {
          self.roots.insert(parent.to_path_buf());
        }
        added.push(document.clone());
        workspace.documents.push(OpenDocument {
          id: self.next_id,
          document,
        });
        self.next_id += 1;
      }
    }

    (added, touched)
  }

  /// Close a tab wherever it lives. The path is tombstoned in its workspace
  /// so a refresh does not bring it back, and the asset roots shrink to what
  /// the remaining documents need — a directory shared with a still-open
  /// document stays served.
  fn remove_document(&mut self, id: u64) -> Option<Document> {
    let (ws_index, doc_index) = self.workspaces.iter().enumerate().find_map(|(w, ws)| {
      ws.documents
        .iter()
        .position(|d| d.id == id)
        .map(|i| (w, i))
    })?;

    let removed = self.workspaces[ws_index].documents.remove(doc_index);
    self.workspaces[ws_index]
      .closed
      .insert(removed.document.path.clone());
    self.recompute_roots();

    Some(removed.document)
  }

  /// Drop a whole workspace: its tabs, its tombstones and its URL. The name
  /// is free again afterwards, so opening the same directory later gets the
  /// plain name back rather than a `-2` suffix.
  fn remove_workspace(&mut self, name: &str) -> bool {
    let Some(index) = self.workspaces.iter().position(|ws| ws.name == name) else {
      return false;
    };
    self.workspaces.remove(index);
    self.recompute_roots();
    true
  }

  /// The asset roots are exactly the parents of the documents still open.
  fn recompute_roots(&mut self) {
    self.roots = self
      .workspaces
      .iter()
      .flat_map(|ws| ws.documents.iter())
      .filter_map(|d| d.document.path.parent().map(|p| p.to_path_buf()))
      .collect();
  }

  fn workspace(&self, name: &str) -> Option<&Workspace> {
    self.workspaces.iter().find(|ws| ws.name == name)
  }

  fn find_document(&self, id: u64) -> Option<Document> {
    self
      .workspaces
      .iter()
      .flat_map(|ws| ws.documents.iter())
      .find(|d| d.id == id)
      .map(|d| d.document.clone())
  }

  /// Whether `path` is one of the documents this server was asked to open.
  /// Reads and writes are limited to exactly these files — being inside a
  /// served directory is not enough.
  fn is_open_document(&self, path: &Path) -> bool {
    self
      .workspaces
      .iter()
      .any(|ws| ws.documents.iter().any(|doc| doc.document.path == path))
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
  id: u64,
  label: String,
  path: String,
  /// Name of the workspace the tab belongs to, so a caller listing every
  /// workspace at once can still build the tab's URL.
  workspace: String,
}

#[derive(Serialize)]
struct DocumentBody {
  id: u64,
  label: String,
  path: String,
  base_dir: String,
  content: String,
}

#[derive(Deserialize)]
struct IdQuery {
  id: u64,
  /// Workspace the caller is looking at, so responses that return the tab
  /// list stay scoped to that page.
  #[serde(default)]
  ws: Option<String>,
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

/// The tab list, scoped to one workspace when a name is given.
fn documents_of(state: &Shared, workspace: Option<&str>) -> Vec<DocumentMeta> {
  state
    .read()
    .unwrap()
    .workspaces
    .iter()
    .filter(|ws| workspace.map(|name| ws.name == name).unwrap_or(true))
    .flat_map(|ws| ws.documents.iter().map(move |doc| (ws.name.as_str(), doc)))
    .map(|(name, doc)| DocumentMeta {
      id: doc.id,
      label: doc.document.label.clone(),
      path: doc.document.path.to_string_lossy().to_string(),
      workspace: name.to_string(),
    })
    .collect()
}

/// Rescan the sources feeding one workspace (or all of them) for markdown
/// added since. The disk walk happens outside the write lock.
fn rescan(state: &Shared, workspace: Option<&str>) {
  let sources: Vec<String> = {
    let guard = state.read().unwrap();
    guard
      .workspaces
      .iter()
      .filter(|ws| workspace.map(|name| ws.name == name).unwrap_or(true))
      .flat_map(|ws| ws.sources.iter().cloned())
      .collect()
  };

  if sources.is_empty() {
    return;
  }
  if let Ok(specs) = crate::cli::group_workspaces(&sources) {
    state.write().unwrap().add_workspaces(specs, false);
  }
}

async fn health() -> impl IntoResponse {
  Json(serde_json::json!({
    "app": "md-render",
    "version": env!("CARGO_PKG_VERSION"),
  }))
}

#[derive(Deserialize)]
struct ListQuery {
  /// Set by the refresh control. Rescanning on every poll would walk the
  /// directory tree every few seconds for no reason.
  #[serde(default)]
  refresh: bool,
  /// Workspace the caller is looking at; absent means everything.
  #[serde(default)]
  ws: Option<String>,
}

async fn list_files(State(state): State<Shared>, Query(query): Query<ListQuery>) -> impl IntoResponse {
  if query.refresh {
    // A rescan, not an explicit ask: closed tabs stay closed.
    rescan(&state, query.ws.as_deref());
  }

  Json(documents_of(&state, query.ws.as_deref()))
}

async fn read_file(State(state): State<Shared>, Query(query): Query<IdQuery>) -> Response {
  let document = state.read().unwrap().find_document(query.id);

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

  let specs = match crate::cli::group_workspaces(&body.paths) {
    Ok(specs) => specs,
    Err(err) => return (StatusCode::BAD_REQUEST, err.to_string()).into_response(),
  };

  let (added, workspaces) = state.write().unwrap().add_workspaces(specs, true);
  let labels: Vec<String> = added.into_iter().map(|doc| doc.label).collect();

  Json(serde_json::json!({ "added": labels, "workspaces": workspaces })).into_response()
}

/// The workspace list as the API reports it: name, directory, tab count.
fn workspaces_of(state: &Shared) -> Vec<serde_json::Value> {
  state
    .read()
    .unwrap()
    .workspaces
    .iter()
    .map(|ws| {
      serde_json::json!({
        "name": ws.name,
        "dir": ws.dir.to_string_lossy(),
        "documents": ws.documents.len(),
      })
    })
    .collect()
}

/// The workspaces this server hosts — what the root listing shows, and what
/// tooling can use to find its URL.
async fn list_workspaces(State(state): State<Shared>) -> impl IntoResponse {
  Json(workspaces_of(&state))
}

#[derive(Deserialize)]
struct NameQuery {
  name: String,
}

/// Close a workspace and every tab in it. Token-guarded like the other
/// mutations; the remaining workspaces come back so the caller need not
/// re-fetch.
async fn remove_workspace(
  State(state): State<Shared>,
  headers: HeaderMap,
  Query(query): Query<NameQuery>,
) -> Response {
  if !authorised(&headers, &state) {
    return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
  }

  if !state.write().unwrap().remove_workspace(&query.name) {
    return (StatusCode::NOT_FOUND, "no such workspace").into_response();
  }

  Json(workspaces_of(&state)).into_response()
}

/// Close a tab. Token-guarded like every other mutation; the updated tab list
/// comes back so the caller need not re-fetch, and the next poll from any
/// other browser window converges on the same list.
async fn remove_document(
  State(state): State<Shared>,
  headers: HeaderMap,
  Query(query): Query<IdQuery>,
) -> Response {
  if !authorised(&headers, &state) {
    return (StatusCode::UNAUTHORIZED, "invalid token").into_response();
  }

  if state.write().unwrap().remove_document(query.id).is_none() {
    return (StatusCode::NOT_FOUND, "no such document").into_response();
  }

  Json(documents_of(&state, query.ws.as_deref())).into_response()
}

/// Marker the frontend reads to know it is running against this server rather
/// than inside the desktop shell, plus the token it needs for saving. Injected
/// rather than probed so the very first render already knows which mode it is
/// in.
///
/// Handing the token to the page gives it exactly the trust already implied by
/// being able to reach the port. What it buys is that a page on another origin
/// cannot read the token, so it cannot forge a write.
pub fn inject_marker(html: &str, token: &str, workspace: &str) -> String {
  let marker = format!(
    "<script>window.__MD_RENDER_SERVER__=true;window.__MD_RENDER_TOKEN__={};window.__MD_RENDER_WORKSPACE__={}</script>",
    serde_json::to_string(token).unwrap_or_else(|_| "\"\"".to_string()),
    serde_json::to_string(workspace).unwrap_or_else(|_| "\"\"".to_string())
  );

  match html.find("</head>") {
    Some(index) => format!("{}{}{}", &html[..index], marker, &html[index..]),
    // No </head> to anchor to: prepending still runs before the app bundle.
    None => format!("{}{}", marker, html),
  }
}

/// The root: one workspace redirects straight to it; several list themselves.
fn root_page(state: &Shared) -> Response {
  let guard = state.read().unwrap();
  match guard.workspaces.len() {
    0 => (StatusCode::NOT_FOUND, "nothing is being served").into_response(),
    1 => {
      let location = format!("/{}/", guard.workspaces[0].name);
      (StatusCode::FOUND, [(header::LOCATION, location)]).into_response()
    }
    _ => {
      // Workspace names are restricted to [A-Za-z0-9._-], so plain
      // interpolation cannot break out of the markup.
      let items: String = guard
        .workspaces
        .iter()
        .map(|ws| {
          format!(
            "<li><a href=\"/{name}/\">{name}/</a> — {n} file{s}</li>",
            name = ws.name,
            n = ws.documents.len(),
            s = if ws.documents.len() == 1 { "" } else { "s" }
          )
        })
        .collect();
      let html = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>md-render</title>\
         <h1>md-render</h1><ul>{}</ul>",
        items
      );
      ([(header::CONTENT_TYPE, "text/html")], html).into_response()
    }
  }
}

/// Serve the built frontend out of the binary. `/<workspace>/…` serves the
/// SPA scoped to that workspace; exact bundled files (the JS/CSS under
/// `/assets/`, icons) are served as themselves; the root redirects or lists.
async fn static_handler(State(state): State<Shared>, uri: Uri) -> Response {
  let path = uri.path().trim_start_matches('/');

  if path.is_empty() || path == "index.html" {
    return root_page(&state);
  }

  if let Some(file) = Assets::get(path) {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    return ([(header::CONTENT_TYPE, mime.to_string())], file.data).into_response();
  }

  let first = path.split('/').next().unwrap_or("");
  let known = state.read().unwrap().workspace(first).is_some();
  if known {
    let Some(file) = Assets::get("index.html") else {
      return (
        StatusCode::NOT_FOUND,
        "frontend assets are missing from this build",
      )
        .into_response();
    };
    let token = state.read().unwrap().token.clone();
    let html = inject_marker(&String::from_utf8_lossy(&file.data), &token, first);
    return ([(header::CONTENT_TYPE, "text/html")], html).into_response();
  }

  let names: Vec<String> = state
    .read()
    .unwrap()
    .workspaces
    .iter()
    .map(|ws| format!("/{}/", ws.name))
    .collect();
  (
    StatusCode::NOT_FOUND,
    format!("no such workspace; open one of: {}", names.join(" ")),
  )
    .into_response()
}

pub fn router(state: Shared) -> Router {
  Router::new()
    .route("/api/health", get(health))
    .route("/api/files", get(list_files))
    .route(
      "/api/file",
      get(read_file).put(write_by_path).delete(remove_document),
    )
    .route("/api/read", get(read_by_path))
    .route("/api/export", post(export_by_path))
    .route("/api/asset", get(read_asset))
    .route("/api/documents", post(add_documents))
    .route(
      "/api/workspaces",
      get(list_workspaces).delete(remove_workspace),
    )
    .fallback(static_handler)
    .with_state(state)
}

/// Run the server until Ctrl-C.
pub fn run(host: &str, port: u16, specs: Vec<WorkspaceSpec>) -> Result<(), String> {
  let token = uuid::Uuid::new_v4().to_string();
  let shared: Shared = Arc::new(RwLock::new(ServerState::new(specs, token.clone())));

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
  let guard = shared.read().unwrap();
  let total: usize = guard.workspaces.iter().map(|ws| ws.documents.len()).sum();
  println!(
    "serving {} file{} on http://{}:{}",
    total,
    if total == 1 { "" } else { "s" },
    host,
    port
  );
  for workspace in &guard.workspaces {
    println!("  http://{}:{}/{}/", host, port, workspace.name);
    for document in &workspace.documents {
      println!("    {}", document.document.label);
    }
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

  fn specs_for(paths: &[PathBuf]) -> Vec<WorkspaceSpec> {
    let raw: Vec<String> = paths
      .iter()
      .map(|p| p.to_string_lossy().to_string())
      .collect();
    crate::cli::group_workspaces(&raw).unwrap()
  }

  fn all_ids(state: &ServerState) -> Vec<u64> {
    state
      .workspaces
      .iter()
      .flat_map(|ws| ws.documents.iter().map(|d| d.id))
      .collect()
  }

  fn state_with(dir: &Path) -> ServerState {
    let doc = dir.join("a.md");
    fs::write(&doc, "# a").unwrap();
    ServerState::new(specs_for(&[doc]), "token".to_string())
  }

  #[test]
  fn marker_goes_into_the_head_before_the_app_bundle() {
    let html = "<html><head><title>MD</title></head><body><script src=\"/app.js\"></script></body></html>";
    let injected = inject_marker(html, "tok", "notes");

    assert!(injected.contains("__MD_RENDER_SERVER__"));
    assert!(injected.find("__MD_RENDER_SERVER__").unwrap() < injected.find("/app.js").unwrap());
    assert!(injected.find("__MD_RENDER_SERVER__").unwrap() < injected.find("</head>").unwrap());
  }

  #[test]
  fn marker_carries_the_token_the_page_needs_for_saving() {
    let injected = inject_marker("<html><head></head></html>", "s3cret", "notes");

    assert!(injected.contains("__MD_RENDER_TOKEN__"));
    assert!(injected.contains("\"s3cret\""));
  }

  #[test]
  fn marker_carries_the_workspace_the_page_is_scoped_to() {
    let injected = inject_marker("<html><head></head></html>", "tok", "notes");

    assert!(injected.contains("__MD_RENDER_WORKSPACE__"));
    assert!(injected.contains("\"notes\""));
  }

  #[test]
  fn marker_escapes_a_token_containing_quotes() {
    // Serialised as JSON so an awkward token cannot break out of the script.
    let injected = inject_marker("<html><head></head></html>", "a\"b", "notes");

    assert!(injected.contains("\"a\\\"b\""));
  }

  #[test]
  fn marker_still_injected_without_a_head_tag() {
    assert!(inject_marker("<div>bare</div>", "tok", "ws").contains("__MD_RENDER_SERVER__"));
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

  /// A request carrying a bearer token and an optional JSON body — the shape
  /// of every mutating call the page or a tool makes.
  fn with_token(
    addr: std::net::SocketAddr,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<&str>,
  ) -> String {
    let auth = token
      .map(|t| format!("Authorization: Bearer {}\r\n", t))
      .unwrap_or_default();
    let body = body.unwrap_or("");
    format!(
      "{} {} HTTP/1.1\r\nHost: {}\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
      method,
      path,
      addr,
      auth,
      body.len(),
      body
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
      specs_for(&[dir.join("a.md")]),
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
  fn refreshing_picks_up_markdown_added_to_a_served_directory() {
    let dir = temp_dir("refresh");
    fs::write(dir.join("first.md"), "# first").unwrap();

    let sources = vec![dir.to_string_lossy().to_string()];
    let shared: Shared = Arc::new(RwLock::new(ServerState::new(
      crate::cli::group_workspaces(&sources).unwrap(),
      "refresh-token".to_string(),
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

      let (_, before) = http(addr, get(addr, "/api/files")).await;
      assert!(before.contains("first.md"));
      assert!(!before.contains("second.md"));

      // Something drops a new document into the directory after launch.
      fs::write(dir.join("second.md"), "# second").unwrap();

      // A plain list does not rescan, so the poll stays cheap.
      let (_, unrefreshed) = http(addr, get(addr, "/api/files")).await;
      assert!(!unrefreshed.contains("second.md"));

      // Asking for a refresh finds it.
      let (status, refreshed) = http(addr, get(addr, "/api/files?refresh=true")).await;
      assert_eq!(status, 200);
      assert!(refreshed.contains("second.md"));
      assert!(refreshed.contains("first.md"));
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
      specs_for(&[doc.clone()]),
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

    let (added, touched) = state.add_workspaces(specs_for(&[other.clone()]), true);
    assert_eq!(added.len(), 1);
    assert_eq!(touched.len(), 1);
    assert_eq!(state.workspaces.len(), 2);

    let image = other_dir.join("shot.png");
    fs::write(&image, [0u8; 4]).unwrap();
    assert!(state.allows_asset(&image));

    // Adding the same path again is a no-op for documents.
    let (repeat, _) = state.add_workspaces(specs_for(&[other]), true);
    assert!(repeat.is_empty());
    assert_eq!(all_ids(&state).len(), 2);
  }

  #[test]
  fn removing_a_document_keeps_the_other_ids_stable() {
    let dir = temp_dir("remove-ids");
    for name in ["a.md", "b.md", "c.md"] {
      fs::write(dir.join(name), "# doc").unwrap();
    }
    let mut state = ServerState::new(specs_for(&[dir]), "token".to_string());

    assert_eq!(all_ids(&state), vec![0, 1, 2]);

    assert!(state.remove_document(1).is_some());

    // No renumbering: the frontend's active id and ?doc= URL stay valid.
    assert_eq!(all_ids(&state), vec![0, 2]);
    assert!(state.remove_document(1).is_none());
  }

  #[test]
  fn removing_a_document_closes_writes_but_keeps_a_shared_root_served() {
    let dir = temp_dir("remove-roots");
    let a = dir.join("a.md");
    let b = dir.join("b.md");
    fs::write(&a, "# a").unwrap();
    fs::write(&b, "# b").unwrap();

    let lone_dir = temp_dir("remove-roots-lone");
    let lone = lone_dir.join("c.md");
    fs::write(&lone, "# c").unwrap();

    let image = dir.join("pic.png");
    let lone_image = lone_dir.join("pic.png");
    fs::write(&image, [0u8; 4]).unwrap();
    fs::write(&lone_image, [0u8; 4]).unwrap();

    let mut state = ServerState::new(
      specs_for(&[a.clone(), b.clone(), lone.clone()]),
      "token".to_string(),
    );
    assert!(state.allows_asset(&lone_image));

    // Closing a.md: its file is no longer writable, but b.md still lives in
    // the same directory, so images beside it stay served.
    assert!(state.remove_document(0).is_some());
    assert!(!state.is_open_document(&a));
    assert!(state.is_open_document(&b));
    assert!(state.allows_asset(&image));

    // Closing c.md: nothing else lives in its directory, so the asset root
    // goes away with it.
    assert!(state.remove_document(2).is_some());
    assert!(!state.allows_asset(&lone_image));
    assert!(state.allows_asset(&image));
  }

  #[test]
  fn a_rescan_does_not_resurrect_a_closed_document_but_an_explicit_add_does() {
    let dir = temp_dir("remove-rescan");
    let closed_path = dir.join("a.md");
    fs::write(&closed_path, "# a").unwrap();
    fs::write(dir.join("b.md"), "# b").unwrap();

    let mut state = ServerState::new(specs_for(&[dir.clone()]), "token".to_string());

    // a.md sorts first, so it holds id 0.
    assert!(state.remove_document(0).is_some());

    // The refresh path finds the same files on disk again.
    let (added, _) = state.add_workspaces(specs_for(&[dir]), false);
    assert!(added.is_empty());
    assert_eq!(all_ids(&state), vec![1]);

    // Naming the file again (a new `mdrender --port a.md`) re-opens it under
    // a fresh id — never a recycled one — in the same workspace.
    let (reopened, _) = state.add_workspaces(specs_for(&[closed_path]), true);
    assert_eq!(reopened.len(), 1);
    assert_eq!(state.workspaces.len(), 1);
    assert_eq!(all_ids(&state), vec![1, 2]);
  }

  #[test]
  fn file_list_names_the_workspace_of_each_document() {
    let base = temp_dir("ws-name");
    let notes = base.join("notes");
    let docs = base.join("docs");
    fs::create_dir_all(&notes).unwrap();
    fs::create_dir_all(&docs).unwrap();
    fs::write(notes.join("a.md"), "# a").unwrap();
    fs::write(docs.join("b.md"), "# b").unwrap();

    let shared: Shared = Arc::new(RwLock::new(ServerState::new(
      specs_for(&[notes, docs]),
      "token".to_string(),
    )));

    // Listing everything still says where each tab lives, so a caller can
    // build its URL without a request per workspace.
    let all = documents_of(&shared, None);
    let names: Vec<(&str, &str)> = all
      .iter()
      .map(|doc| (doc.label.as_str(), doc.workspace.as_str()))
      .collect();
    assert_eq!(names, vec![("a.md", "notes"), ("b.md", "docs")]);

    // Scoping to one workspace keeps the field on the entries that remain.
    let scoped = documents_of(&shared, Some("docs"));
    assert_eq!(scoped.len(), 1);
    assert_eq!(scoped[0].workspace, "docs");
  }

  #[test]
  fn removing_a_workspace_frees_its_name_and_its_asset_roots() {
    let base = temp_dir("remove-ws");
    let notes = base.join("notes");
    let docs = base.join("docs");
    fs::create_dir_all(&notes).unwrap();
    fs::create_dir_all(&docs).unwrap();
    fs::write(notes.join("a.md"), "# a").unwrap();
    fs::write(docs.join("b.md"), "# b").unwrap();
    let notes_image = notes.join("pic.png");
    fs::write(&notes_image, [0u8; 4]).unwrap();

    let mut state = ServerState::new(specs_for(&[notes.clone(), docs]), "token".to_string());
    assert!(state.allows_asset(&notes_image));

    assert!(state.remove_workspace("notes"));

    // The workspace, its tabs and its asset root are gone; the other one is
    // untouched and keeps its id.
    assert!(state.workspace("notes").is_none());
    assert!(!state.allows_asset(&notes_image));
    assert_eq!(all_ids(&state), vec![1]);

    // Opening the same directory again gets the plain name back, not notes-2.
    let (added, touched) = state.add_workspaces(specs_for(&[notes]), true);
    assert_eq!(added.len(), 1);
    assert_eq!(touched, vec!["notes".to_string()]);
    // Under a fresh id: ids are never recycled, even across a workspace close.
    assert_eq!(all_ids(&state), vec![1, 2]);
  }

  #[test]
  fn removing_an_unknown_workspace_is_a_no_op() {
    let dir = temp_dir("remove-ws-unknown");
    let mut state = state_with(&dir);

    assert!(!state.remove_workspace("nowhere"));
    assert_eq!(state.workspaces.len(), 1);
    assert_eq!(all_ids(&state), vec![0]);
  }

  #[test]
  fn a_workspace_can_be_closed_over_http_and_its_page_turns_404() {
    let base = temp_dir("remove-ws-http");
    let notes = base.join("notes");
    let docs = base.join("docs");
    fs::create_dir_all(&notes).unwrap();
    fs::create_dir_all(&docs).unwrap();
    fs::write(notes.join("a.md"), "# a").unwrap();
    fs::write(docs.join("b.md"), "# b").unwrap();

    let shared: Shared = Arc::new(RwLock::new(ServerState::new(
      specs_for(&[notes, docs]),
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

      // Closing needs the token, like every other mutation.
      let (status, _) = http(addr, with_token(addr, "DELETE", "/api/workspaces?name=notes", None, None)).await;
      assert_eq!(status, 401);
      let (status, _) = http(addr, get(addr, "/notes/")).await;
      assert_eq!(status, 200);

      let (status, _) = http(addr, with_token(addr, "DELETE", "/api/workspaces?name=nowhere", Some("test-token"), None)).await;
      assert_eq!(status, 404);

      let (status, body) = http(addr, with_token(addr, "DELETE", "/api/workspaces?name=notes", Some("test-token"), None)).await;
      assert_eq!(status, 200);
      // The remaining list comes back, so the caller need not re-fetch.
      assert!(body.contains("\"docs\""));
      assert!(!body.contains("\"notes\""));

      // Its page and its tabs are gone; the other workspace still serves.
      let (status, _) = http(addr, get(addr, "/notes/")).await;
      assert_eq!(status, 404);
      let (_, files) = http(addr, get(addr, "/api/files")).await;
      assert!(!files.contains("a.md"));
      assert!(files.contains("b.md"));
    });
  }

  #[test]
  fn workspace_names_dedupe_against_reserved_and_existing_names() {
    let api_a = temp_dir("reserved-a").join("api");
    let api_b = temp_dir("reserved-b").join("api");
    for dir in [&api_a, &api_b] {
      fs::create_dir_all(dir).unwrap();
      fs::write(dir.join("x.md"), "# x").unwrap();
    }

    let state = ServerState::new(specs_for(&[api_a, api_b]), "token".to_string());

    let names: Vec<&str> = state.workspaces.iter().map(|ws| ws.name.as_str()).collect();
    // Neither may shadow the API prefix, and they may not shadow each other.
    assert_eq!(names.len(), 2);
    assert!(!names.contains(&"api"));
    assert!(names[0].starts_with("api-"));
    assert_ne!(names[0], names[1]);
  }

  #[test]
  fn workspaces_get_their_own_urls_and_scoped_tab_lists() {
    let dir_a = temp_dir("ws-http-a");
    let dir_b = temp_dir("ws-http-b");
    fs::write(dir_a.join("a.md"), "# a").unwrap();
    fs::write(dir_b.join("b.md"), "# b").unwrap();

    let shared: Shared = Arc::new(RwLock::new(ServerState::new(
      specs_for(&[dir_a, dir_b]),
      "ws-token".to_string(),
    )));
    let name_a = shared.read().unwrap().workspaces[0].name.clone();
    let name_b = shared.read().unwrap().workspaces[1].name.clone();

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

      // Each workspace page carries its own scoped marker.
      let (status, body) = http(addr, get(addr, &format!("/{}/", name_a))).await;
      assert_eq!(status, 200);
      assert!(body.contains("__MD_RENDER_WORKSPACE__"));
      assert!(body.contains(&format!("\"{}\"", name_a)));

      // The tab list scopes to the workspace the page asks for.
      let (_, files_a) = http(addr, get(addr, &format!("/api/files?ws={}", name_a))).await;
      assert!(files_a.contains("a.md"));
      assert!(!files_a.contains("b.md"));

      // No workspace parameter lists everything.
      let (_, all) = http(addr, get(addr, "/api/files")).await;
      assert!(all.contains("a.md") && all.contains("b.md"));

      // The root lists both workspaces when there are several.
      let (status, listing) = http(addr, get(addr, "/")).await;
      assert_eq!(status, 200);
      assert!(listing.contains(&format!("/{}/", name_a)));
      assert!(listing.contains(&format!("/{}/", name_b)));

      // /api/workspaces names them for tooling.
      let (_, workspaces) = http(addr, get(addr, "/api/workspaces")).await;
      assert!(workspaces.contains(&name_a) && workspaces.contains(&name_b));

      // An unknown prefix is a 404, not a silent SPA page.
      let (status, _) = http(addr, get(addr, "/definitely-not/")).await;
      assert_eq!(status, 404);
    });
  }

  #[test]
  fn the_root_redirects_when_only_one_workspace_is_served() {
    let dir = temp_dir("ws-redirect");
    fs::write(dir.join("a.md"), "# a").unwrap();

    let shared: Shared = Arc::new(RwLock::new(ServerState::new(
      specs_for(&[dir]),
      "token".to_string(),
    )));
    let name = shared.read().unwrap().workspaces[0].name.clone();

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

      let (status, _) = http(addr, get(addr, "/")).await;
      assert_eq!(status, 302);

      // Following the redirect lands on the workspace page.
      let (status, body) = http(addr, get(addr, &format!("/{}/", name))).await;
      assert_eq!(status, 200);
      assert!(body.contains("__MD_RENDER_WORKSPACE__"));
    });
  }
}
