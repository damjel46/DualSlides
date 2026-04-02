use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tokio::time::{self, Duration};
use tokio_util::sync::CancellationToken;

use crate::slideshow::SlideshowEngine;

pub struct FullscreenDetector {
    enabled: Arc<AtomicBool>,
    auto_paused: Arc<AtomicBool>,
    cancel_token: Mutex<Option<CancellationToken>>,
}

impl FullscreenDetector {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            auto_paused: Arc::new(AtomicBool::new(false)),
            cancel_token: Mutex::new(None),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn is_auto_paused(&self) -> bool {
        self.auto_paused.load(Ordering::Relaxed)
    }

    /// Clear auto-pause state (called when user manually pauses/resumes).
    pub fn clear_auto_pause(&self) {
        self.auto_paused.store(false, Ordering::Relaxed);
    }

    pub fn set_enabled(&self, enabled: bool, app_handle: tauri::AppHandle) {
        self.enabled.store(enabled, Ordering::Relaxed);

        // Stop existing loop
        {
            let mut token = self.cancel_token.lock().unwrap();
            if let Some(t) = token.take() {
                t.cancel();
            }
        }

        if !enabled {
            // If we were auto-paused, resume before disabling
            if self.auto_paused.swap(false, Ordering::Relaxed) {
                let engine = app_handle.state::<SlideshowEngine>();
                let _ = engine.resume_all();
                log::info!("Fullscreen detect disabled — auto-resumed slideshow");
            }
            log::info!("Fullscreen detection disabled");
            return;
        }

        log::info!("Fullscreen detection enabled");

        let token = CancellationToken::new();
        *self.cancel_token.lock().unwrap() = Some(token.clone());

        let auto_paused = self.auto_paused.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = time::sleep(Duration::from_millis(2500)) => {}
                    _ = token.cancelled() => { break; }
                }
                if token.is_cancelled() { break; }

                // Skip detection while zen mode is active
                if crate::zen_mode::is_active() {
                    continue;
                }

                let is_fullscreen = tokio::task::spawn_blocking(|| {
                    detect_fullscreen_app()
                }).await.unwrap_or(false);

                if is_fullscreen && !auto_paused.load(Ordering::Relaxed) {
                    // Fullscreen detected — pause
                    let engine = app_handle.state::<SlideshowEngine>();
                    // Only pause if something is actually running
                    let has_running = engine.get_status().values().any(|s| s.is_running);
                    if has_running {
                        engine.pause_all();
                        auto_paused.store(true, Ordering::Relaxed);
                        log::info!("Fullscreen app detected — slideshow auto-paused");
                    }
                } else if !is_fullscreen && auto_paused.load(Ordering::Relaxed) {
                    // Fullscreen exited — resume
                    let engine = app_handle.state::<SlideshowEngine>();
                    let _ = engine.resume_all();
                    auto_paused.store(false, Ordering::Relaxed);
                    log::info!("Fullscreen app exited — slideshow auto-resumed");
                }
            }
        });
    }
}

/// Check if the current foreground window is fullscreen on any monitor.
#[cfg(target_os = "windows")]
fn detect_fullscreen_app() -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetDesktopWindow, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return false;
        }

        // Exclude desktop window
        let desktop = GetDesktopWindow();
        if hwnd == desktop {
            return false;
        }

        // Exclude our own process
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            return false;
        }

        // Get window rect
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }

        // Get monitor info for the monitor this window is on
        let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(hmon, &mut mi).as_bool() {
            return false;
        }

        // Compare window rect against full monitor rect (including taskbar area)
        let mon = mi.rcMonitor;
        rect.left <= mon.left
            && rect.top <= mon.top
            && rect.right >= mon.right
            && rect.bottom >= mon.bottom
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_fullscreen_app() -> bool {
    false
}
