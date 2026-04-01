//! DMT-style wallpaper transition with cached canvas.
//!
//! Maintains an in-memory canvas covering the virtual desktop.
//! On wallpaper change, only the affected monitor region is updated,
//! then the canvas is saved as BMP and applied via IActiveDesktop.

use crate::monitor;
use std::sync::Mutex;

/// Update one monitor's region on the cached canvas and apply.
pub fn fade_and_set(monitor_id: &str, image_path: &str) -> Result<(), String> {
    fade_and_set_multi(&[(monitor_id.to_string(), image_path.to_string())])
}

/// Update multiple monitors' regions on the cached canvas and apply.
pub fn fade_and_set_multi(pairs: &[(String, String)]) -> Result<(), String> {
    if pairs.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        win::update_and_apply(pairs)
    }
    #[cfg(not(target_os = "windows"))]
    {
        for (mid, path) in pairs {
            let _ = monitor::set_wallpaper(mid, path);
        }
        Ok(())
    }
}

/// Pre-convert images to BMP cache for upcoming wallpaper changes.
/// Call during idle wait to prepare next images in advance.
pub fn preload(pairs: &[(String, String)]) {
    let monitors = monitor::get_cached_monitors();
    let cache_dir = std::env::temp_dir().join("dualslide_resize_cache");
    let _ = std::fs::create_dir_all(&cache_dir);

    for (mid, path) in pairs {
        let idx: usize = mid
            .strip_prefix("monitor_")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        let mon = match monitors.get(idx) {
            Some(m) => m,
            None => continue,
        };

        let mtime = std::fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let cache_key = format!("{}_{}_{}x{}", path, mtime, mon.width, mon.height);
        let cache_hash = format!("{:x}", md5_simple(cache_key.as_bytes()));
        let bmp_cache_path = cache_dir.join(format!("{}.bmp", cache_hash));

        if bmp_cache_path.exists() {
            continue; // Already cached
        }

        match resize_and_cache(path, mon.width, mon.height, &bmp_cache_path) {
            Ok(_) => log::info!("[{}] Preloaded: {}", mid, path.split(['/', '\\']).last().unwrap_or(path)),
            Err(e) => log::warn!("[{}] Preload failed: {}", mid, e),
        }
    }
}

// ── Cached canvas ────────────────────────────────────────────────────

struct CachedCanvas {
    canvas: image::RgbImage,
    min_x: i32,
    min_y: i32,
    vd_w: u32,
    vd_h: u32,
    /// Tracks which file is currently painted per monitor (path + mtime)
    painted: std::collections::HashMap<String, (String, u64)>, // monitor_id → (path, mtime_secs)
}

static CANVAS: Mutex<Option<CachedCanvas>> = Mutex::new(None);

fn get_or_create_canvas() -> Result<(), String> {
    let mut guard = CANVAS.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }

    let monitors = monitor::get_cached_monitors();
    if monitors.is_empty() {
        return Err("No monitors cached".into());
    }

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for mon in &monitors {
        min_x = min_x.min(mon.x);
        min_y = min_y.min(mon.y);
        max_x = max_x.max(mon.x + mon.width as i32);
        max_y = max_y.max(mon.y + mon.height as i32);
    }

    let vd_w = (max_x - min_x) as u32;
    let vd_h = (max_y - min_y) as u32;

    log::info!("Creating canvas: {}x{} (virtual desktop)", vd_w, vd_h);

    *guard = Some(CachedCanvas {
        canvas: image::RgbImage::new(vd_w, vd_h),
        min_x,
        min_y,
        vd_w,
        vd_h,
        painted: std::collections::HashMap::new(),
    });

    // Ensure disk cache directory exists
    let cache_dir = std::env::temp_dir().join("dualslide_resize_cache");
    let _ = std::fs::create_dir_all(&cache_dir);

    Ok(())
}

/// Invalidate canvas (call when monitors change).
pub fn invalidate_canvas() {
    let mut guard = CANVAS.lock().unwrap();
    *guard = None;
    log::info!("Canvas invalidated");
}

/// Simple hash for cache key (no crypto needed, just uniqueness).
fn md5_simple(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Load image, resize to target dimensions, save as BMP cache, return RGB.
fn resize_and_cache(
    path: &str, w: u32, h: u32, cache_path: &std::path::Path,
) -> Result<image::RgbImage, String> {
    let img = image::open(path)
        .map_err(|e| format!("Image load failed: {}", e))?;

    let rgb = if img.width() == w && img.height() == h {
        img.to_rgb8()
    } else {
        img.resize_exact(w, h, image::imageops::FilterType::CatmullRom)
            .to_rgb8()
    };

    // Save to disk cache (fire and forget)
    if let Err(e) = rgb.save(cache_path) {
        log::warn!("Failed to save resize cache: {}", e);
    } else {
        log::info!("Saved resize cache: {}", cache_path.display());
    }

    Ok(rgb)
}

/// Update specific monitor regions on the canvas. Returns the BMP path.
fn update_canvas(pairs: &[(String, String)]) -> Result<String, String> {
    get_or_create_canvas()?;

    let monitors = monitor::get_cached_monitors();
    let mut guard = CANVAS.lock().unwrap();
    let cached = guard.as_mut().unwrap();

    let start = std::time::Instant::now();

    let cache_dir = std::env::temp_dir().join("dualslide_resize_cache");

    for (mid, path) in pairs {
        let idx: usize = mid
            .strip_prefix("monitor_")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        let mon = match monitors.get(idx) {
            Some(m) => m,
            None => continue,
        };

        // Get file modification time for cache key
        let mtime = std::fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        // Check if already painted with same file+mtime
        let already_painted = cached.painted.get(mid.as_str())
            .map(|(p, mt)| p == path && *mt == mtime)
            .unwrap_or(false);

        if already_painted {
            continue; // Canvas already has this image, skip
        }

        // Disk cache key: hash of (path + mtime + dimensions)
        let cache_key = format!("{}_{}_{}x{}", path, mtime, mon.width, mon.height);
        let cache_hash = format!("{:x}", md5_simple(cache_key.as_bytes()));
        let bmp_cache_path = cache_dir.join(format!("{}.bmp", cache_hash));

        let rgb = if bmp_cache_path.exists() {
            // Load from disk cache (fast BMP decode)
            match image::open(&bmp_cache_path) {
                Ok(img) => {
                    log::info!("[{}] Loaded from disk cache", mid);
                    img.to_rgb8()
                }
                Err(_) => {
                    // Cache corrupted, re-process
                    let _ = std::fs::remove_file(&bmp_cache_path);
                    resize_and_cache(path, mon.width, mon.height, &bmp_cache_path)?
                }
            }
        } else {
            resize_and_cache(path, mon.width, mon.height, &bmp_cache_path)?
        };

        cached.painted.insert(mid.clone(), (path.clone(), mtime));

        // Paste onto canvas
        let ox = (mon.x - cached.min_x) as u32;
        let oy = (mon.y - cached.min_y) as u32;

        for py in 0..mon.height {
            for px in 0..mon.width {
                let dx = ox + px;
                let dy = oy + py;
                if dx < cached.vd_w && dy < cached.vd_h {
                    cached.canvas.put_pixel(dx, dy, *rgb.get_pixel(px, py));
                }
            }
        }
    }

    // Save as BMP
    let bmp_path = std::env::temp_dir().join("dualslide_composite.bmp");
    cached.canvas
        .save(&bmp_path)
        .map_err(|e| format!("Save BMP failed: {}", e))?;

    let elapsed = start.elapsed();
    log::info!(
        "Canvas updated ({} monitor(s)) in {:.0}ms → {}",
        pairs.len(),
        elapsed.as_millis(),
        bmp_path.display()
    );

    Ok(bmp_path.to_string_lossy().to_string())
}

// ── Windows: IActiveDesktop ──────────────────────────────────────────

#[cfg(target_os = "windows")]
mod win {
    use super::*;
    use std::ffi::c_void;
    use windows::{
        core::{w, GUID, HRESULT, HSTRING},
        Win32::Foundation::*,
        Win32::System::Com::*,
        Win32::System::Registry::*,
        Win32::UI::WindowsAndMessaging::*,
    };

    const AD_APPLY_ALL: u32 = 0x07;

    const CLSID_ACTIVE_DESKTOP: GUID = GUID {
        data1: 0x75048700,
        data2: 0xEF1F,
        data3: 0x11D0,
        data4: [0x98, 0x88, 0x00, 0x60, 0x97, 0xDE, 0xAC, 0xF9],
    };

    const IID_IACTIVE_DESKTOP: GUID = GUID {
        data1: 0xF490EB00,
        data2: 0x1240,
        data3: 0x11D1,
        data4: [0x98, 0x88, 0x00, 0x60, 0x97, 0xDE, 0xAC, 0xF9],
    };

    extern "system" {
        #[link_name = "CoCreateInstance"]
        fn raw_co_create_instance(
            rclsid: *const GUID,
            punk_outer: *const c_void,
            cls_context: u32,
            riid: *const GUID,
            ppv: *mut *mut c_void,
        ) -> HRESULT;
    }

    type FnRelease = unsafe extern "system" fn(*mut c_void) -> u32;
    type FnSetWallpaper = unsafe extern "system" fn(*mut c_void, *const u16, u32) -> HRESULT;
    type FnApplyChanges = unsafe extern "system" fn(*mut c_void, u32) -> HRESULT;

    /// Update canvas + apply via IActiveDesktop.
    pub fn update_and_apply(pairs: &[(String, String)]) -> Result<(), String> {
        let bmp_path = update_canvas(pairs)?;

        match set_via_active_desktop(&bmp_path) {
            Ok(()) => {
                log::info!("Wallpaper applied via IActiveDesktop");
                Ok(())
            }
            Err(e) => {
                log::warn!("IActiveDesktop failed ({}), falling back to SPI", e);
                set_via_spi(&bmp_path)
            }
        }
    }

    fn set_tile_registry() -> Result<(), String> {
        unsafe {
            let subkey = w!("Control Panel\\Desktop");
            let mut hkey = HKEY::default();

            let err = RegOpenKeyExW(HKEY_CURRENT_USER, subkey, None, KEY_SET_VALUE, &mut hkey);
            if err.0 != 0 {
                return Err(format!("RegOpenKeyExW failed: {}", err.0));
            }

            let tile_bytes: [u8; 4] = [0x31, 0x00, 0x00, 0x00];
            let style_bytes: [u8; 4] = [0x30, 0x00, 0x00, 0x00];

            let _ = RegSetValueExW(hkey, w!("TileWallpaper"), None, REG_SZ, Some(&tile_bytes));
            let _ = RegSetValueExW(hkey, w!("WallpaperStyle"), None, REG_SZ, Some(&style_bytes));
            let _ = RegCloseKey(hkey);
            Ok(())
        }
    }

    fn enable_active_desktop() {
        unsafe {
            if let Ok(progman) = FindWindowW(w!("Progman"), None) {
                if !progman.is_invalid() {
                    let mut result = 0usize;
                    let _ = SendMessageTimeoutW(
                        progman, 0x052C, WPARAM(0), LPARAM(0),
                        SMTO_NORMAL, 500, Some(&mut result),
                    );
                }
            }
        }
    }

    fn set_via_active_desktop(bmp_path: &str) -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

            enable_active_desktop();
            set_tile_registry()?;

            let mut ppv: *mut c_void = std::ptr::null_mut();
            let hr = raw_co_create_instance(
                &CLSID_ACTIVE_DESKTOP,
                std::ptr::null(),
                CLSCTX_ALL.0 as u32,
                &IID_IACTIVE_DESKTOP,
                &mut ppv,
            );

            if hr.is_err() || ppv.is_null() {
                return Err(format!("CoCreateInstance(ActiveDesktop) failed: {:?}", hr));
            }

            let vtbl = *(ppv as *const *const usize);

            let set_wallpaper: FnSetWallpaper = std::mem::transmute(*vtbl.add(5));
            let wide_path: Vec<u16> = bmp_path.encode_utf16().chain(std::iter::once(0)).collect();
            let hr = set_wallpaper(ppv, wide_path.as_ptr(), 0);

            if hr.is_err() {
                let release: FnRelease = std::mem::transmute(*vtbl.add(2));
                release(ppv);
                return Err(format!("IActiveDesktop::SetWallpaper failed: {:?}", hr));
            }

            let apply_changes: FnApplyChanges = std::mem::transmute(*vtbl.add(3));
            let hr = apply_changes(ppv, AD_APPLY_ALL);

            let release: FnRelease = std::mem::transmute(*vtbl.add(2));
            release(ppv);

            if hr.is_err() {
                return Err(format!("IActiveDesktop::ApplyChanges failed: {:?}", hr));
            }

            Ok(())
        }
    }

    fn set_via_spi(bmp_path: &str) -> Result<(), String> {
        unsafe {
            set_tile_registry()?;

            let wide_path = HSTRING::from(bmp_path);
            SystemParametersInfoW(
                SPI_SETDESKWALLPAPER, 0,
                Some(wide_path.as_ptr() as *mut c_void),
                SPIF_UPDATEINIFILE | SPIF_SENDWININICHANGE,
            )
            .map_err(|e| format!("SystemParametersInfo failed: {}", e))?;

            Ok(())
        }
    }
}
