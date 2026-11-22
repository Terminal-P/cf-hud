//! CF HUD desktop shell.
//!
//! The React frontend owns all Codeforces API traffic and rendering. The Rust
//! side only wires up the Tauri plugins the HUD needs:
//!
//! * `tauri-plugin-global-shortcut` — the frontend registers `Ctrl+Shift+H`
//!   to toggle the overlay without focusing the window.
//! * `tauri-plugin-notification` — native notifications for contest events.
//! * `tauri-plugin-window-state` — remembers the HUD's position and size across
//!   restarts (Rust-only; it needs no JavaScript bindings or capabilities).
//!
//! Capabilities for the `main` window live in `capabilities/default.json`.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running the CF HUD tauri application");
}
