/// Monitor profiles for saving/loading configurations.
/// TODO: Implement profile persistence.

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

/// Save a profile. TODO: implement.
pub fn save_profile(_profile: MonitorProfile) -> Result<(), String> {
    Err("Profile saving not yet implemented".to_string())
}

/// Load a profile. TODO: implement.
pub fn load_profile(_name: &str) -> Result<MonitorProfile, String> {
    Err("Profile loading not yet implemented".to_string())
}

/// List all saved profiles. TODO: implement.
pub fn list_profiles() -> Result<Vec<String>, String> {
    Err("Profile listing not yet implemented".to_string())
}
