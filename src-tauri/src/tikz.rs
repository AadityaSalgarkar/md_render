//! TikZ diagrams: a ```tikz block compiled to SVG.
//!
//! Tectonic (an embeddable LaTeX engine) compiles a standalone document to
//! PDF, and hayro-svg turns its page into SVG. Compiling never happens in the
//! server or window process: TeX is a programming language, so a diagram can
//! loop forever, and Tectonic's engine is not safe to reuse after a failed
//! run. Each compile runs in a child of this same binary (`--render-tikz`)
//! that is killed after a timeout. Results are cached on disk by a hash of
//! the document, so a diagram compiles once and every later load reads it.
//!
//! The first compile on a machine downloads the TeX files Tectonic needs
//! into its own cache; `--warm-tikz` does that ahead of time.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Bumped whenever the document template or SVG post-processing changes,
/// so cached diagrams from an older version are not reused.
const RENDER_VERSION: &str = "1";
/// CPU seconds a compile may use. CPU time, not wall time: Tectonic
/// downloads TeX files on first use, which waits on the network rather than
/// burning CPU, while a TeX loop that never ends burns CPU the whole time.
const DEFAULT_TIMEOUT_SECS: u64 = 20;
/// Wall-clock ceiling, for a download that hangs.
const WALL_LIMIT: Duration = Duration::from_secs(600);
/// Lines of TeX log shown for an error.
const MAX_ERROR_LINES: usize = 20;
/// Longest diagram source accepted.
pub const MAX_SOURCE_BYTES: usize = 200_000;

/// A block split into its header settings and its body.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Diagram {
  pub packages: Vec<String>,
  pub libraries: Vec<String>,
  pub preamble: Vec<String>,
  pub body: String,
  /// The body is a whole `\documentclass ... \end{document}` file.
  pub full_document: bool,
}

/// Parse header lines (`%! packages: pgfplots, tikz-cd`, `%! libraries:`,
/// `%! preamble:`) and keep the rest as the body. Header lines are TeX
/// comments, so the block stays valid LaTeX. `%! caption:` belongs to the
/// page, not the document, and is skipped here.
pub fn parse(source: &str) -> Diagram {
  let mut diagram = Diagram::default();
  let mut body = Vec::new();
  for line in source.lines() {
    let trimmed = line.trim_start();
    let Some(header) = trimmed.strip_prefix("%!") else {
      body.push(line);
      continue;
    };
    let Some((name, value)) = header.split_once(':') else {
      body.push(line);
      continue;
    };
    let list = || {
      value
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect::<Vec<_>>()
    };
    match name.trim().to_ascii_lowercase().as_str() {
      "packages" | "package" => diagram.packages.extend(list()),
      "libraries" | "library" => diagram.libraries.extend(list()),
      "preamble" => diagram.preamble.push(value.trim().to_string()),
      "caption" => {}
      _ => body.push(line),
    }
  }
  diagram.body = body.join("\n").trim().to_string();
  diagram.full_document = diagram.body.contains("\\documentclass");
  diagram
}

/// The standalone LaTeX document for a diagram.
pub fn document(diagram: &Diagram) -> String {
  if diagram.full_document {
    return format!("{}\n", diagram.body);
  }
  let mut out = String::from("\\documentclass[tikz,border=2pt]{standalone}\n");
  for package in &diagram.packages {
    // "pgfplots" or "[options]{name}" style, both accepted.
    if package.starts_with('[') {
      out.push_str(&format!("\\usepackage{}\n", package));
    } else {
      out.push_str(&format!("\\usepackage{{{}}}\n", package));
    }
  }
  if diagram.packages.iter().any(|p| p == "pgfplots") && !diagram.preamble.iter().any(|p| p.contains("compat")) {
    out.push_str("\\pgfplotsset{compat=1.18}\n");
  }
  if !diagram.libraries.is_empty() {
    out.push_str(&format!("\\usetikzlibrary{{{}}}\n", diagram.libraries.join(",")));
  }
  for line in &diagram.preamble {
    out.push_str(line);
    out.push('\n');
  }
  out.push_str("\\begin{document}\n");
  out.push_str(&diagram.body);
  out.push_str("\n\\end{document}\n");
  out
}

/// Cache key: what the output depends on, hashed.
pub fn cache_key(document: &str) -> String {
  let mut hasher = Sha256::new();
  hasher.update(b"tectonic-0.17+hayro-svg-0.8;v");
  hasher.update(RENDER_VERSION.as_bytes());
  hasher.update(b";");
  hasher.update(document.as_bytes());
  let digest = hasher.finalize();
  digest.iter().take(16).map(|b| format!("{:02x}", b)).collect()
}

/// Where rendered SVGs live: `$MDRENDER_TIKZ_CACHE`, else the user cache
/// directory under `md-render/tikz`.
pub fn cache_dir() -> PathBuf {
  if let Some(dir) = std::env::var_os("MDRENDER_TIKZ_CACHE").filter(|v| !v.is_empty()) {
    return PathBuf::from(dir);
  }
  dirs::cache_dir()
    .unwrap_or_else(std::env::temp_dir)
    .join("md-render")
    .join("tikz")
}

/// Whether a key has the shape [`cache_key`] makes, so it is safe in a path.
pub fn valid_key(key: &str) -> bool {
  key.len() == 32 && key.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A cached SVG, if this key has been rendered.
pub fn cached_svg(key: &str) -> Option<String> {
  if !valid_key(key) {
    return None;
  }
  std::fs::read_to_string(cache_dir().join(format!("{}.svg", key))).ok()
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
  pub key: String,
  pub svg: String,
  /// Served from the cache without compiling.
  pub cached: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct TikzError {
  /// "tex" (the document has an error), "timeout", "too_large", "engine"
  /// (the compiler could not run) or "io".
  pub error: &'static str,
  pub message: String,
  /// The relevant TeX log lines, for "tex" errors.
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub log: Vec<String>,
}

impl TikzError {
  fn new(error: &'static str, message: impl Into<String>) -> Self {
    TikzError {
      error,
      message: message.into(),
      log: Vec::new(),
    }
  }

  /// HTTP status in server mode.
  pub fn status(&self) -> u16 {
    match self.error {
      "tex" => 422,
      "too_large" => 413,
      "timeout" => 504,
      _ => 500,
    }
  }
}

impl std::fmt::Display for TikzError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "{}", self.message)
  }
}

/// Errors are remembered for the life of the process only, so a fixed
/// source recompiles while a broken one is not compiled again and again.
fn error_cache() -> &'static Mutex<HashMap<String, TikzError>> {
  static CACHE: OnceLock<Mutex<HashMap<String, TikzError>>> = OnceLock::new();
  CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// At most this many compiles at once; the rest wait their turn.
struct Slots {
  free: Mutex<usize>,
  turn: Condvar,
}

fn slots() -> &'static Slots {
  static SLOTS: OnceLock<Slots> = OnceLock::new();
  SLOTS.get_or_init(|| {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    Slots {
      free: Mutex::new((cores / 2).max(1)),
      turn: Condvar::new(),
    }
  })
}

struct Slot;

impl Slot {
  fn take() -> Slot {
    let slots = slots();
    let mut free = slots.free.lock().unwrap();
    while *free == 0 {
      free = slots.turn.wait(free).unwrap();
    }
    *free -= 1;
    Slot
  }
}

impl Drop for Slot {
  fn drop(&mut self) {
    let slots = slots();
    *slots.free.lock().unwrap() += 1;
    slots.turn.notify_one();
  }
}

fn timeout() -> Duration {
  let secs = std::env::var("MDRENDER_TIKZ_TIMEOUT")
    .ok()
    .and_then(|v| v.parse::<u64>().ok())
    .filter(|v| *v > 0)
    .unwrap_or(DEFAULT_TIMEOUT_SECS);
  Duration::from_secs(secs)
}

/// The executable that compiles: this binary, or `$MDRENDER_TIKZ_HELPER`
/// (the test suites point it at the built binary, since a test harness is
/// not md-render).
fn helper() -> Result<PathBuf, TikzError> {
  if let Some(path) = std::env::var_os("MDRENDER_TIKZ_HELPER").filter(|v| !v.is_empty()) {
    return Ok(PathBuf::from(path));
  }
  std::env::current_exe().map_err(|e| TikzError::new("engine", format!("cannot find the md-render binary: {}", e)))
}

/// Render a block's source to SVG: from the cache when possible, otherwise
/// by compiling in a child process.
pub fn render(source: &str) -> Result<Rendered, TikzError> {
  if source.len() > MAX_SOURCE_BYTES {
    return Err(TikzError::new("too_large", "the diagram is larger than 200 KB"));
  }
  let document = document(&parse(source));
  let key = cache_key(&document);
  if let Some(svg) = cached_svg(&key) {
    return Ok(Rendered { key, svg, cached: true });
  }
  if let Some(err) = error_cache().lock().unwrap().get(&key) {
    return Err(err.clone());
  }

  let result = compile_in_child(&document, &key);
  match result {
    Ok(svg) => {
      let dir = cache_dir();
      let _ = std::fs::create_dir_all(&dir);
      // Write then rename, so a reader never sees half a file.
      let tmp = dir.join(format!("{}.svg.{}", key, std::process::id()));
      if std::fs::write(&tmp, &svg).is_ok() {
        let _ = std::fs::rename(&tmp, dir.join(format!("{}.svg", key)));
      }
      Ok(Rendered { key, svg, cached: false })
    }
    Err(err) => {
      if err.error == "tex" {
        error_cache().lock().unwrap().insert(key, err.clone());
      }
      Err(err)
    }
  }
}

fn compile_in_child(document: &str, key: &str) -> Result<String, TikzError> {
  let _slot = Slot::take();
  let work = std::env::temp_dir().join(format!("md-render-tikz-{}-{}", std::process::id(), key));
  let _ = std::fs::remove_dir_all(&work);
  std::fs::create_dir_all(&work).map_err(|e| TikzError::new("io", format!("cannot create a work directory: {}", e)))?;
  let input = work.join("diagram.tex");
  let output = work.join("diagram.svg");
  let log = work.join("diagram.log");
  std::fs::write(&input, document).map_err(|e| TikzError::new("io", e.to_string()))?;

  let result = run_child(&input, &output, &log, key);
  let _ = std::fs::remove_dir_all(&work);
  result
}

fn run_child(input: &Path, output: &Path, log: &Path, key: &str) -> Result<String, TikzError> {
  let limit = timeout();
  let mut child = Command::new(helper()?)
    .env("MDRENDER_TIKZ_CPU_SECONDS", limit.as_secs().to_string())
    .arg("--render-tikz")
    .arg(input)
    .arg(output)
    .arg(log)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|e| TikzError::new("engine", format!("cannot start the TikZ compiler: {}", e)))?;

  let started = Instant::now();
  let too_long = || {
    TikzError::new(
      "timeout",
      format!(
        "the diagram used more than {} s of computing time and was stopped (a loop that never ends?)",
        limit.as_secs()
      ),
    )
  };
  let status = loop {
    match child.try_wait() {
      Ok(Some(status)) => break status,
      Ok(None) if started.elapsed() >= WALL_LIMIT => {
        let _ = child.kill();
        let _ = child.wait();
        return Err(TikzError::new(
          "timeout",
          format!(
            "the compiler did not finish within {} minutes (a stalled download of TeX files?)",
            WALL_LIMIT.as_secs() / 60
          ),
        ));
      }
      Ok(None) => std::thread::sleep(Duration::from_millis(25)),
      Err(e) => return Err(TikzError::new("engine", e.to_string())),
    }
  };

  // The CPU limit ends the child with a signal (SIGXCPU, or SIGKILL at the
  // hard limit).
  {
    use std::os::unix::process::ExitStatusExt;
    if status.signal().is_some() {
      return Err(too_long());
    }
  }
  if status.success() {
    let svg = std::fs::read_to_string(output).map_err(|e| TikzError::new("io", e.to_string()))?;
    return Ok(postprocess(&svg, key));
  }
  let mut stderr = String::new();
  if let Some(mut pipe) = child.stderr.take() {
    let _ = pipe.read_to_string(&mut stderr);
  }
  match std::fs::read_to_string(log) {
    Ok(text) => {
      let lines = error_lines(&text);
      let message = lines
        .first()
        .cloned()
        .unwrap_or_else(|| "LaTeX could not compile the diagram".to_string());
      Err(TikzError {
        error: "tex",
        message,
        log: lines,
      })
    }
    Err(_) => Err(TikzError::new(
      "engine",
      format!("the TikZ compiler failed: {}", stderr.trim().lines().last().unwrap_or("no output")),
    )),
  }
}

/// The lines of a TeX log that explain an error: each `!` line with the
/// context TeX prints after it.
pub fn error_lines(log: &str) -> Vec<String> {
  let lines: Vec<&str> = log.lines().collect();
  let mut out = Vec::new();
  let mut i = 0;
  while i < lines.len() && out.len() < MAX_ERROR_LINES {
    if lines[i].starts_with('!') {
      for line in lines.iter().skip(i).take(4) {
        if line.trim().is_empty() {
          break;
        }
        out.push(line.to_string());
      }
      i += 4;
    } else {
      i += 1;
    }
  }
  out.truncate(MAX_ERROR_LINES);
  out
}

/// Entry point of the child: compile `input` and write the SVG to `output`.
/// On a TeX error the log goes to `log` and the exit code is 1; on an engine
/// failure (no network for the first download, say) the message goes to
/// stderr and the exit code is 2.
pub fn child_main(input: &Path, output: &Path, log: &Path) -> i32 {
  limit_cpu();
  let source = match std::fs::read_to_string(input) {
    Ok(text) => text,
    Err(e) => {
      eprintln!("cannot read {}: {}", input.display(), e);
      return 2;
    }
  };
  match compile(&source) {
    Ok(pdf) => match pdf_to_svg(pdf) {
      Ok(svg) => match std::fs::write(output, svg) {
        Ok(()) => 0,
        Err(e) => {
          eprintln!("cannot write {}: {}", output.display(), e);
          2
        }
      },
      Err(e) => {
        eprintln!("{}", e);
        2
      }
    },
    Err(Compile::Tex(text)) => {
      let _ = std::fs::write(log, text);
      1
    }
    Err(Compile::Engine(message)) => {
      eprintln!("{}", message);
      2
    }
  }
}

/// Cap this process's CPU time at `$MDRENDER_TIKZ_CPU_SECONDS`: the kernel
/// sends SIGXCPU at the soft limit and SIGKILL a second later.
fn limit_cpu() {
  let Some(seconds) = std::env::var("MDRENDER_TIKZ_CPU_SECONDS")
    .ok()
    .and_then(|v| v.parse::<u64>().ok())
    .filter(|v| *v > 0)
  else {
    return;
  };
  let limit = libc::rlimit {
    rlim_cur: seconds as libc::rlim_t,
    rlim_max: (seconds + 1) as libc::rlim_t,
  };
  // SAFETY: setrlimit reads a valid rlimit for this process only.
  unsafe {
    libc::setrlimit(libc::RLIMIT_CPU, &limit);
  }
}

enum Compile {
  /// The document failed; the TeX log.
  Tex(String),
  /// The engine could not run.
  Engine(String),
}

/// Compile a document to PDF bytes with Tectonic, keeping the log.
fn compile(source: &str) -> Result<Vec<u8>, Compile> {
  use tectonic::{config, driver, status};
  let mut status = status::NoopStatusBackend::default();
  let config = config::PersistentConfig::open(false).map_err(|e| Compile::Engine(format!("Tectonic configuration: {}", e)))?;
  let bundle = config
    .default_bundle(false)
    .map_err(|e| Compile::Engine(format!("Tectonic could not load its TeX files (offline on first use?): {}", e)))?;
  let format_cache = config
    .format_cache_path()
    .map_err(|e| Compile::Engine(format!("Tectonic format cache: {}", e)))?;

  let mut builder = driver::ProcessingSessionBuilder::default();
  builder
    .bundle(bundle)
    .primary_input_buffer(source.as_bytes())
    .tex_input_name("diagram.tex")
    .format_name("latex")
    .format_cache_path(format_cache)
    .keep_logs(true)
    .keep_intermediates(false)
    .print_stdout(false)
    .output_format(driver::OutputFormat::Pdf)
    .do_not_write_output_files();
  let mut session = builder
    .create(&mut status)
    .map_err(|e| Compile::Engine(format!("Tectonic session: {}", e)))?;
  let ran = session.run(&mut status);
  let mut files = session.into_file_data();
  if ran.is_err() {
    let log = files
      .remove("diagram.log")
      .map(|f| String::from_utf8_lossy(&f.data).to_string())
      .unwrap_or_default();
    return Err(if log.is_empty() {
      Compile::Engine(format!("{}", ran.unwrap_err()))
    } else {
      Compile::Tex(log)
    });
  }
  files
    .remove("diagram.pdf")
    .map(|f| f.data)
    .ok_or_else(|| Compile::Engine("LaTeX produced no PDF".to_string()))
}

/// The first page of a PDF as SVG.
fn pdf_to_svg(pdf: Vec<u8>) -> Result<String, String> {
  let pdf = hayro_svg::hayro_syntax::Pdf::new(pdf).map_err(|e| format!("cannot read the PDF: {:?}", e))?;
  let pages = pdf.pages();
  let page = pages.first().ok_or("the PDF has no pages")?;
  let cache = hayro_svg::RenderCache::new();
  Ok(hayro_svg::convert(
    page,
    &cache,
    &hayro_interpret::InterpreterSettings::default(),
    &hayro_svg::SvgRenderSettings::default(),
  ))
}

/// Make an SVG safe to inline next to others and follow the theme:
/// - drop the XML prolog;
/// - prefix every id (glyphs, clip paths) with the diagram's key, so two
///   diagrams on one page cannot take each other's shapes;
/// - draw pure black in `currentColor`, so the diagram takes the text colour
///   of the theme; other colours stay as written.
pub fn postprocess(svg: &str, key: &str) -> String {
  let prefix = format!("tk{}-", &key[..key.len().min(8)]);
  let mut out = svg.trim_start().to_string();
  if out.starts_with("<?xml") {
    if let Some(end) = out.find("?>") {
      out = out[end + 2..].trim_start().to_string();
    }
  }
  out = out
    .replace("id=\"", &format!("id=\"{}", prefix))
    .replace("href=\"#", &format!("href=\"#{}", prefix))
    .replace("url(#", &format!("url(#{}", prefix));
  for black in ["#000000", "#000", "black", "rgb(0,0,0)", "rgb(0, 0, 0)"] {
    out = out
      .replace(&format!("fill=\"{}\"", black), "fill=\"currentColor\"")
      .replace(&format!("stroke=\"{}\"", black), "stroke=\"currentColor\"");
  }
  out
}

/// Compile small TikZ, tikz-cd and pgfplots documents so Tectonic downloads
/// what they need now rather than on a reader's first diagram.
pub fn warm() -> Result<(), TikzError> {
  for source in [
    "\\begin{tikzpicture}\\draw[->] (0,0) -- node[above]{$x$} (1,0);\\end{tikzpicture}",
    "%! packages: tikz-cd\n\\begin{tikzcd} A \\arrow[r] & B \\end{tikzcd}",
    "%! packages: pgfplots\n\\begin{tikzpicture}\\begin{axis}\\addplot{x^2};\\end{axis}\\end{tikzpicture}",
  ] {
    let started = Instant::now();
    let rendered = render(source)?;
    println!(
      "warmed {} in {:.1}s{}",
      &rendered.key[..8],
      started.elapsed().as_secs_f64(),
      if rendered.cached { " (cached)" } else { "" }
    );
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn headers_become_preamble_and_the_rest_is_the_body() {
    let diagram = parse(
      "%! packages: pgfplots, tikz-cd\n%! libraries: arrows.meta,positioning\n%! preamble: \\newcommand{\\R}{\\mathbb{R}}\n%! caption: A figure.\n% an ordinary comment\n\\begin{tikzpicture}\\end{tikzpicture}\n",
    );
    assert_eq!(diagram.packages, ["pgfplots", "tikz-cd"]);
    assert_eq!(diagram.libraries, ["arrows.meta", "positioning"]);
    assert_eq!(diagram.preamble, ["\\newcommand{\\R}{\\mathbb{R}}"]);
    assert_eq!(diagram.body, "% an ordinary comment\n\\begin{tikzpicture}\\end{tikzpicture}");
    assert!(!diagram.full_document);

    let doc = document(&diagram);
    assert!(doc.starts_with("\\documentclass[tikz,border=2pt]{standalone}\n\\usepackage{pgfplots}\n\\usepackage{tikz-cd}\n"));
    assert!(doc.contains("\\pgfplotsset{compat=1.18}\n"));
    assert!(doc.contains("\\usetikzlibrary{arrows.meta,positioning}\n"));
    assert!(doc.contains("\\begin{document}\n% an ordinary comment"));
    assert!(doc.ends_with("\\end{document}\n"));
    assert!(!doc.contains("caption"));
  }

  #[test]
  fn a_full_document_passes_through() {
    let source = "\\documentclass{standalone}\n\\begin{document}x\\end{document}";
    let diagram = parse(source);
    assert!(diagram.full_document);
    assert_eq!(document(&diagram), format!("{}\n", source));
  }

  #[test]
  fn package_options_are_kept() {
    let doc = document(&parse("%! packages: [siunitx]{circuitikz}\nx"));
    assert!(doc.contains("\\usepackage[siunitx]{circuitikz}\n"));
  }

  #[test]
  fn cache_keys_are_stable_and_safe_in_paths() {
    let key = cache_key("doc");
    assert_eq!(key, cache_key("doc"));
    assert_ne!(key, cache_key("doc2"));
    assert!(valid_key(&key));
    assert!(!valid_key("../../etc/passwd"));
    assert!(!valid_key(&"g".repeat(32)));
  }

  #[test]
  fn svg_ids_get_a_prefix_and_black_follows_the_theme() {
    let svg = "<?xml version=\"1.0\"?>\n<svg><defs><path id=\"g1\" d=\"M0 0\"/><clipPath id=\"c1\"/></defs><use href=\"#g1\" fill=\"#000000\"/><g clip-path=\"url(#c1)\" stroke=\"#000\"><path fill=\"#ff0000\"/></g></svg>";
    let out = postprocess(svg, "abcdef0123456789abcdef0123456789");
    assert!(out.starts_with("<svg>"));
    assert!(out.contains("id=\"tkabcdef01-g1\""));
    assert!(out.contains("href=\"#tkabcdef01-g1\""));
    assert!(out.contains("url(#tkabcdef01-c1)"));
    assert!(out.contains("fill=\"currentColor\""));
    assert!(out.contains("stroke=\"currentColor\""));
    assert!(out.contains("fill=\"#ff0000\""));
  }

  #[test]
  fn error_lines_keep_the_bang_lines_and_their_context() {
    let log = "This is XeTeX\n(diagram.tex\n! Undefined control sequence.\nl.4 \\drwa\n          (0,0) -- (1,1);\n\nmore\n! Emergency stop.\n<*> diagram.tex\n";
    assert_eq!(
      error_lines(log),
      [
        "! Undefined control sequence.",
        "l.4 \\drwa",
        "          (0,0) -- (1,1);",
        "! Emergency stop.",
        "<*> diagram.tex",
      ]
    );
  }

  #[test]
  fn oversized_sources_are_refused_before_compiling() {
    let err = render(&"x".repeat(MAX_SOURCE_BYTES + 1)).unwrap_err();
    assert_eq!(err.error, "too_large");
    assert_eq!(err.status(), 413);
  }

  /// Compiles in-process (no child), which needs Tectonic's TeX files: they
  /// are downloaded on first use and cached.
  #[test]
  fn tectonic_and_hayro_turn_tikz_into_svg() {
    let doc = document(&parse("\\begin{tikzpicture}\\draw (0,0) circle (1); \\node at (0,0) {$x^2$};\\end{tikzpicture}"));
    let pdf = match compile(&doc) {
      Ok(pdf) => pdf,
      Err(Compile::Engine(message)) => panic!("engine failed: {}", message),
      Err(Compile::Tex(log)) => panic!("tex failed: {}", log),
    };
    let svg = pdf_to_svg(pdf).unwrap();
    assert!(svg.contains("<svg"));
    assert!(svg.contains("<path"));
  }
}
