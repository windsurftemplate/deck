use serde::Serialize;
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

/// Emergency stop: tells every part of the app to stop all agents now.
#[tauri::command]
fn emergency_stop(app: AppHandle) -> Result<(), String> {
    app.emit("kill-all", ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
                    let _ = app.emit("kill-all", ());
                }
                "quit" => app.exit(0),
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
        .invoke_handler(tauri::generate_handler![secret_set, secret_exists, secret_delete, native_checks, emergency_stop])
        .run(tauri::generate_context!())
        .expect("error while running deck");
}

#[cfg(test)]
mod tests {
    use super::valid_name;

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
