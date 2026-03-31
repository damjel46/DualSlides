use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInfo {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
}

const SUPPORTED_EXTS: &[&str] = &["jpg", "jpeg", "png", "bmp", "webp"];

// ── Cached Tauri monitor info for index mapping ─────────────────────
static TAURI_MONITORS: Mutex<Vec<MonitorInfo>> = Mutex::new(Vec::new());

pub fn cache_tauri_monitors(monitors: &[MonitorInfo]) {
    let mut cached = TAURI_MONITORS.lock().unwrap();
    *cached = monitors.to_vec();
    // Clear IDesktopWallpaper mapping so it rebuilds with new info
    #[cfg(target_os = "windows")]
    {
        // Can't call win::clear_mapping() here due to thread_local,
        // it will rebuild on next set_wallpaper call from that thread
    }
    log::info!("Cached {} Tauri monitors for index mapping", monitors.len());
}

fn get_cached_monitors() -> Vec<MonitorInfo> {
    TAURI_MONITORS.lock().unwrap().clone()
}

// ── BMP cache ────────────────────────────────────────────────────────
// Pre-converts images to BMP so Windows doesn't need to decode jpg/png/webp
// on each SetWallpaper call. Cached in temp dir, keyed by source path + mtime.

static BMP_CACHE: Mutex<Option<BmpCache>> = Mutex::new(None);

struct BmpCache {
    dir: PathBuf,
    map: HashMap<String, PathBuf>, // source_path -> cached bmp path
}

fn get_bmp_cache_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("dualslide_bmp_cache");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

/// Convert image to BMP and cache it. Returns the BMP path.
/// If already cached (and source not modified), returns cached path.
/// If source is already BMP, returns source path as-is.
/// Pre-convert an image to BMP (cached). Can be called ahead of time
/// during sleep to avoid blocking the wallpaper swap.
pub fn ensure_bmp(source: &str) -> Result<String, String> {
    let src_path = Path::new(source);
    let ext = src_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    // BMP files don't need conversion
    if ext == "bmp" {
        return Ok(source.to_string());
    }

    // Build cache key from path + file size (cheap mtime proxy)
    let metadata = fs::metadata(src_path)
        .map_err(|e| format!("Cannot read file metadata: {}", e))?;
    let cache_key = format!("{}_{}", source, metadata.len());

    // Check cache
    {
        let guard = BMP_CACHE.lock().unwrap();
        if let Some(ref cache) = *guard {
            if let Some(cached) = cache.map.get(&cache_key) {
                if cached.exists() {
                    return Ok(cached.to_string_lossy().to_string());
                }
            }
        }
    }

    // Convert to BMP
    let img = image::open(src_path)
        .map_err(|e| format!("Failed to decode image '{}': {}", source, e))?;

    let cache_dir = get_bmp_cache_dir();
    let hash = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        cache_key.hash(&mut h);
        h.finish()
    };
    let bmp_path = cache_dir.join(format!("{:016x}.bmp", hash));

    img.save_with_format(&bmp_path, image::ImageFormat::Bmp)
        .map_err(|e| format!("Failed to save BMP cache: {}", e))?;

    let bmp_str = bmp_path.to_string_lossy().to_string();

    // Store in cache
    {
        let mut guard = BMP_CACHE.lock().unwrap();
        let cache = guard.get_or_insert_with(|| BmpCache {
            dir: cache_dir,
            map: HashMap::new(),
        });
        cache.map.insert(cache_key, bmp_path);
    }

    log::info!("BMP cached: {} -> {}", source, bmp_str);
    Ok(bmp_str)
}

// ── Monitor detection ────────────────────────────────────────────────

pub fn get_all_monitors(app: &tauri::AppHandle) -> Vec<MonitorInfo> {
    let tauri_monitors = app.available_monitors().unwrap_or_default();

    let monitors: Vec<MonitorInfo> = tauri_monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let size = m.size();
            let pos = m.position();
            let raw_name = m
                .name()
                .unwrap_or(&format!("Display {}", i + 1))
                .to_string();
            // Clean up Windows device paths like "\\.\DISPLAY1" → "Display 1"
            let name = if raw_name.contains("DISPLAY") || raw_name.contains("MONITOR") || raw_name.starts_with("\\\\.") || raw_name.starts_with("\\\\?") {
                format!("Monitor {}", i + 1)
            } else {
                raw_name
            };
            MonitorInfo {
                id: format!("monitor_{}", i),
                name,
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
                is_primary: i == 0,
            }
        })
        .collect();

    log::info!("Detected {} monitor(s)", monitors.len());
    cache_tauri_monitors(&monitors);
    monitors
}

// ── Windows: IDesktopWallpaper COM API ───────────────────────────────

#[cfg(target_os = "windows")]
mod win {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;
    use windows::{
        core::HSTRING,
        Win32::Foundation::RECT,
        Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        },
        Win32::UI::Shell::{DesktopWallpaper, IDesktopWallpaper},
        Win32::UI::WindowsAndMessaging::{
            SystemParametersInfoW, ANIMATIONINFO,
            SPI_GETANIMATION, SPI_SETANIMATION,
            SPIF_SENDCHANGE,
        },
    };

    thread_local! {
        static DW_CACHE: RefCell<Option<IDesktopWallpaper>> = const { RefCell::new(None) };
        /// Maps Tauri monitor index → IDesktopWallpaper device path (thread-local cache)
        static INDEX_TO_PATH: RefCell<Option<HashMap<usize, String>>> = const { RefCell::new(None) };
    }

    /// Global wallpaper tracker — shared across all threads to prevent skip on wrap-around
    static CURRENT_WP: StdMutex<Option<HashMap<usize, String>>> = StdMutex::new(None);

    fn get_desktop_wallpaper() -> Result<IDesktopWallpaper, String> {
        DW_CACHE.with(|cell| {
            let mut cache = cell.borrow_mut();
            if let Some(ref dw) = *cache {
                return Ok(dw.clone());
            }
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                let dw: IDesktopWallpaper =
                    CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL)
                        .map_err(|e| format!("CoCreateInstance failed: {}", e))?;
                *cache = Some(dw.clone());
                Ok(dw)
            }
        })
    }

    /// Ensure system animations are enabled so DWM crossfade plays.
    /// Called once at startup.
    pub fn init_transitions() {
        unsafe {
            let mut anim = ANIMATIONINFO {
                cbSize: std::mem::size_of::<ANIMATIONINFO>() as u32,
                iMinAnimate: 0,
            };
            let _ = SystemParametersInfoW(
                SPI_GETANIMATION,
                anim.cbSize,
                Some(&mut anim as *mut _ as *mut std::ffi::c_void),
                Default::default(),
            );
            if anim.iMinAnimate == 0 {
                anim.iMinAnimate = 1;
                let _ = SystemParametersInfoW(
                    SPI_SETANIMATION,
                    anim.cbSize,
                    Some(&mut anim as *mut _ as *mut std::ffi::c_void),
                    SPIF_SENDCHANGE,
                );
                log::info!("Enabled system animations for wallpaper transitions");
            }

            // Initialize IDesktopWallpaper and enable it
            match get_desktop_wallpaper() {
                Ok(dw) => {
                    let _ = dw.Enable(true);
                    log::info!("IDesktopWallpaper enabled for transitions");
                }
                Err(e) => log::warn!("Could not init IDesktopWallpaper: {}", e),
            }
        }
    }

    /// Build mapping from Tauri monitor index to IDesktopWallpaper device path
    /// by matching monitor positions (x, y) from both APIs.
    fn ensure_mapping(tauri_monitors: &[super::MonitorInfo]) -> Result<(), String> {
        INDEX_TO_PATH.with(|cell| {
            if cell.borrow().is_some() {
                return Ok(());
            }

            unsafe {
                let dw = get_desktop_wallpaper()?;
                let count = dw
                    .GetMonitorDevicePathCount()
                    .map_err(|e| format!("GetMonitorDevicePathCount: {}", e))?;

                let mut dw_monitors: Vec<(String, RECT)> = Vec::new();
                for i in 0..count {
                    let path = match dw.GetMonitorDevicePathAt(i) {
                        Ok(p) => p.to_string().unwrap_or_default(),
                        Err(_) => continue,
                    };
                    if path.is_empty() { continue; }
                    let rect = match dw.GetMonitorRECT(&HSTRING::from(&path)) {
                        Ok(r) => r,
                        Err(e) => {
                            log::warn!("GetMonitorRECT failed for {}: {}", path, e);
                            continue;
                        }
                    };
                    dw_monitors.push((path, rect));
                }

                let mut mapping = HashMap::new();
                for (tauri_idx, tm) in tauri_monitors.iter().enumerate() {
                    let mut best_match: Option<(usize, i32)> = None;
                    for (dw_idx, (_, rect)) in dw_monitors.iter().enumerate() {
                        let dx = (rect.left - tm.x).abs();
                        let dy = (rect.top - tm.y).abs();
                        let dist = dx + dy;
                        if best_match.is_none() || dist < best_match.unwrap().1 {
                            best_match = Some((dw_idx, dist));
                        }
                    }
                    if let Some((dw_idx, dist)) = best_match {
                        if dist < 50 {
                            let path = dw_monitors[dw_idx].0.clone();
                            log::info!(
                                "Monitor mapping: tauri[{}] ({},{}) → DW path ...{}",
                                tauri_idx, tm.x, tm.y,
                                &path[path.len().saturating_sub(20)..]
                            );
                            mapping.insert(tauri_idx, path);
                        }
                    }
                }

                if mapping.is_empty() {
                    log::warn!("Position matching failed, falling back to index order");
                    for (i, (path, _)) in dw_monitors.iter().enumerate() {
                        mapping.insert(i, path.clone());
                    }
                }

                *cell.borrow_mut() = Some(mapping);
            }
            Ok(())
        })
    }

    pub fn set_wallpaper_by_index(
        monitor_index: usize,
        bmp_path: &str,
        tauri_monitors: &[super::MonitorInfo],
    ) -> Result<(), String> {
        ensure_mapping(tauri_monitors)?;

        // Skip if same wallpaper is already set (global tracker, not thread-local)
        {
            let guard = CURRENT_WP.lock().unwrap();
            if let Some(ref map) = *guard {
                if map.get(&monitor_index).map(|s| s == bmp_path).unwrap_or(false) {
                    return Ok(());
                }
            }
        }

        INDEX_TO_PATH.with(|cell| {
            let opt = cell.borrow();
            let map = opt.as_ref().ok_or_else(|| "Monitor mapping not initialized".to_string())?;
            let device_path = map.get(&monitor_index).ok_or_else(|| {
                format!(
                    "No device path mapping for monitor index {} (have {} mappings)",
                    monitor_index,
                    map.len()
                )
            })?;

            unsafe {
                let dw = get_desktop_wallpaper()?;
                let monitor_id = HSTRING::from(device_path.as_str());
                let wallpaper = HSTRING::from(bmp_path);
                dw.SetWallpaper(&monitor_id, &wallpaper)
                    .map_err(|e| format!("SetWallpaper failed: {}", e))?;
            }

            // Update global tracker
            {
                let mut guard = CURRENT_WP.lock().unwrap();
                let map = guard.get_or_insert_with(HashMap::new);
                map.insert(monitor_index, bmp_path.to_string());
            }

            Ok(())
        })
    }
}

/// Initialize wallpaper transition system (DWM crossfade).
/// Call once at app startup.
#[cfg(target_os = "windows")]
pub fn init_transitions() {
    win::init_transitions();
}

// ── Cross-platform set_wallpaper ─────────────────────────────────────

pub fn set_wallpaper(monitor_id: &str, image_path: &str) -> Result<(), String> {
    let path = Path::new(image_path);

    if !path.exists() {
        let msg = format!("Image file not found: {}", image_path);
        log::error!("{}", msg);
        return Err(msg);
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !SUPPORTED_EXTS.contains(&ext.as_str()) {
        let msg = format!("Unsupported image format: .{}", ext);
        log::error!("{}", msg);
        return Err(msg);
    }

    let target_index: usize = monitor_id
        .strip_prefix("monitor_")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| {
            let msg = format!("Invalid monitor id: {}", monitor_id);
            log::error!("{}", msg);
            msg
        })?;

    // Convert to BMP for faster Windows rendering (cached)
    let bmp_path = ensure_bmp(image_path)?;

    #[cfg(target_os = "windows")]
    {
        let cached = get_cached_monitors();
        win::set_wallpaper_by_index(target_index, &bmp_path, &cached)?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = target_index;
        let _ = bmp_path;
        log::warn!("Per-monitor wallpaper not implemented for this platform");
    }

    Ok(())
}

// ── Folder scanning ──────────────────────────────────────────────────

pub fn get_images_from_folder(folder_path: &str) -> Result<Vec<ImageInfo>, String> {
    let dir = Path::new(folder_path);
    if !dir.exists() {
        let msg = format!("Folder not found: {}", folder_path);
        log::error!("{}", msg);
        return Err(msg);
    }
    if !dir.is_dir() {
        let msg = format!("Path is not a directory: {}", folder_path);
        log::error!("{}", msg);
        return Err(msg);
    }

    let entries = fs::read_dir(dir).map_err(|e| {
        let msg = format!("Cannot read folder '{}': {}", folder_path, e);
        log::error!("{}", msg);
        msg
    })?;

    let mut images: Vec<ImageInfo> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())?;
            if !SUPPORTED_EXTS.contains(&ext.as_str()) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let filename = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            Some(ImageInfo {
                path: path.to_string_lossy().to_string(),
                filename,
                size_bytes: metadata.len(),
            })
        })
        .collect();

    images.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));

    log::info!(
        "Found {} supported image(s) in '{}'",
        images.len(),
        folder_path
    );
    Ok(images)
}
