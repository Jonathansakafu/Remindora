//! Remindora desktop shell.
//!
//! The UI is the same Next.js app as the web (static export, offline-capable).
//! This shell adds what the browser can't: OS keychain storage for the refresh
//! token, native notifications, a tray, a global Quick Add shortcut, deep links
//! (OAuth callbacks, `remindora://` links), single-instance and auto-update.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const KEYCHAIN_SERVICE: &str = "app.remindora.desktop";
/// Only these keys may be read/written from the webview.
const ALLOWED_KEYS: &[&str] = &["remindora.refresh"];

fn entry(key: &str) -> Result<keyring::Entry, String> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err("key not allowed".into());
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|e| e.to_string())
}

/// Reads a secret from the OS keychain (macOS Keychain, Windows Credential Manager, Secret Service).
#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
    if value.len() > 4096 {
        return Err("value too large".into());
    }
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn open_quick_add(app: &AppHandle) {
    show_main(app);
    let _ = app.emit("remindora://quick-add", ());
}

/// Passed by the login-item launcher: start in the tray without showing the window.
const HIDDEN_ARG: &str = "--hidden";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let quick_add = Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::Space);
    #[cfg(not(target_os = "macos"))]
    let quick_add = Shortcut::new(Some(Modifiers::ALT | Modifiers::CONTROL), Code::Space);
    let handler_shortcut = quick_add.clone();

    tauri::Builder::default()
        // Must be first: a second launch (e.g. from a deep link) focuses the running app.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main(app);
            if let Some(url) = argv.iter().find(|a| a.starts_with("remindora://")) {
                let _ = app.emit("remindora://deep-link", url.clone());
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        // Start with the computer (into the tray, no window) so reminders arrive without opening the app.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &handler_shortcut {
                        open_quick_add(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![secure_get, secure_set, secure_delete])
        .setup(move |app| {
            app.global_shortcut().register(quick_add).ok();

            if std::env::args().any(|a| a == HIDDEN_ARG) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all().ok();
            }

            let quick = MenuItem::with_id(app, "quick-add", "Quick Add…", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Remindora", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quick, &open, &PredefinedMenuItem::separator(app)?, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("window icon"))
                .tooltip("Remindora")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quick-add" => open_quick_add(app),
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps Remindora running in the tray so reminders still arrive.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Remindora")
        .run(|app, event| {
            // macOS: clicking the Dock icon (or opening the app again) while the window is
            // hidden in the tray sends Reopen instead of starting a second instance.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
