//! Installable theme packages. Claudette is built into the frontend; every
//! other theme is a folder under the repository's `themes/`, embedded in the
//! binary so `md-render --install-theme NAME` works from any install, and
//! copied on install into `$XDG_CONFIG_HOME/md-render/themes/NAME`. A folder
//! a user drops there by hand is loaded the same way. See themes/README.md.

use std::fs;
use std::path::{Component, Path, PathBuf};

use rust_embed::RustEmbed;
use serde::Serialize;

#[derive(RustEmbed)]
#[folder = "../themes"]
struct Bundled;

/// Package and file names: lower-case words joined by hyphens (files may
/// add dots and sub-folders), so neither can step outside a package.
fn valid_name(name: &str) -> bool {
  !name.is_empty()
    && name.len() <= 64
    && name.split('-').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
}

/// `$XDG_CONFIG_HOME/md-render/themes`, falling back to `~/.config/...`.
pub fn config_dir() -> PathBuf {
  let config = match std::env::var_os("XDG_CONFIG_HOME") {
    Some(dir) if !dir.is_empty() => PathBuf::from(dir),
    _ => dirs::home_dir()
      .unwrap_or_else(std::env::temp_dir)
      .join(".config"),
  };
  config.join("md-render").join("themes")
}

/// The packages this binary can install, sorted.
pub fn available() -> Vec<String> {
  let mut names: Vec<String> = Bundled::iter()
    .filter_map(|path| path.strip_suffix("/theme.json").map(str::to_string))
    .filter(|name| valid_name(name))
    .collect();
  names.sort();
  names
}

/// Copy a bundled package into the config directory, replacing any older copy.
pub fn install(name: &str) -> Result<PathBuf, String> {
  install_into(&config_dir(), name)
}

fn install_into(root: &Path, name: &str) -> Result<PathBuf, String> {
  if !available().iter().any(|n| n == name) {
    return Err(format!(
      "no theme package named {:?}; available: {}",
      name,
      available().join(", ")
    ));
  }
  let target = root.join(name);
  if target.exists() {
    fs::remove_dir_all(&target).map_err(|e| format!("could not replace {}: {}", target.display(), e))?;
  }
  let prefix = format!("{}/", name);
  for path in Bundled::iter() {
    let Some(rel) = path.strip_prefix(&prefix) else { continue };
    let file = Bundled::get(&path).expect("listed by iter");
    let dest = target.join(rel);
    if let Some(parent) = dest.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {}", parent.display(), e))?;
    }
    fs::write(&dest, file.data.as_ref()).map_err(|e| format!("could not write {}: {}", dest.display(), e))?;
  }
  Ok(target)
}

/// Move an installed package aside (to `.removed/NAME`), so a removal can be undone.
pub fn remove(name: &str) -> Result<PathBuf, String> {
  remove_from(&config_dir(), name)
}

fn remove_from(root: &Path, name: &str) -> Result<PathBuf, String> {
  if !valid_name(name) || !root.join(name).join("theme.json").is_file() {
    return Err(format!("no installed theme package named {:?}", name));
  }
  let trash = root.join(".removed");
  fs::create_dir_all(&trash).map_err(|e| format!("could not create {}: {}", trash.display(), e))?;
  let dest = trash.join(name);
  if dest.exists() {
    fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
  }
  fs::rename(root.join(name), &dest).map_err(|e| e.to_string())?;
  Ok(dest)
}

/// One installed package as the frontend loads it. The themes are passed
/// through as written; the frontend validates each one (validateTheme).
#[derive(Debug, Clone, Serialize)]
pub struct Installed {
  pub package: String,
  pub themes: Vec<serde_json::Value>,
  pub css: bool,
  /// The package folder, for the desktop app to address its files.
  pub dir: String,
}

/// Every installed package with a readable theme.json, sorted by name. A
/// broken package is skipped with a warning rather than failing the list.
pub fn installed() -> Vec<Installed> {
  installed_in(&config_dir())
}

fn installed_in(root: &Path) -> Vec<Installed> {
  let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
  let mut out = Vec::new();
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if !valid_name(&name) || !entry.path().is_dir() {
      continue;
    }
    let json = entry.path().join("theme.json");
    let parsed = fs::read_to_string(&json)
      .map_err(|e| e.to_string())
      .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).map_err(|e| e.to_string()));
    match parsed {
      Ok(value) => match value.get("themes").and_then(|t| t.as_array()) {
        Some(themes) => out.push(Installed {
          package: name,
          themes: themes.clone(),
          css: entry.path().join("theme.css").is_file(),
          dir: entry.path().to_string_lossy().to_string(),
        }),
        None => eprintln!("md-render: skipping theme {}: theme.json has no \"themes\" list", name),
      },
      Err(err) => eprintln!("md-render: skipping theme {}: {}", name, err),
    }
  }
  out.sort_by(|a, b| a.package.cmp(&b.package));
  out
}

/// Read a file of an installed package. `rel` must stay inside the package:
/// no `..`, no absolute paths, no hidden files.
pub fn read_file(package: &str, rel: &str) -> Option<Vec<u8>> {
  read_file_in(&config_dir(), package, rel)
}

fn read_file_in(root: &Path, package: &str, rel: &str) -> Option<Vec<u8>> {
  if !valid_name(package) {
    return None;
  }
  let rel_path = Path::new(rel);
  let safe = !rel.is_empty()
    && rel_path.components().all(|c| match c {
      Component::Normal(part) => !part.to_string_lossy().starts_with('.'),
      _ => false,
    });
  if !safe {
    return None;
  }
  fs::read(root.join(package).join(rel_path)).ok()
}

/// `md-render --list-themes`: the built-ins, then what can be installed.
pub fn print_list() {
  let installed: Vec<String> = installed().into_iter().map(|p| p.package).collect();
  println!("Built in: claudette, claudette-dark");
  println!("Theme packages (install with `md-render --install-theme NAME`):");
  for name in available() {
    let mark = if installed.contains(&name) { "  installed" } else { "" };
    println!("  {}{}", name, mark);
  }
  let local: Vec<&String> = installed.iter().filter(|n| !available().contains(n)).collect();
  if !local.is_empty() {
    println!("Also installed (your own):");
    for name in local {
      println!("  {}", name);
    }
  }
  println!("Installed themes live in {}", config_dir().display());
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("md-render-themes-{}-{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn bundles_every_package_in_the_themes_folder() {
    let names = available();
    for name in ["latex", "claude", "sonnet", "warm-paper", "midnight-ink", "paradigm"] {
      assert!(names.contains(&name.to_string()), "{} missing from {:?}", name, names);
    }
    assert!(!names.iter().any(|n| n.starts_with("claudette")), "Claudette is built in");
  }

  #[test]
  fn installs_lists_reads_and_removes_a_package() {
    let root = temp_root("cycle");
    let dir = install_into(&root, "latex").unwrap();
    assert!(dir.join("theme.json").is_file());
    assert!(dir.join("fonts/mdr-newcm10-book.woff2").is_file());

    let listed = installed_in(&root);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].package, "latex");
    assert!(listed[0].css);
    let ids: Vec<&str> = listed[0].themes.iter().filter_map(|t| t["id"].as_str()).collect();
    assert_eq!(ids, ["latex", "latex-dark"]);

    assert!(read_file_in(&root, "latex", "theme.css").unwrap().starts_with(b"/*"));
    assert!(read_file_in(&root, "latex", "fonts/mdr-newcm10-book.woff2").is_some());

    remove_from(&root, "latex").unwrap();
    assert!(installed_in(&root).is_empty());
    assert!(root.join(".removed/latex/theme.json").is_file());
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn refuses_unknown_packages_and_paths_outside_one() {
    let root = temp_root("confine");
    assert!(install_into(&root, "no-such-theme").unwrap_err().contains("available: "));
    assert!(install_into(&root, "../etc").is_err());
    install_into(&root, "sonnet").unwrap();
    fs::write(root.join("secret.txt"), "x").unwrap();
    for rel in ["../secret.txt", "/etc/passwd", "", ".hidden", "fonts/../../secret.txt"] {
      assert!(read_file_in(&root, "sonnet", rel).is_none(), "{:?} was readable", rel);
    }
    assert!(read_file_in(&root, "..", "secret.txt").is_none());
    assert!(remove_from(&root, "..").is_err());
    let _ = fs::remove_dir_all(&root);
  }

  #[test]
  fn skips_a_broken_package_and_hidden_folders() {
    let root = temp_root("broken");
    fs::create_dir_all(root.join("broken")).unwrap();
    fs::write(root.join("broken/theme.json"), "{not json").unwrap();
    fs::create_dir_all(root.join(".removed/old")).unwrap();
    install_into(&root, "plain").unwrap();
    let names: Vec<String> = installed_in(&root).into_iter().map(|p| p.package).collect();
    assert_eq!(names, ["plain"]);
    let _ = fs::remove_dir_all(&root);
  }
}
