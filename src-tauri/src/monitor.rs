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
    monitors
}

// ── Windows: IDesktopWallpaper COM API ───────────────────────────────

#[cfg(target_os = "windows")]
mod win {
    use std::cell::RefCell;
    use windows::{
        core::HSTRING,
        Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        },
        Win32::UI::Shell::{DesktopWallpaper, IDesktopWallpaper},
    };

    thread_local! {
        static DW_CACHE: RefCell<Option<IDesktopWallpaper>> = const { RefCell::new(None) };
        static PATHS_CACHE: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
        // Track current wallpaper per monitor to skip redundant SetWallpaper calls
        static CURRENT_WP: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    }

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

    fn ensure_paths() -> Result<(), String> {
        PATHS_CACHE.with(|cell| {
            let paths = cell.borrow();
            if !paths.is_empty() {
                return Ok(());
            }
            drop(paths);
            let fresh = load_monitor_paths()?;
            let count = fresh.len();
            *cell.borrow_mut() = fresh;
            // Initialize current wallpaper tracker
            CURRENT_WP.with(|wp| {
                let mut w = wp.borrow_mut();
                if w.len() < count {
                    w.resize(count, String::new());
                }
            });
            Ok(())
        })
    }

    fn load_monitor_paths() -> Result<Vec<String>, String> {
        unsafe {
            let dw = get_desktop_wallpaper()?;
            let count = dw
                .GetMonitorDevicePathCount()
                .map_err(|e| format!("GetMonitorDevicePathCount: {}", e))?;
            let mut paths = Vec::with_capacity(count as usize);
            for i in 0..count {
                match dw.GetMonitorDevicePathAt(i) {
                    Ok(p) => paths.push(p.to_string().unwrap_or_default()),
                    Err(e) => {
                        log::warn!("GetMonitorDevicePathAt({}): {}", i, e);
                        paths.push(String::new());
                    }
                }
            }
            Ok(paths)
        }
    }

    pub fn set_wallpaper_by_index(monitor_index: usize, bmp_path: &str) -> Result<(), String> {
        ensure_paths()?;

        // Skip if same wallpaper is already set
        let is_same = CURRENT_WP.with(|wp| {
            let w = wp.borrow();
            w.get(monitor_index).map(|s| s == bmp_path).unwrap_or(false)
        });
        if is_same {
            return Ok(());
        }

        PATHS_CACHE.with(|cell| {
            let paths = cell.borrow();
            if monitor_index >= paths.len() {
                return Err(format!(
                    "Monitor index {} out of range (found {} monitor(s))",
                    monitor_index,
                    paths.len()
                ));
            }
            unsafe {
                let dw = get_desktop_wallpaper()?;
                let monitor_id = HSTRING::from(&paths[monitor_index]);
                let wallpaper = HSTRING::from(bmp_path);
                dw.SetWallpaper(&monitor_id, &wallpaper)
                    .map_err(|e| format!("SetWallpaper failed: {}", e))?;
            }
            // Update tracker
            CURRENT_WP.with(|wp| {
                let mut w = wp.borrow_mut();
                if monitor_index < w.len() {
                    w[monitor_index] = bmp_path.to_string();
                }
            });
            Ok(())
        })
    }
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
        win::set_wallpaper_by_index(target_index, &bmp_path)?;
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
