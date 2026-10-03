mod engine;

use engine::EngineClient;
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WindowEvent,
};

const KEYCHAIN_SERVICE: &str = "dev.deck.app";

#[derive(Serialize, Clone)]
struct CheckResult {
    id: &'static str,
    name: &'static str,
    status: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    fix: Option<String>,
}

/// Secret names are fixed, simple identifiers. Anything else is refused.
fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_' || c == '-')
}

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !valid_name(name) {
        return Err("invalid secret name".into());
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| e.to_string())
}

/// Store a secret (a scoped token or the memory key) in the OS keychain. Never written to disk by the app.
#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    if value.is_empty() || value.len() > 8192 {
        return Err("secret is empty or too long".into());
    }
    entry(&name)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_exists(name: String) -> Result<bool, String> {
    match entry(&name)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Last 4 characters only, so the owner can tell which key is saved. The full key never leaves the keychain to the UI.
#[tauri::command]
fn secret_hint(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(v) => Ok(Some(last4(&v))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn last4(v: &str) -> String {
    let chars: Vec<char> = v.chars().collect();
    if chars.len() < 12 {
        return "****".into();
    }
    chars[chars.len() - 4..].iter().collect()
}

#[tauri::command]
fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Checks only the native side can answer. The agent engine answers the rest.
#[tauri::command]
fn native_checks(app: AppHandle) -> Vec<CheckResult> {
    let mut out = Vec::new();

    let dir = app.path().app_data_dir().ok();
    let free = dir.as_ref().and_then(|d| {
        let _ = std::fs::create_dir_all(d);
        fs2::available_space(d).ok()
    });
    let version = app.package_info().version.to_string();
    out.push(match free {
        Some(b) if b >= 1_000_000_000 => CheckResult { id: "power", name: "Power", status: "ok", message: format!("App {} running. {:.1} GB free.", version, b as f64 / 1e9), fix: None },
        Some(b) => CheckResult { id: "power", name: "Power", status: "degraded", message: format!("Only {:.1} GB free.", b as f64 / 1e9), fix: Some("Free up disk space; memory needs at least 1 GB.".into()) },
        None => CheckResult { id: "power", name: "Power", status: "degraded", message: "Could not read free disk space.".into(), fix: None },
    });

    // Round-trip a throwaway value to prove the keychain works.
    let probe = "selftest.probe";
    let keychain = entry(probe).and_then(|e| {
        e.set_password("ok").map_err(|x| x.to_string())?;
        let v = e.get_password().map_err(|x| x.to_string())?;
        let _ = e.delete_credential();
        Ok(v)
    });
    out.push(match keychain {
        Ok(v) if v == "ok" => CheckResult { id: "keychain", name: "Keychain", status: "ok", message: "Keychain unlocked.".into(), fix: None },
        Ok(_) => CheckResult { id: "keychain", name: "Keychain", status: "blocking", message: "Keychain returned the wrong value.".into(), fix: Some("Restart the app.".into()) },
        Err(e) => CheckResult { id: "keychain", name: "Keychain", status: "blocking", message: format!("Keychain unavailable: {}", e), fix: Some("Unlock your system keychain, then restart.".into()) },
    });
    out
}

const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_MAX: usize = 64 * 1024;

/// Plain settings file in the app data folder. No secrets: those stay in the keychain.
#[tauri::command]
fn settings_get(app: AppHandle) -> Result<Option<String>, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join(SETTINGS_FILE);
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn settings_set(app: AppHandle, json: String) -> Result<(), String> {
    check_settings_json(&json)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Write to a temp file then rename, so a crash never leaves a half-written file.
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(SETTINGS_FILE)).map_err(|e| e.to_string())
}

fn check_settings_json(json: &str) -> Result<(), String> {
    if json.len() > SETTINGS_MAX {
        return Err("settings file too large".into());
    }
    let v: serde_json::Value = serde_json::from_str(json).map_err(|_| "settings must be valid JSON".to_string())?;
    if !v.is_object() {
        return Err("settings must be a JSON object".into());
    }
    Ok(())
}

/// Emergency stop: tells every part of the app to stop all agents now, including the engine.
#[tauri::command]
fn emergency_stop(app: AppHandle, state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let client = state.0.lock().unwrap().clone();
    if let Some(c) = client {
        let _ = c.call("kill", serde_json::json!({ "agent": "all" }), Duration::from_secs(10));
    }
    app.emit("kill-all", ()).map_err(|e| e.to_string())
}

/// The running agent engine, if it started.
struct EngineState(Mutex<Option<std::sync::Arc<EngineClient>>>, Mutex<Option<String>>);

/// Forward a request to the agent engine. Slow work (model calls) runs off the UI thread.
#[tauri::command]
async fn engine_call(state: tauri::State<'_, EngineState>, method: String, params: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    // Take a handle and release the lock, so a slow call never blocks other calls.
    let client = state.0.lock().unwrap().clone().ok_or_else(|| state.1.lock().unwrap().clone().unwrap_or_else(|| "the agent engine is not running".into()))?;
    let timeout = if method == "chat.send" || method == "brief" || method == "checks" || method == "reload" { Duration::from_secs(180) } else { Duration::from_secs(30) };
    tauri::async_runtime::spawn_blocking(move || client.call(&method, params.unwrap_or(serde_json::Value::Null), timeout))
        .await
        .map_err(|e| e.to_string())?
}

/// Where the engine lives. Dev builds use the workspace copy; set DECK_ENGINE_ENTRY to override.
fn engine_entry() -> std::path::PathBuf {
    std::env::var("DECK_ENGINE_ENTRY").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../engine/dist/main.js"))
}

fn start_engine(app: &AppHandle) -> Result<EngineClient, String> {
    let entry = engine_entry();
    if !entry.exists() {
        return Err(format!("agent engine not built yet ({}). Run: pnpm --filter @deck/engine build", entry.display()));
    }
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let node = std::env::var("DECK_NODE").unwrap_or_else(|_| "node".into());
    let handle = app.clone();
    EngineClient::spawn(&node, &[entry.display().to_string(), data.display().to_string()], Box::new(move |v| {
        let _ = handle.emit("engine-event", v);
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EngineState(Mutex::new(None), Mutex::new(None)))
        .setup(|app| {
            let state = app.state::<EngineState>();
            match start_engine(app.handle()) {
                Ok(c) => *state.0.lock().unwrap() = Some(std::sync::Arc::new(c)),
                Err(e) => *state.1.lock().unwrap() = Some(e),
            };
            let show = MenuItem::with_id(app, "show", "Show deck", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop all agents", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &stop, &quit])?;
            let mut tray = TrayIconBuilder::new().menu(&menu).tooltip("deck");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "stop" => {
                    let client = app.state::<EngineState>().0.lock().unwrap().clone();
                    if let Some(c) = client {
                        let _ = c.call("kill", serde_json::json!({ "agent": "all" }), Duration::from_secs(10));
                    }
                    let _ = app.emit("kill-all", ());
                }
                "quit" => {
                    if let Some(c) = app.state::<EngineState>().0.lock().unwrap().take() {
                        c.stop();
                    }
                    app.exit(0)
                }
                _ => {}
            })
            .build(app)?;
            Ok(())
        })
        // Closing the window keeps the crew working in the tray.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![secret_set, secret_exists, secret_hint, secret_delete, native_checks, emergency_stop, settings_get, settings_set, engine_call])
        .run(tauri::generate_context!())
        .expect("error while running deck");
}

#[cfg(test)]
mod tests {
    use super::{check_settings_json, last4, valid_name};

    #[test]
    fn hint_shows_only_the_last_four() {
        assert_eq!(last4("sk-ant-api03-abcdefghWXYZ"), "WXYZ");
        assert_eq!(last4("short"), "****");
    }

    #[test]
    fn settings_file_must_be_a_small_json_object() {
        assert!(check_settings_json(r#"{"version":1}"#).is_ok());
        assert!(check_settings_json("[1,2]").is_err());
        assert!(check_settings_json("not json").is_err());
        assert!(check_settings_json(&format!("{{\"x\":\"{}\"}}", "a".repeat(70_000))).is_err());
    }

    #[test]
    fn secret_names_are_restricted() {
        assert!(valid_name("gateway.token"));
        assert!(valid_name("memory_key-1"));
        assert!(!valid_name(""));
        assert!(!valid_name("../etc/passwd"));
        assert!(!valid_name("Gateway Token"));
        assert!(!valid_name(&"a".repeat(65)));
    }
}
