use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyBinding {
    pub action: String,
    pub shortcut: String,
}

/// Default hotkey bindings
pub fn default_hotkeys() -> Vec<HotkeyBinding> {
    vec![
        HotkeyBinding {
            action: "next_wallpaper".to_string(),
            shortcut: "Ctrl+Alt+Right".to_string(),
        },
        HotkeyBinding {
            action: "prev_wallpaper".to_string(),
            shortcut: "Ctrl+Alt+Left".to_string(),
        },
        HotkeyBinding {
            action: "toggle_slideshow".to_string(),
            shortcut: "Ctrl+Alt+Space".to_string(),
        },
    ]
}
