use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::time::{self, Duration};
use tokio_util::sync::CancellationToken;

use crate::monitor;

// ── Public types ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SlideshowMode {
    Sequential,
    Shuffle,
}

/// Serialisable status exposed to the frontend via `get_status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideshowStatus {
    pub is_running: bool,
    pub current_image: Option<String>,
    pub current_index: usize,
    pub total_images: usize,
    pub interval_secs: u64,
    pub mode: SlideshowMode,
    pub is_pinned: bool,
}

// ── Internal per-monitor state ───────────────────────────────────────

struct MonitorSlideshow {
    folder_path: String,
    /// Image *paths* only — never loaded into memory.
    images: Vec<String>,
    current_index: usize,
    interval_secs: u64,
    mode: SlideshowMode,
    is_running: bool,
    is_pinned: bool,
    cancel_token: Option<CancellationToken>,
}

impl MonitorSlideshow {
    fn to_status(&self) -> SlideshowStatus {
        SlideshowStatus {
            is_running: self.is_running,
            current_image: self.images.get(self.current_index).cloned(),
            current_index: self.current_index,
            total_images: self.images.len(),
            interval_secs: self.interval_secs,
            mode: self.mode.clone(),
            is_pinned: self.is_pinned,
        }
    }
}

// ── Engine ────────────────────────────────────────────────────────────

pub struct SlideshowEngine {
    monitors: Arc<Mutex<HashMap<String, MonitorSlideshow>>>,
}

impl SlideshowEngine {
    pub fn new() -> Self {
        Self {
            monitors: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    // ── 1. start ─────────────────────────────────────────────────────

    pub fn start_slideshow(
        &self,
        monitor_id: String,
        folder_path: String,
        interval_secs: u64,
        mode: SlideshowMode,
    ) -> Result<(), String> {
        // Load image paths from folder
        let mut images: Vec<String> = monitor::get_images_from_folder(&folder_path)?
            .into_iter()
            .map(|img| img.path)
            .collect();

        if images.is_empty() {
            let msg = format!("No supported images in '{}'", folder_path);
            log::error!("{}", msg);
            return Err(msg);
        }

        // Preserve index if same images
        let resume_index = {
            let map = self.monitors.lock().unwrap();
            map.get(&monitor_id)
                .filter(|ms| ms.images == images)
                .map(|ms| ms.current_index)
                .unwrap_or(0)
        };

        self.stop_slideshow(&monitor_id);

        if mode == SlideshowMode::Shuffle {
            let mut rng = rand::thread_rng();
            images.shuffle(&mut rng);
        }

        let token = CancellationToken::new();
        let total = images.len();
        let start_index = resume_index.min(total.saturating_sub(1));

        {
            let mut map = self.monitors.lock().unwrap();
            map.insert(
                monitor_id.clone(),
                MonitorSlideshow {
                    folder_path: folder_path.clone(),
                    images: images.clone(),
                    current_index: start_index,
                    interval_secs,
                    mode: mode.clone(),
                    is_running: true,
                    is_pinned: false,
                    cancel_token: Some(token.clone()),
                },
            );
        }

        log::info!(
            "Slideshow started: {} | {} images | {}s | {:?} | resume@{}",
            monitor_id, total, interval_secs, mode, start_index
        );

        self.spawn_timer(monitor_id, images, interval_secs, start_index, token);
        Ok(())
    }

    // ── 1b. start from explicit file list ──────────────────────────

    pub fn start_slideshow_files(
        &self,
        monitor_id: String,
        image_paths: Vec<String>,
        interval_secs: u64,
        mode: SlideshowMode,
    ) -> Result<(), String> {
        if image_paths.is_empty() {
            return Err("No images provided".into());
        }

        // Check if we can resume: same image set (possibly different order)
        let (images, start_index) = {
            let map = self.monitors.lock().unwrap();
            if let Some(ms) = map.get(&monitor_id) {
                // Same set of images? (compare sorted to ignore order)
                let mut old_sorted = ms.images.clone();
                let mut new_sorted = image_paths.clone();
                old_sorted.sort();
                new_sorted.sort();

                if old_sorted == new_sorted {
                    // Resume: keep the existing order and index
                    (ms.images.clone(), ms.current_index.min(ms.images.len().saturating_sub(1)))
                } else {
                    // New images — shuffle if needed, start from 0
                    let mut imgs = image_paths;
                    if mode == SlideshowMode::Shuffle {
                        let mut rng = rand::thread_rng();
                        imgs.shuffle(&mut rng);
                    }
                    (imgs, 0)
                }
            } else {
                // First time — shuffle if needed
                let mut imgs = image_paths;
                if mode == SlideshowMode::Shuffle {
                    let mut rng = rand::thread_rng();
                    imgs.shuffle(&mut rng);
                }
                (imgs, 0)
            }
        };

        self.stop_slideshow(&monitor_id);

        let token = CancellationToken::new();
        let total = images.len();

        {
            let mut map = self.monitors.lock().unwrap();
            map.insert(
                monitor_id.clone(),
                MonitorSlideshow {
                    folder_path: String::new(),
                    images: images.clone(),
                    current_index: start_index,
                    interval_secs,
                    mode: mode.clone(),
                    is_running: true,
                    is_pinned: false,
                    cancel_token: Some(token.clone()),
                },
            );
        }

        log::info!(
            "Slideshow (files) started: {} | {} images | {}s | {:?}",
            monitor_id, total, interval_secs, mode
        );

        self.spawn_timer(monitor_id, images, interval_secs, start_index, token);
        Ok(())
    }

    /// Shared async timer loop for both start methods.
    /// Uses tokio::time::interval for drift-free absolute-time ticks.
    /// Pre-converts next image to BMP during wait so swap is instant.
    fn spawn_timer(
        &self,
        monitor_id: String,
        images: Vec<String>,
        interval_secs: u64,
        start_index: usize,
        token: CancellationToken,
    ) {
        let monitors = self.monitors.clone();
        let mid = monitor_id;
        let total = images.len();

        tauri::async_runtime::spawn(async move {
            let mut index = start_index;
            let interval_dur = Duration::from_secs(interval_secs);

            // Pre-convert current image
            {
                let path = images[index % total].clone();
                let _ = tokio::task::spawn_blocking(move || {
                    monitor::ensure_bmp(&path)
                }).await;
            }

            loop {
                // Check if pinned — skip wallpaper change but keep timer running
                let pinned = {
                    let map = monitors.lock().unwrap();
                    map.get(&mid).map(|ms| ms.is_pinned).unwrap_or(false)
                };

                if !pinned {
                    // Apply wallpaper immediately
                    let wp_mid = mid.clone();
                    let wp_path = images[index % total].clone();
                    let wp_result = tokio::task::spawn_blocking(move || {
                        monitor::set_wallpaper(&wp_mid, &wp_path)
                    }).await;

                    match wp_result {
                        Ok(Err(e)) => log::error!("[{}] set_wallpaper failed: {}", mid, e),
                        Err(e) => log::error!("[{}] spawn_blocking panic: {}", mid, e),
                        _ => {}
                    }

                    // Update shared state
                    {
                        let mut map = monitors.lock().unwrap();
                        if let Some(ms) = map.get_mut(&mid) {
                            ms.current_index = index % total;
                        }
                    }

                    // Pre-convert NEXT image in background
                    let next_path = images[(index + 1) % total].clone();
                    tokio::task::spawn_blocking(move || {
                        let _ = monitor::ensure_bmp(&next_path);
                    });

                    index += 1;
                }

                // Wait for interval or cancel
                tokio::select! {
                    _ = time::sleep(interval_dur) => {}
                    _ = token.cancelled() => { break; }
                }

                if token.is_cancelled() { break; }
            }

            // Mark stopped — only if our token is still the active one
            // (a new timer may have already replaced us via update_settings)
            let mut map = monitors.lock().unwrap();
            if let Some(ms) = map.get_mut(&mid) {
                let is_our_token = ms.cancel_token.as_ref()
                    .map(|t| t.is_cancelled())
                    .unwrap_or(true);
                if is_our_token {
                    ms.is_running = false;
                    ms.cancel_token = None;
                    log::info!("Slideshow stopped: {}", mid);
                }
            }
        });
    }

    // ── 2. stop ──────────────────────────────────────────────────────

    pub fn stop_slideshow(&self, monitor_id: &str) {
        let mut map = self.monitors.lock().unwrap();
        if let Some(ms) = map.get_mut(monitor_id) {
            if let Some(token) = ms.cancel_token.take() {
                token.cancel();
                log::info!("Slideshow cancel sent: {}", monitor_id);
            }
            ms.is_running = false;
        }
    }

    // ── 2b. update settings on a running slideshow ────────────────────

    /// Update interval and/or mode on a running slideshow without losing
    /// the current position. Internally stops the old timer and spawns a
    /// new one with the updated settings.
    pub fn update_settings(
        &self,
        monitor_id: String,
        interval_secs: u64,
        mode: SlideshowMode,
        image_paths: Option<Vec<String>>,
    ) -> Result<(), String> {
        let (images, current_index, was_pinned, folder_path) = {
            let map = self.monitors.lock().unwrap();
            let ms = map
                .get(&monitor_id)
                .ok_or_else(|| format!("No slideshow for {}", monitor_id))?;
            if !ms.is_running {
                return Err("Slideshow is not running".into());
            }
            (ms.images.clone(), ms.current_index, ms.is_pinned, ms.folder_path.clone())
        };

        // Use new image list if provided, otherwise keep existing
        let base_images = image_paths.unwrap_or(images);
        let base_index = if base_images.len() != {
            let map = self.monitors.lock().unwrap();
            map.get(&monitor_id).map(|ms| ms.images.len()).unwrap_or(0)
        } {
            0 // Reset index when image list changed
        } else {
            current_index
        };

        // Re-shuffle if Shuffle mode, reset index
        let (final_images, final_index) = if mode == SlideshowMode::Shuffle {
            let mut imgs = base_images;
            let mut rng = rand::thread_rng();
            imgs.shuffle(&mut rng);
            (imgs, 0)
        } else {
            (base_images, base_index)
        };

        // Cancel old timer only (do NOT mark is_running = false)
        {
            let mut map = self.monitors.lock().unwrap();
            if let Some(ms) = map.get_mut(&monitor_id) {
                if let Some(token) = ms.cancel_token.take() {
                    token.cancel();
                }
            }
        }

        // Spawn new timer with updated settings
        let token = CancellationToken::new();
        {
            let mut map = self.monitors.lock().unwrap();
            map.insert(
                monitor_id.clone(),
                MonitorSlideshow {
                    folder_path,
                    images: final_images.clone(),
                    current_index: final_index,
                    interval_secs,
                    mode: mode.clone(),
                    is_running: true,
                    is_pinned: was_pinned,
                    cancel_token: Some(token.clone()),
                },
            );
        }

        log::info!(
            "Slideshow settings updated: {} | {}s | {:?}",
            monitor_id, interval_secs, mode
        );

        self.spawn_timer(monitor_id, final_images, interval_secs, final_index, token);
        Ok(())
    }

    // ── 3. next / prev ───────────────────────────────────────────────

    pub fn next_wallpaper(&self, monitor_id: &str) -> Result<(), String> {
        let mut map = self.monitors.lock().unwrap();
        let ms = map
            .get_mut(monitor_id)
            .ok_or_else(|| format!("No slideshow for {}", monitor_id))?;

        if ms.images.is_empty() {
            return Err("Image list is empty".into());
        }

        if ms.mode == SlideshowMode::Shuffle && ms.images.len() > 1 {
            // Pick a random index different from current
            let mut rng = rand::thread_rng();
            let mut next = ms.current_index;
            while next == ms.current_index {
                next = rng.gen_range(0..ms.images.len());
            }
            ms.current_index = next;
        } else {
            ms.current_index = (ms.current_index + 1) % ms.images.len();
        }
        let idx = ms.current_index;
        let path = ms.images[idx].clone();
        drop(map); // release lock before I/O

        monitor::set_wallpaper(monitor_id, &path)?;
        log::info!("[{}] next → index {}", monitor_id, idx);
        Ok(())
    }

    pub fn prev_wallpaper(&self, monitor_id: &str) -> Result<(), String> {
        let mut map = self.monitors.lock().unwrap();
        let ms = map
            .get_mut(monitor_id)
            .ok_or_else(|| format!("No slideshow for {}", monitor_id))?;

        if ms.images.is_empty() {
            return Err("Image list is empty".into());
        }

        if ms.mode == SlideshowMode::Shuffle && ms.images.len() > 1 {
            // Pick a random index different from current
            let mut rng = rand::thread_rng();
            let mut next = ms.current_index;
            while next == ms.current_index {
                next = rng.gen_range(0..ms.images.len());
            }
            ms.current_index = next;
        } else {
            ms.current_index = if ms.current_index == 0 {
                ms.images.len() - 1
            } else {
                ms.current_index - 1
            };
        }
        let path = ms.images[ms.current_index].clone();
        drop(map);

        monitor::set_wallpaper(monitor_id, &path)?;
        log::info!("[{}] prev (shuffle random)", monitor_id);
        Ok(())
    }

    // ── 4. pause_all / resume_all ────────────────────────────────────

    pub fn pause_all(&self) {
        let mut map = self.monitors.lock().unwrap();
        for (mid, ms) in map.iter_mut() {
            if let Some(token) = ms.cancel_token.take() {
                token.cancel();
                ms.is_running = false;
                log::info!("Paused: {}", mid);
            }
        }
    }

    /// Re-start every monitor that was previously configured (images list
    /// is still present) but is currently stopped.
    pub fn resume_all(&self) -> Result<(), String> {
        // Collect existing image lists for stopped monitors
        let to_resume: Vec<(String, Vec<String>, u64, SlideshowMode)> = {
            let map = self.monitors.lock().unwrap();
            map.iter()
                .filter(|(_, ms)| !ms.is_running && !ms.images.is_empty())
                .map(|(mid, ms)| {
                    (
                        mid.clone(),
                        ms.images.clone(),
                        ms.interval_secs,
                        ms.mode.clone(),
                    )
                })
                .collect()
        };

        for (mid, images, interval, mode) in to_resume {
            self.start_slideshow_files(mid, images, interval, mode)?;
        }
        Ok(())
    }

    // ── 5. start_synced — start multiple monitors in ONE task ──────

    /// Start multiple monitors from a single shared timer so they are
    /// perfectly in sync from the very first tick.
    pub fn start_synced(
        &self,
        monitors_data: Vec<(String, Vec<String>)>,
        interval_secs: u64,
        mode: SlideshowMode,
    ) -> Result<(), String> {
        let input: Vec<(String, Vec<String>)> = monitors_data
            .into_iter()
            .filter(|(_, imgs)| !imgs.is_empty())
            .collect();

        if input.is_empty() {
            return Err("No images for any monitor".into());
        }

        // Read resume indexes before stopping
        let resume_indexes: Vec<(String, Vec<String>, usize)> = {
            let map = self.monitors.lock().unwrap();
            input.into_iter().map(|(mid, new_images)| {
                let resume_idx = if let Some(ms) = map.get(&mid) {
                    let mut old_sorted = ms.images.clone();
                    let mut new_sorted = new_images.clone();
                    old_sorted.sort();
                    new_sorted.sort();
                    if old_sorted == new_sorted {
                        ms.current_index.min(ms.images.len().saturating_sub(1))
                    } else {
                        0
                    }
                } else {
                    0
                };
                (mid, new_images, resume_idx)
            }).collect()
        };

        // Stop all existing
        for (mid, _, _) in &resume_indexes {
            self.stop_slideshow(mid);
        }

        // Use max resume index so all monitors are aligned
        let global_index = resume_indexes.iter().map(|(_, _, i)| *i).max().unwrap_or(0);

        let token = CancellationToken::new();

        // Build entries with preserved images (keep existing order for shuffle resume)
        let entries: Vec<(String, Vec<String>)> = {
            let map = self.monitors.lock().unwrap();
            resume_indexes.iter().map(|(mid, new_images, _)| {
                // If same image set exists in engine, use its order (preserves shuffle)
                if let Some(ms) = map.get(mid.as_str()) {
                    let mut old_sorted = ms.images.clone();
                    let mut new_sorted = new_images.clone();
                    old_sorted.sort();
                    new_sorted.sort();
                    if old_sorted == new_sorted {
                        return (mid.clone(), ms.images.clone());
                    }
                }
                // New images — shuffle if needed
                let mut imgs = new_images.clone();
                if mode == SlideshowMode::Shuffle {
                    let mut rng = rand::thread_rng();
                    imgs.shuffle(&mut rng);
                }
                (mid.clone(), imgs)
            }).collect()
        };

        // Register state
        {
            let mut map = self.monitors.lock().unwrap();
            for (mid, images) in &entries {
                map.insert(
                    mid.clone(),
                    MonitorSlideshow {
                        folder_path: String::new(),
                        images: images.clone(),
                        current_index: global_index,
                        interval_secs,
                        mode: mode.clone(),
                        is_running: true,
                        is_pinned: false,
                        cancel_token: Some(token.clone()),
                    },
                );
            }
        }

        log::info!(
            "Synced start: {} monitors, {}s interval, {:?}, resume@{}",
            entries.len(), interval_secs, mode, global_index
        );

        // Single shared timer task
        let monitors_state = self.monitors.clone();

        tauri::async_runtime::spawn(async move {
            let mut index = global_index;

            // Pre-convert current images at resume index
            {
                let mut pre = Vec::new();
                for (_, images) in &entries {
                    if images.is_empty() { continue; }
                    let p = images[index % images.len()].clone();
                    pre.push(tokio::task::spawn_blocking(move || {
                        let _ = monitor::ensure_bmp(&p);
                    }));
                }
                for h in pre { let _ = h.await; }
            }

            let mut ticker = time::interval(Duration::from_secs(interval_secs));
            ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = token.cancelled() => { break; }
                }
                if token.is_cancelled() { break; }

                // Check which monitors are pinned
                let pinned_set: std::collections::HashSet<String> = {
                    let map = monitors_state.lock().unwrap();
                    entries.iter()
                        .filter(|(mid, _)| map.get(mid.as_str()).map(|ms| ms.is_pinned).unwrap_or(false))
                        .map(|(mid, _)| mid.clone())
                        .collect()
                };

                // All unpinned monitors in one blocking call
                let pairs: Vec<(String, String)> = entries
                    .iter()
                    .filter(|(mid, imgs)| !imgs.is_empty() && !pinned_set.contains(mid))
                    .map(|(mid, imgs)| (mid.clone(), imgs[index % imgs.len()].clone()))
                    .collect();

                if !pairs.is_empty() {
                    let wp_result = tokio::task::spawn_blocking(move || {
                        let mut errors = Vec::new();
                        for (mid, path) in &pairs {
                            if let Err(e) = monitor::set_wallpaper(mid, path) {
                                errors.push((mid.clone(), e));
                            }
                        }
                        errors
                    }).await;

                    if let Ok(errors) = wp_result {
                        for (mid, e) in errors {
                            log::error!("[{}] set_wallpaper failed: {}", mid, e);
                        }
                    }
                }

                // Update state for unpinned monitors only
                {
                    let mut map = monitors_state.lock().unwrap();
                    for (mid, images) in &entries {
                        if pinned_set.contains(mid) { continue; }
                        if let Some(ms) = map.get_mut(mid.as_str()) {
                            ms.current_index = index % images.len();
                        }
                    }
                }

                // Pre-convert next for unpinned monitors
                for (mid, images) in &entries {
                    if pinned_set.contains(mid) { continue; }
                    let total = images.len();
                    if total == 0 { continue; }
                    let p = images[(index + 1) % total].clone();
                    tokio::task::spawn_blocking(move || {
                        let _ = monitor::ensure_bmp(&p);
                    });
                }

                index += 1;
            }

            let mut map = monitors_state.lock().unwrap();
            for (mid, _) in &entries {
                if let Some(ms) = map.get_mut(mid.as_str()) {
                    ms.is_running = false;
                    ms.cancel_token = None;
                }
            }
            log::info!("Synced timer stopped");
        });

        Ok(())
    }

    // ── 6. sync_restart_all ─────────────────────────────────────────

    /// Stop all slideshows, then run them from ONE shared timer task
    /// so wallpapers change at exactly the same moment.
    pub fn sync_restart_all(&self) -> Result<(), String> {
        // Collect state with current indexes
        let entries: Vec<(String, Vec<String>, u64, SlideshowMode, usize)> = {
            let map = self.monitors.lock().unwrap();
            map.iter()
                .filter(|(_, ms)| !ms.images.is_empty())
                .map(|(mid, ms)| {
                    (mid.clone(), ms.images.clone(), ms.interval_secs, ms.mode.clone(), ms.current_index)
                })
                .collect()
        };

        if entries.is_empty() {
            return Err("No slideshows configured".into());
        }

        for (mid, _, _, _, _) in &entries {
            self.stop_slideshow(mid);
        }

        let interval_secs = entries.iter().map(|(_, _, i, _, _)| *i).min().unwrap_or(300);
        let global_index = entries.iter().map(|(_, _, _, _, i)| *i).max().unwrap_or(0);
        let mode = entries.first().map(|(_, _, _, m, _)| m.clone()).unwrap_or(SlideshowMode::Sequential);

        let token = CancellationToken::new();

        {
            let mut map = self.monitors.lock().unwrap();
            for (mid, images, _, _, _) in &entries {
                map.insert(
                    mid.clone(),
                    MonitorSlideshow {
                        folder_path: String::new(),
                        images: images.clone(),
                        current_index: global_index,
                        interval_secs,
                        mode: mode.clone(),
                        is_running: true,
                        is_pinned: false,
                        cancel_token: Some(token.clone()),
                    },
                );
            }
        }

        log::info!(
            "Sync timer started: {} monitors, {}s interval, resume@{}",
            entries.len(),
            interval_secs,
            global_index
        );

        // Single shared timer task — changes all monitors at the same tick
        let monitors = self.monitors.clone();
        let monitor_data: Vec<(String, Vec<String>)> = entries
            .into_iter()
            .map(|(mid, images, _, _, _)| (mid, images))
            .collect();

        tauri::async_runtime::spawn(async move {
            let mut index = global_index;

            // Pre-convert current images for all monitors
            {
                let mut pre_handles = Vec::new();
                for (_, images) in &monitor_data {
                    if images.is_empty() { continue; }
                    let path = images[index % images.len()].clone();
                    pre_handles.push(tokio::task::spawn_blocking(move || {
                        let _ = monitor::ensure_bmp(&path);
                    }));
                }
                for h in pre_handles { let _ = h.await; }
            }

            // Absolute-time interval — no drift
            let mut ticker = time::interval(Duration::from_secs(interval_secs));
            ticker.set_missed_tick_behavior(time::MissedTickBehavior::Skip);

            loop {
                // Wait for tick or cancel
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = token.cancelled() => { break; }
                }

                if token.is_cancelled() { break; }

                // Check which monitors are pinned
                let pinned_set: std::collections::HashSet<String> = {
                    let map = monitors.lock().unwrap();
                    monitor_data.iter()
                        .filter(|(mid, _)| map.get(mid.as_str()).map(|ms| ms.is_pinned).unwrap_or(false))
                        .map(|(mid, _)| mid.clone())
                        .collect()
                };

                // Set wallpapers for unpinned monitors
                let pairs: Vec<(String, String)> = monitor_data
                    .iter()
                    .filter(|(mid, imgs)| !imgs.is_empty() && !pinned_set.contains(mid))
                    .map(|(mid, imgs)| {
                        (mid.clone(), imgs[index % imgs.len()].clone())
                    })
                    .collect();

                if !pairs.is_empty() {
                    let wp_result = tokio::task::spawn_blocking(move || {
                        let mut errors = Vec::new();
                        for (mid, path) in &pairs {
                            if let Err(e) = monitor::set_wallpaper(mid, path) {
                                errors.push((mid.clone(), e));
                            }
                        }
                        errors
                    }).await;

                    match wp_result {
                        Ok(errors) => {
                            for (mid, e) in errors {
                                log::error!("[{}] set_wallpaper failed: {}", mid, e);
                            }
                        }
                        Err(e) => log::error!("spawn_blocking panic: {}", e),
                    }
                }

                // Update state for unpinned monitors
                {
                    let mut map = monitors.lock().unwrap();
                    for (mid, images) in &monitor_data {
                        if pinned_set.contains(mid) { continue; }
                        let total = images.len();
                        if let Some(ms) = map.get_mut(mid.as_str()) {
                            ms.current_index = index % total;
                        }
                    }
                }

                // Pre-convert NEXT images for unpinned monitors
                for (mid, images) in &monitor_data {
                    if pinned_set.contains(mid) { continue; }
                    let total = images.len();
                    if total == 0 { continue; }
                    let next_path = images[(index + 1) % total].clone();
                    tokio::task::spawn_blocking(move || {
                        let _ = monitor::ensure_bmp(&next_path);
                    });
                }

                index += 1;
            }

            // Mark all stopped
            let mut map = monitors.lock().unwrap();
            for (mid, _) in &monitor_data {
                if let Some(ms) = map.get_mut(mid.as_str()) {
                    ms.is_running = false;
                    ms.cancel_token = None;
                }
            }
            log::info!("Sync timer stopped");
        });

        Ok(())
    }

    // ── 7. pin ─────────────────────────────────────────────────────────

    pub fn toggle_pin_all(&self) -> bool {
        let mut map = self.monitors.lock().unwrap();
        // If any monitor is unpinned, pin all; otherwise unpin all
        let any_unpinned = map.values().any(|ms| ms.is_running && !ms.is_pinned);
        let new_state = any_unpinned;
        for ms in map.values_mut() {
            if ms.is_running {
                ms.is_pinned = new_state;
            }
        }
        log::info!("Pin all: {}", if new_state { "pinned" } else { "unpinned" });
        new_state
    }

    pub fn is_all_pinned(&self) -> bool {
        let map = self.monitors.lock().unwrap();
        let running: Vec<_> = map.values().filter(|ms| ms.is_running).collect();
        !running.is_empty() && running.iter().all(|ms| ms.is_pinned)
    }

    // ── 8. get_status ────────────────────────────────────────────────

    pub fn get_status(&self) -> HashMap<String, SlideshowStatus> {
        let map = self.monitors.lock().unwrap();
        map.iter()
            .map(|(k, v)| (k.clone(), v.to_status()))
            .collect()
    }

    pub fn get_monitor_status(&self, monitor_id: &str) -> Option<SlideshowStatus> {
        let map = self.monitors.lock().unwrap();
        map.get(monitor_id).map(|ms| ms.to_status())
    }
}
