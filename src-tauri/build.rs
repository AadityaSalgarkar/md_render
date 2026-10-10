fn main() {
  // rust-embed needs ../dist to exist at compile time. It is produced by
  // `npm run build`, which does not run for a bare `cargo test`, so make sure
  // the directory is at least present.
  let dist = std::path::Path::new("../dist");
  if !dist.exists() {
    let _ = std::fs::create_dir_all(dist);
  }

  // Only the desktop window needs Tauri's build step (config, icons,
  // capabilities); the server-only build skips it.
  #[cfg(feature = "desktop")]
  tauri_build::build();

  #[cfg(target_os = "macos")]
  {
    println!("cargo:rustc-env=MACOSX_DEPLOYMENT_TARGET=10.13");
  }
}
