use serde::Serialize;
use std::path::{Path, PathBuf};

/// Steam app id of Transport Fever 3 (userdata lives under .../RUNE/<appid>/local).
const TF3_APP_ID: &str = "3493540";

#[derive(Serialize)]
struct DetectedPaths {
    /// TF3 userdata folder (`.../Steam/RUNE/3493540/local`), if found.
    userdata: Option<String>,
    /// Every candidate that was checked, in order (for the settings screen).
    candidates: Vec<String>,
}

/// Steam library roots: default installs + extra libraries listed in libraryfolders.vdf.
fn steam_libraries(home: &Path) -> Vec<PathBuf> {
    let mut roots = vec![
        home.join(".steam/steam"),
        home.join(".local/share/Steam"),
        home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
    ];
    let mut extra = Vec::new();
    for root in &roots {
        if let Ok(text) = std::fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
            for line in text.lines() {
                if let Some(rest) = line.trim().strip_prefix("\"path\"") {
                    extra.push(PathBuf::from(rest.trim().trim_matches('"').replace("\\\\", "\\")));
                }
            }
        }
    }
    roots.extend(extra);
    roots
}

/// Candidate userdata folders for this OS, most likely first.
fn userdata_candidates() -> Vec<PathBuf> {
    let suffix = Path::new("Documents/Steam/RUNE").join(TF3_APP_ID).join("local");
    let mut out = Vec::new();
    if cfg!(windows) {
        let public = std::env::var("PUBLIC").unwrap_or_else(|_| "C:\\Users\\Public".into());
        out.push(Path::new(&public).join(&suffix));
    } else if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        // Linux: the Windows path inside the game's Proton prefix.
        for lib in steam_libraries(&home) {
            let users = lib.join("steamapps/compatdata").join(TF3_APP_ID).join("pfx/drive_c/users");
            out.push(users.join("Public").join(&suffix));
            out.push(users.join("steamuser").join(&suffix));
        }
        // macOS / native builds (unverified locations).
        out.push(home.join("Library/Application Support/Steam/RUNE").join(TF3_APP_ID).join("local"));
        out.push(home.join(&suffix));
    }
    out
}

#[tauri::command]
fn detect_paths() -> DetectedPaths {
    let candidates = userdata_candidates();
    let userdata = candidates.iter().find(|p| p.is_dir()).map(|p| p.to_string_lossy().into_owned());
    DetectedPaths {
        userdata,
        candidates: candidates.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
    }
}

/// Marker file shipped next to the executable in the Windows portable zip (release.yml).
const PORTABLE_MARKER: &str = "HQminiMap.portable";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallInfo {
    /// Windows portable zip: the updater would install a second copy next to it.
    portable: bool,
    /// The updater can replace this install: anything but the portable zip and, on Linux, anything
    /// but an AppImage (`APPIMAGE` is set by its runtime; a .deb is not updatable).
    self_update: bool,
}

#[tauri::command]
fn install_info() -> InstallInfo {
    let portable = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(PORTABLE_MARKER).is_file()))
        .unwrap_or(false);
    let linux_package = cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none();
    InstallInfo { portable, self_update: !portable && !linux_package }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![detect_paths, install_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
