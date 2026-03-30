use crate::monitor::{self, ImageInfo, MonitorInfo};
use crate::schedule::{Schedule, ScheduleEngine};
use crate::slideshow::{SlideshowEngine, SlideshowMode, SlideshowStatus};
use crate::taskbar;
use crate::tray;
use crate::zen_mode;
use std::collections::HashMap;
use tauri::{Emitter, State};

// ── Monitor & Wallpaper ──────────────────────────────────────────────

#[tauri::command]
pub fn get_monitors(app: tauri::AppHandle) -> Vec<MonitorInfo> {
    monitor::get_all_monitors(&app)
}

#[tauri::command]
pub fn set_wallpaper(monitor_id: String, image_path: String) -> Result<(), String> {
    monitor::set_wallpaper(&monitor_id, &image_path)
}

#[tauri::command]
pub fn get_images_from_folder(folder_path: String) -> Result<Vec<ImageInfo>, String> {
    monitor::get_images_from_folder(&folder_path)
}

// ── Slideshow ────────────────────────────────────────────────────────

#[tauri::command]
pub fn start_slideshow(
    engine: State<'_, SlideshowEngine>,
    monitor_id: String,
    folder_path: String,
    interval_secs: u64,
    mode: SlideshowMode,
) -> Result<(), String> {
    engine.start_slideshow(monitor_id, folder_path, interval_secs, mode)
}

#[tauri::command]
pub fn start_slideshow_files(
    engine: State<'_, SlideshowEngine>,
    monitor_id: String,
    image_paths: Vec<String>,
    interval_secs: u64,
    mode: SlideshowMode,
) -> Result<(), String> {
    engine.start_slideshow_files(monitor_id, image_paths, interval_secs, mode)
}

#[tauri::command]
pub fn start_synced(
    engine: State<'_, SlideshowEngine>,
    monitors_data: Vec<(String, Vec<String>)>,
    interval_secs: u64,
    mode: SlideshowMode,
) -> Result<(), String> {
    engine.start_synced(monitors_data, interval_secs, mode)
}

#[tauri::command]
pub fn stop_slideshow(engine: State<'_, SlideshowEngine>, monitor_id: String) {
    engine.stop_slideshow(&monitor_id);
}

#[tauri::command]
pub fn next_wallpaper(
    engine: State<'_, SlideshowEngine>,
    monitor_id: String,
) -> Result<(), String> {
    engine.next_wallpaper(&monitor_id)
}

#[tauri::command]
pub fn prev_wallpaper(
    engine: State<'_, SlideshowEngine>,
    monitor_id: String,
) -> Result<(), String> {
    engine.prev_wallpaper(&monitor_id)
}

#[tauri::command]
pub fn pause_all(engine: State<'_, SlideshowEngine>) {
    engine.pause_all();
}

#[tauri::command]
pub fn resume_all(engine: State<'_, SlideshowEngine>) -> Result<(), String> {
    engine.resume_all()
}

#[tauri::command]
pub fn get_slideshow_status(
    engine: State<'_, SlideshowEngine>,
) -> HashMap<String, SlideshowStatus> {
    engine.get_status()
}

#[tauri::command]
pub fn get_monitor_slideshow_status(
    engine: State<'_, SlideshowEngine>,
    monitor_id: String,
) -> Option<SlideshowStatus> {
    engine.get_monitor_status(&monitor_id)
}

#[tauri::command]
pub fn sync_restart_all(engine: State<'_, SlideshowEngine>) -> Result<(), String> {
    engine.sync_restart_all()
}

// ── Pin ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn toggle_pin_all(engine: State<'_, SlideshowEngine>) -> bool {
    engine.toggle_pin_all()
}

#[tauri::command]
pub fn is_all_pinned(engine: State<'_, SlideshowEngine>) -> bool {
    engine.is_all_pinned()
}

// ── Taskbar ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_taskbar_visible(
    monitor_index: usize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    visible: bool,
) -> Result<(), String> {
    taskbar::set_taskbar_visible(monitor_index, x, y, width, height, visible)
}

#[tauri::command]
pub fn get_taskbar_visible(
    monitor_index: usize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> bool {
    taskbar::get_taskbar_visible(monitor_index, x, y, width, height)
}

// ── Zen Mode ────────────────────────────────────────────────────────

#[tauri::command]
pub fn toggle_zen_mode(app: tauri::AppHandle) -> Result<bool, String> {
    let monitors: Vec<(usize, i32, i32, u32, u32)> = monitor::get_all_monitors(&app)
        .into_iter()
        .enumerate()
        .map(|(i, m)| (i, m.x, m.y, m.width, m.height))
        .collect();
    let active = zen_mode::toggle(&monitors)?;
    let _ = app.emit("zen-mode-changed", active);
    Ok(active)
}

#[tauri::command]
pub fn is_zen_mode_active() -> bool {
    zen_mode::is_active()
}

// ── Schedule ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_schedule(
    app: tauri::AppHandle,
    engine: State<'_, ScheduleEngine>,
    schedule: Schedule,
) -> Result<(), String> {
    let should_start = schedule.enabled;
    engine.set_schedule(schedule);
    if should_start {
        engine.start_timer(app);
    }
    Ok(())
}

#[tauri::command]
pub fn get_schedule(engine: State<'_, ScheduleEngine>) -> Schedule {
    engine.get_schedule()
}

#[tauri::command]
pub fn enable_schedule(
    app: tauri::AppHandle,
    engine: State<'_, ScheduleEngine>,
    enabled: bool,
) -> Result<(), String> {
    engine.enable(enabled);
    if enabled {
        engine.start_timer(app);
    }
    Ok(())
}

#[tauri::command]
pub fn get_active_schedule_slot(engine: State<'_, ScheduleEngine>) -> Option<String> {
    engine.get_active_slot()
}

// ── Tray ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn update_tray_locale(
    app: tauri::AppHandle,
    locale_state: State<'_, tray::LocaleState>,
    locale: String,
) -> Result<(), String> {
    // Persist to shared state
    *locale_state.lock().unwrap() = locale.clone();
    // Rebuild tray with new locale
    tray::build_tray(&app, &locale).map_err(|e| format!("Failed to update tray: {}", e))
}
