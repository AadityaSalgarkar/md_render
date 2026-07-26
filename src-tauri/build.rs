fn main() {
  // rust-embed needs ../dist to exist at compile time. It is produced by
  // `npm run build`, which does not run for a bare `cargo test`, so make sure
  // the directory is at least present.
  let dist = std::path::Path::new("../dist");
  if !dist.exists() {
    let _ = std::fs::create_dir_all(dist);
  }

  tauri_build::build();

  #[cfg(target_os = "macos")]
  {
    println!("cargo:rustc-env=MACOSX_DEPLOYMENT_TARGET=10.13");
  }
}
