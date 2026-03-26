/// Pro feature: Monitor profiles for saving/loading configurations.
/// This module is a placeholder for the Pro version.

use crate::slideshow::SlideshowMode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileEntry {
    pub folder_path: String,
    pub interval_secs: u64,
    pub mode: SlideshowMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorProfile {
    pub name: String,
    pub monitors: HashMap<String, ProfileEntry>,
}

/// Save a profile. Pro-only feature placeholder.
pub fn save_profile(_profile: MonitorProfile) -> Result<(), String> {
    Err("This feature requires DualSlide Pro".to_string())
}

/// Load a profile. Pro-only feature placeholder.
pub fn load_profile(_name: &str) -> Result<MonitorProfile, String> {
    Err("This feature requires DualSlide Pro".to_string())
}

/// List all saved profiles. Pro-only feature placeholder.
pub fn list_profiles() -> Result<Vec<String>, String> {
    Err("This feature requires DualSlide Pro".to_string())
}
