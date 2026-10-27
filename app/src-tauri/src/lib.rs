use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri_plugin_fs::FsExt;

/// Steam app id of Transport Fever 3 (Steam userdata: <Steam>/userdata/<SteamID>/<appid>/local).
const TF3_APP_ID: &str = "3493540";
/// mod.io game id of Transport Fever 3 (Mod Hub downloads: <mod.io>/10640/mods).
const MODIO_GAME_ID: &str = "10640";
/// Folder of the mod (`content/hqminimap` inside the installed mod root).
const MOD_ID: &str = "hqminimap";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectedPaths {
    /// TF3 userdata folder (Steam: `<Steam>/userdata/<SteamID>/3493540/local`), if found.
    userdata: Option<String>,
    /// Installed mod root (contains `content/hqminimap`): staging_area, mods or Mod Hub, if found.
    mod_dir: Option<String>,
    /// Every candidate that was checked, in order (for the settings screen).
    candidates: Vec<String>,
}

#[cfg(not(windows))]
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Steam install folder from the registry (HKCU\Software\Valve\Steam, SteamPath).
#[cfg(windows)]
fn steam_path_from_registry() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().find(|l| l.trim_start().starts_with("SteamPath"))?;
    let value = line.split("REG_SZ").nth(1)?.trim();
    (!value.is_empty()).then(|| PathBuf::from(value))
}

/// Steam install folders (where `userdata/` lives), most likely first.
fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        roots.extend(steam_path_from_registry());
        for var in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(dir) = std::env::var_os(var) {
                roots.push(PathBuf::from(dir).join("Steam"));
            }
        }
    }
    #[cfg(not(windows))]
    if let Some(home) = home_dir() {
        roots.push(home.join(".local/share/Steam"));
        roots.push(home.join(".steam/steam"));
        roots.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        roots.push(home.join("Library/Application Support/Steam"));
    }
    let mut seen = Vec::new();
    roots.retain(|r| {
        let key = std::fs::canonicalize(r).unwrap_or_else(|_| r.clone());
        if seen.contains(&key) {
            false
        } else {
            seen.push(key);
            true
        }
    });
    roots
}

/// GOG / Epic Games Store userdata folder (`<AppData>/Roaming/Transport Fever 3` and equivalents).
fn store_userdata_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(windows)]
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("Transport Fever 3"));
    }
    #[cfg(not(windows))]
    if let Some(home) = home_dir() {
        dirs.push(home.join(".local/share/Transport Fever 3"));
        dirs.push(home.join("Library/Application Support/Transport Fever 3"));
    }
    dirs
}

/// TF3 userdata folders: every Steam account (`userdata/<SteamID>/3493540/local`, most recently
/// used first), then the GOG / Epic folder. Without any, the expected locations (settings screen).
fn userdata_candidates() -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut steam: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let mut expected = Vec::new();
    for root in steam_roots() {
        let users = root.join("userdata");
        expected.push(users.join("<SteamID>").join(TF3_APP_ID).join("local"));
        if let Ok(entries) = std::fs::read_dir(&users) {
            for e in entries.flatten() {
                let local = e.path().join(TF3_APP_ID).join("local");
                if local.is_dir() {
                    let mtime = std::fs::metadata(&local).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                    steam.push((mtime, local));
                }
            }
        }
    }
    steam.sort_by(|a, b| b.0.cmp(&a.0));
    let mut found: Vec<PathBuf> = steam.into_iter().map(|(_, p)| p).collect();
    for dir in store_userdata_dirs() {
        if dir.is_dir() {
            found.push(dir);
        } else {
            expected.push(dir);
        }
    }
    (found, expected)
}

/// Mod Hub (mod.io) download folders of TF3: the configured storage root (globalsettings.json,
/// RootLocalStoragePath), then the defaults.
fn modio_mod_dirs() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let settings = PathBuf::from(local).join("mod.io").join("globalsettings.json");
            if let Ok(text) = std::fs::read_to_string(settings) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(root) = json.get("RootLocalStoragePath").and_then(|v| v.as_str()) {
                        roots.push(PathBuf::from(root));
                    }
                }
            }
        }
        let public = std::env::var_os("PUBLIC").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Users\Public"));
        roots.push(public.join("mod.io"));
    }
    #[cfg(not(windows))]
    if let Some(home) = home_dir() {
        roots.push(home.join("mod.io/common"));
        roots.push(home.join("Library/Application Support/mod.io/common"));
    }
    roots.into_iter().map(|r| r.join(MODIO_GAME_ID).join("mods")).collect()
}

/// A mod root containing the mod, directly or one level down (`<dir>/<x>/content/hqminimap`).
fn mod_in(dir: &Path) -> Option<PathBuf> {
    let has_mod = |d: &Path| d.join("content").join(MOD_ID).is_dir();
    if has_mod(dir) {
        return Some(dir.to_path_buf());
    }
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| has_mod(p))
}

/// The installed mod, in the game's own priority: staging area, then manual install
/// (`<userdata>/mods`), then the mods subscribed in the Mod Hub (mod.io).
fn find_mod_dir(userdata: Option<&Path>) -> Option<PathBuf> {
    if let Some(ud) = userdata {
        let staging = ud.join("staging_area").join(MOD_ID);
        if staging.join("content").join(MOD_ID).is_dir() {
            return Some(staging);
        }
        if let Some(found) = std::fs::read_dir(ud.join("mods"))
            .ok()
            .and_then(|it| it.flatten().map(|e| e.path()).find(|p| p.join("content").join(MOD_ID).is_dir()))
        {
            return Some(found);
        }
    }
    for mods in modio_mod_dirs() {
        let Ok(entries) = std::fs::read_dir(&mods) else { continue };
        for e in entries.flatten() {
            if let Some(found) = mod_in(&e.path()) {
                return Some(found);
            }
        }
    }
    None
}

#[tauri::command]
fn detect_paths() -> DetectedPaths {
    let (found, expected) = userdata_candidates();
    let userdata = found.first().cloned();
    let mod_dir = find_mod_dir(userdata.as_deref());
    let shown = if found.is_empty() { expected } else { found };
    let s = |p: &Path| p.to_string_lossy().into_owned();
    DetectedPaths {
        userdata: userdata.as_deref().map(s),
        mod_dir: mod_dir.as_deref().map(s),
        candidates: shown.iter().map(|p| s(p)).collect(),
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

#[tauri::command]
fn allow_dirs(app: tauri::AppHandle, dirs: Vec<String>) {
    let scope = app.fs_scope();
    for dir in dirs {
        let path = PathBuf::from(&dir);
        if path.is_dir() {
            let _ = scope.allow_directory(path, true);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![detect_paths, install_info, allow_dirs])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
