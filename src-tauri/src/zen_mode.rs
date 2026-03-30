use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static ZEN_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Tracks whether we triggered "Show Desktop" so we can undo it
static WINDOWS_HIDDEN: AtomicBool = AtomicBool::new(false);

// ── Windows implementation ───────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win {
    use windows::core::w;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_D, VK_LWIN, VK_MENU,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateCursor, FindWindowExW, FindWindowW, IsWindowVisible,
        SetSystemCursor, ShowWindow, SystemParametersInfoW,
        OCR_APPSTARTING, OCR_CROSS, OCR_HAND, OCR_IBEAM, OCR_NO, OCR_NORMAL,
        OCR_SIZEALL, OCR_SIZENESW, OCR_SIZENS, OCR_SIZENWSE, OCR_SIZEWE,
        OCR_UP, OCR_WAIT, SPI_SETCURSORS, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
        SW_HIDE, SW_SHOW,
    };

    // ── Desktop icons ───────────────────────────────────────────────

    fn find_shell_defview() -> Option<HWND> {
        unsafe {
            if let Ok(progman) = FindWindowW(w!("Progman"), None) {
                if let Ok(defview) =
                    FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None)
                {
                    return Some(defview);
                }
            }

            let mut prev = HWND::default();
            loop {
                match FindWindowExW(None, Some(prev), w!("WorkerW"), None) {
                    Ok(h) if !h.is_invalid() => {
                        if let Ok(defview) =
                            FindWindowExW(Some(h), None, w!("SHELLDLL_DefView"), None)
                        {
                            return Some(defview);
                        }
                        prev = h;
                    }
                    _ => break,
                }
            }
            None
        }
    }

    pub fn set_desktop_icons_visible(visible: bool) {
        if let Some(defview) = find_shell_defview() {
            unsafe {
                if let Ok(listview) =
                    FindWindowExW(Some(defview), None, w!("SysListView32"), None)
                {
                    let _ = ShowWindow(listview, if visible { SW_SHOW } else { SW_HIDE });
                    log::info!(
                        "Desktop icons: {}",
                        if visible { "shown" } else { "hidden" }
                    );
                }
            }
        } else {
            log::warn!("Could not find SHELLDLL_DefView for desktop icons");
        }
    }

    // ── Cursor hide / restore ───────────────────────────────────────

    const CURSOR_IDS: &[u32] = &[
        OCR_NORMAL.0,
        OCR_IBEAM.0,
        OCR_WAIT.0,
        OCR_CROSS.0,
        OCR_UP.0,
        OCR_SIZENWSE.0,
        OCR_SIZENESW.0,
        OCR_SIZEWE.0,
        OCR_SIZENS.0,
        OCR_SIZEALL.0,
        OCR_NO.0,
        OCR_HAND.0,
        OCR_APPSTARTING.0,
    ];

    pub fn hide_cursor() {
        unsafe {
            let and_mask = [0xFFu8; 128]; // 32x32, all transparent
            let xor_mask = [0x00u8; 128]; // 32x32, no pixels

            for &id in CURSOR_IDS {
                if let Ok(blank) = CreateCursor(
                    None,
                    0,
                    0,
                    32,
                    32,
                    and_mask.as_ptr() as *const _,
                    xor_mask.as_ptr() as *const _,
                ) {
                    let cursor_id =
                        windows::Win32::UI::WindowsAndMessaging::SYSTEM_CURSOR_ID(id);
                    let _ = SetSystemCursor(blank, cursor_id);
                }
            }
            log::info!("Cursor hidden");
        }
    }

    pub fn restore_cursor() {
        unsafe {
            // SPI_SETCURSORS reloads cursors from registry → restores defaults
            let _ = SystemParametersInfoW(
                SPI_SETCURSORS,
                0,
                None,
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            );
            log::info!("Cursor restored");
        }
    }

    // ── Minimize / restore all windows ──────────────────────────────
    // Simulates Win+D keystroke to toggle "Show Desktop"

    fn make_key_input(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// Simulate Win+D to toggle "Show Desktop".
    /// First releases any held modifier keys (from the hotkey combo) to avoid conflicts.
    pub fn toggle_show_desktop() {
        // Small delay to let the user release hotkey keys
        std::thread::sleep(std::time::Duration::from_millis(150));

        let inputs = [
            // Release modifiers that might be held from Ctrl+Alt+Z hotkey
            make_key_input(VK_CONTROL, true),
            make_key_input(VK_MENU, true),    // Alt
            make_key_input(VIRTUAL_KEY(b'Z' as u16), true),
            // Now send clean Win+D
            make_key_input(VK_LWIN, false),
            make_key_input(VK_D, false),
            make_key_input(VK_D, true),
            make_key_input(VK_LWIN, true),
        ];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
        log::info!("Sent Win+D (Show Desktop)");
    }
}

// ── Public API ───────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub fn toggle(monitors: &[(usize, i32, i32, u32, u32)]) -> Result<bool, String> {
    let new_state = !ZEN_ACTIVE.load(Ordering::SeqCst);

    if new_state {
        // Enable: hide taskbars + icons first, then minimize windows
        for &(idx, mx, my, mw, mh) in monitors {
            let _ = crate::taskbar::set_taskbar_visible(idx, mx, my, mw, mh, false);
        }
        win::set_desktop_icons_visible(false);
        win::hide_cursor();

        // Win+D to minimize all windows (has internal delay for modifier key release)
        win::toggle_show_desktop();
        WINDOWS_HIDDEN.store(true, Ordering::SeqCst);
    } else {
        // Disable: restore windows first, then taskbars + icons
        if WINDOWS_HIDDEN.load(Ordering::SeqCst) {
            win::toggle_show_desktop();
            WINDOWS_HIDDEN.store(false, Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(300));
        }

        crate::taskbar::restore_all(monitors);
        win::set_desktop_icons_visible(true);
        win::restore_cursor();
    }

    ZEN_ACTIVE.store(new_state, Ordering::SeqCst);
    log::info!("Zen mode: {}", if new_state { "ON" } else { "OFF" });
    Ok(new_state)
}

#[cfg(not(target_os = "windows"))]
pub fn toggle(_monitors: &[(usize, i32, i32, u32, u32)]) -> Result<bool, String> {
    Err("Zen mode is only supported on Windows".into())
}

pub fn is_active() -> bool {
    ZEN_ACTIVE.load(Ordering::SeqCst)
}

/// Restore everything if zen mode is active. Call on app exit.
#[cfg(target_os = "windows")]
pub fn restore_on_exit(monitors: &[(usize, i32, i32, u32, u32)]) {
    if ZEN_ACTIVE.load(Ordering::SeqCst) {
        // Restore taskbars first so Show Desktop undo works
        crate::taskbar::restore_all(monitors);
        std::thread::sleep(std::time::Duration::from_millis(200));

        if WINDOWS_HIDDEN.load(Ordering::SeqCst) {
            win::toggle_show_desktop();
            WINDOWS_HIDDEN.store(false, Ordering::SeqCst);
        }
        win::set_desktop_icons_visible(true);
        win::restore_cursor();
        ZEN_ACTIVE.store(false, Ordering::SeqCst);
        log::info!("Zen mode: restored on exit");
    }
}

#[cfg(not(target_os = "windows"))]
pub fn restore_on_exit(_monitors: &[(usize, i32, i32, u32, u32)]) {}
