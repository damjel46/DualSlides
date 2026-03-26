/// Move the focused window to the next monitor.
/// Windows-only: uses GetForegroundWindow + SetWindowPos.
/// Preserves window size ratio when monitors have different resolutions.

#[cfg(target_os = "windows")]
pub fn move_focused_to_next_monitor() -> Result<(), String> {
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd == HWND::default() {
            return Err("No foreground window".into());
        }

        let mut win_rect = RECT::default();
        GetWindowRect(hwnd, &mut win_rect)
            .map_err(|e| format!("GetWindowRect: {}", e))?;

        let win_cx = (win_rect.left + win_rect.right) / 2;
        let win_cy = (win_rect.top + win_rect.bottom) / 2;
        let win_w = win_rect.right - win_rect.left;
        let win_h = win_rect.bottom - win_rect.top;

        let mut monitors: Vec<MONITORINFO> = Vec::new();

        unsafe extern "system" fn callback(
            hmon: HMONITOR,
            _hdc: HDC,
            _rect: *mut RECT,
            data: LPARAM,
        ) -> windows::core::BOOL {
            let list = &mut *(data.0 as *mut Vec<MONITORINFO>);
            let mut mi = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            let _ = GetMonitorInfoW(hmon, &mut mi);
            list.push(mi);
            windows::core::BOOL(1)
        }

        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(callback),
            LPARAM(&mut monitors as *mut Vec<MONITORINFO> as isize),
        );

        if monitors.len() < 2 {
            return Err("Only one monitor detected".into());
        }

        let current_idx = monitors
            .iter()
            .position(|mi| {
                let r = &mi.rcMonitor;
                win_cx >= r.left && win_cx < r.right && win_cy >= r.top && win_cy < r.bottom
            })
            .unwrap_or(0);

        let next_idx = (current_idx + 1) % monitors.len();

        let src = &monitors[current_idx].rcWork;
        let dst = &monitors[next_idx].rcWork;

        let src_w = (src.right - src.left) as f64;
        let src_h = (src.bottom - src.top) as f64;
        let dst_w = (dst.right - dst.left) as f64;
        let dst_h = (dst.bottom - dst.top) as f64;

        let rel_x = (win_rect.left - src.left) as f64 / src_w;
        let rel_y = (win_rect.top - src.top) as f64 / src_h;
        let rel_w = win_w as f64 / src_w;
        let rel_h = win_h as f64 / src_h;

        let new_x = dst.left + (rel_x * dst_w) as i32;
        let new_y = dst.top + (rel_y * dst_h) as i32;
        let new_w = (rel_w * dst_w) as i32;
        let new_h = (rel_h * dst_h) as i32;

        SetWindowPos(
            hwnd,
            None,
            new_x,
            new_y,
            new_w,
            new_h,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|e| format!("SetWindowPos: {}", e))?;

        log::info!(
            "Window moved from monitor {} to {} ({},{} {}x{})",
            current_idx, next_idx, new_x, new_y, new_w, new_h
        );
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
pub fn move_focused_to_next_monitor() -> Result<(), String> {
    Err("Window mover is only supported on Windows".into())
}
