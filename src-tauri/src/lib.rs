mod commands;
mod hotkey;
mod monitor;
mod profiles;
mod slideshow;
mod taskbar;
mod tray;

use slideshow::SlideshowEngine;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Plugins ──────────────────────────────────────────────
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Another instance tried to launch — focus the existing window.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            log::info!("Second instance blocked — focused existing window");
        }))
        // ── Setup ────────────────────────────────────────────────
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Managed state
            app.manage(SlideshowEngine::new());
            app.manage(tray::default_locale_state());

            // Build system tray (default locale = en)
            tray::build_tray(app.handle(), "en")
                .map_err(|e| format!("Tray init failed: {}", e))?;

            // Handle --minimized flag (autostart scenario)
            let minimized = std::env::args().any(|a| a == "--minimized");
            if minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                log::info!("Started minimized to tray (--minimized flag)");
            }

            Ok(())
        })
        // ── Commands ─────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            commands::get_monitors,
            commands::set_wallpaper,
            commands::get_images_from_folder,
            commands::start_slideshow,
            commands::start_slideshow_files,
            commands::start_synced,
            commands::stop_slideshow,
            commands::next_wallpaper,
            commands::prev_wallpaper,
            commands::pause_all,
            commands::resume_all,
            commands::get_slideshow_status,
            commands::get_monitor_slideshow_status,
            commands::sync_restart_all,
            commands::update_tray_locale,
            commands::set_taskbar_visible,
            commands::get_taskbar_visible,
        ])
        // ── Window close → hide to tray ──────────────────────────
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Restore all hidden taskbars before exit
                let monitors: Vec<(usize, i32, i32, u32, u32)> = monitor::get_all_monitors(app)
                    .into_iter()
                    .enumerate()
                    .map(|(i, m)| (i, m.x, m.y, m.width, m.height))
                    .collect();
                taskbar::restore_all(&monitors);
            }
        });
}
