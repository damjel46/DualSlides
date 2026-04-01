use std::sync::{Arc, Mutex};
use tauri::{
    image::Image,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

use crate::slideshow::SlideshowEngine;
use tauri::Emitter;

// ── Hardcoded translations ───────────────────────────────────────────
// Mirrors the frontend locale JSON — keeps tray working without JS.

struct TrayStrings {
    settings: &'static str,
    pause: &'static str,
    play: &'static str,
    zen_mode: &'static str,
    quit: &'static str,
}

fn strings_for(locale: &str) -> TrayStrings {
    match locale {
        "ko" => TrayStrings {
            settings: "설정",
            pause: "일시정지",
            play: "재생",
            zen_mode: "감상 모드",
            quit: "종료",
        },
        "ja" => TrayStrings {
            settings: "設定",
            pause: "一時停止",
            play: "再生",
            zen_mode: "Zenモード",
            quit: "終了",
        },
        "zh" => TrayStrings {
            settings: "设置",
            pause: "暂停",
            play: "播放",
            zen_mode: "沉浸模式",
            quit: "退出",
        },
        "es" => TrayStrings {
            settings: "Ajustes",
            pause: "Pausar",
            play: "Reproducir",
            zen_mode: "Modo Zen",
            quit: "Salir",
        },
        _ => TrayStrings {
            settings: "Settings",
            pause: "Pause",
            play: "Play",
            zen_mode: "Zen Mode",
            quit: "Quit",
        },
    }
}

/// Shared locale state so both `build_tray` and `update_tray_locale` can
/// access the current language.
pub type LocaleState = Arc<Mutex<String>>;

pub fn default_locale_state() -> LocaleState {
    Arc::new(Mutex::new("en".to_string()))
}

// ── Build / rebuild tray ─────────────────────────────────────────────

/// (Re-)build the tray icon + menu for the given locale.
/// Called once at startup and again whenever the user changes language.
pub fn build_tray(app: &AppHandle, locale: &str) -> Result<(), Box<dyn std::error::Error>> {
    let s = strings_for(locale);

    // Check if any slideshow is running to decide pause/play label
    let any_running = app
        .try_state::<SlideshowEngine>()
        .map(|engine| {
            engine
                .get_status()
                .values()
                .any(|st| st.is_running)
        })
        .unwrap_or(false);

    let toggle_label = if any_running { s.pause } else { s.play };
    let toggle_id = if any_running { "pause" } else { "play" };

    let zen_active = crate::zen_mode::is_active();
    let zen_label = if zen_active {
        format!("{} ✓", s.zen_mode)
    } else {
        s.zen_mode.to_string()
    };

    let settings_item = MenuItem::with_id(app, "settings", s.settings, true, None::<&str>)?;
    let toggle_item = MenuItem::with_id(app, toggle_id, toggle_label, true, None::<&str>)?;
    let zen_item = MenuItem::with_id(app, "zen", &zen_label, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", s.quit, true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&settings_item, &toggle_item, &zen_item, &separator, &quit_item],
    )?;

    // Remove existing tray icons before rebuilding
    app.remove_tray_by_id("main-tray");

    let icon = {
        let png_bytes = include_bytes!("../icons/32x32.png");
        let img = image::load_from_memory(png_bytes).expect("decode embedded icon");
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        Image::new_owned(rgba.into_raw(), w, h)
    };

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip(if zen_active { "DualSlide — Zen Mode" } else { "DualSlide" })
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_icon_event)
        .build(app)?;

    log::info!("Tray built with locale '{}'", locale);
    Ok(())
}

// ── Menu event handler ───────────────────────────────────────────────

fn handle_menu_event(app: &AppHandle<Wry>, event: MenuEvent) {
    match event.id.as_ref() {
        "settings" => {
            show_main_window(app);
        }
        "pause" => {
            if let Some(engine) = app.try_state::<SlideshowEngine>() {
                engine.pause_all();
            }
            // Rebuild tray to flip label to Play
            let locale = current_locale(app);
            let _ = build_tray(app, &locale);
        }
        "play" => {
            if let Some(engine) = app.try_state::<SlideshowEngine>() {
                if let Err(e) = engine.resume_all() {
                    log::error!("Tray resume_all: {}", e);
                }
            }
            let locale = current_locale(app);
            let _ = build_tray(app, &locale);
        }
        "zen" => {
            let monitors: Vec<(usize, i32, i32, u32, u32)> =
                crate::monitor::get_all_monitors(app)
                    .into_iter()
                    .enumerate()
                    .map(|(i, m)| (i, m.x, m.y, m.width, m.height))
                    .collect();
            match crate::zen_mode::toggle(&monitors) {
                Ok(active) => {
                    let _ = app.emit("zen-mode-changed", active);
                }
                Err(e) => log::error!("Tray zen toggle: {}", e),
            }
            let locale = current_locale(app);
            let _ = build_tray(app, &locale);
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

// ── Tray icon click handler ──────────────────────────────────────────

fn handle_tray_icon_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_main_window(tray.app_handle());
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn current_locale(app: &AppHandle) -> String {
    app.try_state::<LocaleState>()
        .map(|s| s.lock().unwrap().clone())
        .unwrap_or_else(|| "en".to_string())
}
