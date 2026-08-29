use std::{env, fs, path::PathBuf};

fn compile_windows_icon() {
    if env::var_os("CARGO_CFG_WINDOWS").is_none() {
        return;
    }
    let icon = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("resources")
        .join("icon.ico");
    if !icon.is_file() {
        panic!("Windows application icon is missing: {}", icon.display());
    }
    let mut resource = winres::WindowsResource::new();
    resource.set_icon(icon.to_str().expect("icon path is not valid UTF-8"));
    // native-windows-gui uses the Windows common-controls subclass helpers,
    // including GetWindowSubclass.  Those exports are provided by the
    // version 6 side-by-side common-controls assembly; without this manifest
    // Windows may bind the legacy system comctl32.dll (which does not export
    // GetWindowSubclass) before the installer UI is even shown.
    resource.set_manifest(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0" xmlns:asmv3="urn:schemas-microsoft-com:asm.v3">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <asmv3:application>
    <asmv3:windowsSettings xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">
      <dpiAware>true</dpiAware>
    </asmv3:windowsSettings>
    <asmv3:windowsSettings xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">
      <dpiAwareness>System</dpiAwareness>
    </asmv3:windowsSettings>
  </asmv3:application>
</assembly>
"#,
    );
    resource
        .compile()
        .expect("compile Windows application icon");
    println!("cargo:rerun-if-changed={}", icon.display());
    for layer in [
        "installer-logo-q1.png",
        "installer-logo-q2.png",
        "installer-logo-q3.png",
        "installer-logo-q4.png",
    ] {
        let layer_path = icon
            .parent()
            .expect("icon parent is unavailable")
            .join(layer);
        if !layer_path.is_file() {
            panic!(
                "installer animation logo layer is missing: {}",
                layer_path.display()
            );
        }
        println!("cargo:rerun-if-changed={}", layer_path.display());
    }
}

fn copy_or_empty(env_name: &str, output_name: &str) {
    let output = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join(output_name);
    if let Ok(source) = env::var(env_name) {
        fs::copy(source, output).expect("copy embedded bootstrap payload");
    } else {
        fs::write(output, []).expect("write empty bootstrap payload");
    }
    println!("cargo:rerun-if-env-changed={env_name}");
}

fn main() {
    compile_windows_icon();
    copy_or_empty("BZ_VELOPACK_SETUP_PATH", "velopack-setup.exe");
    copy_or_empty("BZ_ROOT_LAUNCHER_PATH", "BZ-Games.exe");
    copy_or_empty("BZ_ROOT_UNINSTALLER_PATH", "BZ-Games-Uninstall.exe");
    println!("cargo:rerun-if-env-changed=BZ_APP_VERSION");
}
