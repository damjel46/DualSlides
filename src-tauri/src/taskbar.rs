use std::sync::Mutex;

/// Tracks which monitor indexes have their taskbar hidden,
/// so we can restore them on app exit.
static HIDDEN: Mutex<Vec<usize>> = Mutex::new(Vec::new());

// ── Windows implementation ───────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, FindWindowW, GetWindowRect, IsWindowVisible, ShowWindow,
        SW_HIDE, SW_SHOW,
    };

    /// Find the main taskbar (primary monitor).
    fn find_main_taskbar() -> Option<HWND> {
        unsafe { FindWindowW(w!("Shell_TrayWnd"), None).ok() }
    }

    /// Enumerate all secondary taskbar windows (Shell_SecondaryTrayWnd).
    fn find_secondary_taskbars() -> Vec<HWND> {
        let mut result = Vec::new();
        unsafe {
            let mut prev = HWND::default();
            loop {
                let hwnd = FindWindowExW(None, Some(prev), w!("Shell_SecondaryTrayWnd"), None);
                match hwnd {
                    Ok(h) if !h.is_invalid() => {
                        result.push(h);
                        prev = h;
                    }
                    _ => break,
                }
            }
        }
        result
    }

    /// Get the screen rect of a window.
    fn window_rect(hwnd: HWND) -> Option<RECT> {
        let mut rect = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut rect).ok()?;
        }
        Some(rect)
    }

    /// Check if a rect overlaps with a monitor area.
    fn rect_on_monitor(rect: &RECT, mx: i32, my: i32, mw: u32, mh: u32) -> bool {
        let mx2 = mx + mw as i32;
        let my2 = my + mh as i32;
        let cx = (rect.left + rect.right) / 2;
        let cy = (rect.top + rect.bottom) / 2;
        cx >= mx && cx < mx2 && cy >= my && cy < my2
    }

    /// Find the taskbar HWND for a given monitor by its position/size.
    pub fn find_taskbar_for_monitor(
        monitor_index: usize,
        mx: i32,
        my: i32,
        mw: u32,
        mh: u32,
    ) -> Option<HWND> {
        if monitor_index == 0 {
            return find_main_taskbar();
        }

        let secondaries = find_secondary_taskbars();
        for hwnd in secondaries {
            if let Some(rect) = window_rect(hwnd) {
                if rect_on_monitor(&rect, mx, my, mw, mh) {
                    return Some(hwnd);
                }
            }
        }
        None
    }

    pub fn set_visible(hwnd: HWND, visible: bool) {
        unsafe {
            let _ = ShowWindow(hwnd, if visible { SW_SHOW } else { SW_HIDE });
        }
    }

    pub fn is_visible(hwnd: HWND) -> bool {
        unsafe { IsWindowVisible(hwnd).as_bool() }
    }
}

// ── Public API ───────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub fn set_taskbar_visible(
    monitor_index: usize,
    mx: i32,
    my: i32,
    mw: u32,
    mh: u32,
    visible: bool,
) -> Result<(), String> {
    let hwnd = win::find_taskbar_for_monitor(monitor_index, mx, my, mw, mh)
        .ok_or_else(|| format!("No taskbar found for monitor {}", monitor_index))?;

    win::set_visible(hwnd, visible);

    let mut hidden = HIDDEN.lock().unwrap();
    if visible {
        hidden.retain(|&i| i != monitor_index);
    } else if !hidden.contains(&monitor_index) {
        hidden.push(monitor_index);
    }

    log::info!(
        "Taskbar monitor_{}: {}",
        monitor_index,
        if visible { "shown" } else { "hidden" }
    );
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn set_taskbar_visible(
    _monitor_index: usize,
    _mx: i32,
    _my: i32,
    _mw: u32,
    _mh: u32,
    _visible: bool,
) -> Result<(), String> {
    Err("Taskbar control is only supported on Windows".into())
}

#[cfg(target_os = "windows")]
pub fn get_taskbar_visible(
    monitor_index: usize,
    mx: i32,
    my: i32,
    mw: u32,
    mh: u32,
) -> bool {
    win::find_taskbar_for_monitor(monitor_index, mx, my, mw, mh)
        .map(|hwnd| win::is_visible(hwnd))
        .unwrap_or(true)
}

#[cfg(not(target_os = "windows"))]
pub fn get_taskbar_visible(
    _monitor_index: usize,
    _mx: i32,
    _my: i32,
    _mw: u32,
    _mh: u32,
) -> bool {
    true
}

/// Restore all hidden taskbars. Call on app exit.
#[cfg(target_os = "windows")]
pub fn restore_all(monitors: &[(usize, i32, i32, u32, u32)]) {
    let hidden: Vec<usize> = {
        let h = HIDDEN.lock().unwrap();
        h.clone()
    };

    for &idx in &hidden {
        if let Some(&(_, mx, my, mw, mh)) = monitors.iter().find(|m| m.0 == idx) {
            if let Some(hwnd) = win::find_taskbar_for_monitor(idx, mx, my, mw, mh) {
                win::set_visible(hwnd, true);
                log::info!("Taskbar restored: monitor_{}", idx);
            }
        }
    }

    HIDDEN.lock().unwrap().clear();
}

#[cfg(not(target_os = "windows"))]
pub fn restore_all(_monitors: &[(usize, i32, i32, u32, u32)]) {}

/// Restore hidden taskbars EXCEPT those in the `keep_hidden` list.
/// Used by zen mode to preserve taskbars that were manually hidden before zen mode.
#[cfg(target_os = "windows")]
pub fn restore_except(monitors: &[(usize, i32, i32, u32, u32)], keep_hidden: &[usize]) {
    let hidden: Vec<usize> = {
        let h = HIDDEN.lock().unwrap();
        h.clone()
    };

    for &idx in &hidden {
        if keep_hidden.contains(&idx) {
            log::info!("Taskbar monitor_{}: kept hidden (was hidden before zen mode)", idx);
            continue;
        }
        if let Some(&(_, mx, my, mw, mh)) = monitors.iter().find(|m| m.0 == idx) {
            if let Some(hwnd) = win::find_taskbar_for_monitor(idx, mx, my, mw, mh) {
                win::set_visible(hwnd, true);
                log::info!("Taskbar restored: monitor_{}", idx);
            }
        }
    }

    // Only remove restored entries from HIDDEN; keep the ones that should stay hidden
    let mut h = HIDDEN.lock().unwrap();
    h.retain(|idx| keep_hidden.contains(idx));
}

#[cfg(not(target_os = "windows"))]
pub fn restore_except(_monitors: &[(usize, i32, i32, u32, u32)], _keep_hidden: &[usize]) {}
