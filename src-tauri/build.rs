fn main() {
  tauri_build::build();

  #[cfg(target_os = "macos")]
  {
    println!("cargo:rustc-env=MACOSX_DEPLOYMENT_TARGET=10.13");
  }
}
