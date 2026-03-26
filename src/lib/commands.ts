import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────────────────────

export interface MonitorInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
}

export interface ImageInfo {
  path: string;
  filename: string;
  size_bytes: number;
}

export type SlideshowMode = "Sequential" | "Shuffle";

export interface SlideshowStatus {
  is_running: boolean;
  current_image: string | null;
  current_index: number;
  total_images: number;
  interval_secs: number;
  mode: SlideshowMode;
}

// ── Monitor & Wallpaper ──────────────────────────────────────────────

export async function getMonitors(): Promise<MonitorInfo[]> {
  return invoke("get_monitors");
}

export async function setWallpaper(
  monitorId: string,
  imagePath: string,
): Promise<void> {
  return invoke("set_wallpaper", { monitorId, imagePath });
}

export async function getImagesFromFolder(
  folderPath: string,
): Promise<ImageInfo[]> {
  return invoke("get_images_from_folder", { folderPath });
}

// ── Slideshow ────────────────────────────────────────────────────────

export async function startSlideshow(
  monitorId: string,
  folderPath: string,
  intervalSecs: number,
  mode: SlideshowMode,
): Promise<void> {
  return invoke("start_slideshow", {
    monitorId,
    folderPath,
    intervalSecs,
    mode,
  });
}

export async function startSlideshowFiles(
  monitorId: string,
  imagePaths: string[],
  intervalSecs: number,
  mode: SlideshowMode,
): Promise<void> {
  return invoke("start_slideshow_files", {
    monitorId,
    imagePaths,
    intervalSecs,
    mode,
  });
}

export async function startSynced(
  monitorsData: [string, string[]][],
  intervalSecs: number,
  mode: SlideshowMode,
): Promise<void> {
  return invoke("start_synced", { monitorsData, intervalSecs, mode });
}

export async function stopSlideshow(monitorId: string): Promise<void> {
  return invoke("stop_slideshow", { monitorId });
}

export async function nextWallpaper(monitorId: string): Promise<void> {
  return invoke("next_wallpaper", { monitorId });
}

export async function prevWallpaper(monitorId: string): Promise<void> {
  return invoke("prev_wallpaper", { monitorId });
}

export async function pauseAll(): Promise<void> {
  return invoke("pause_all");
}

export async function resumeAll(): Promise<void> {
  return invoke("resume_all");
}

export async function getSlideshowStatus(): Promise<
  Record<string, SlideshowStatus>
> {
  return invoke("get_slideshow_status");
}

export async function getMonitorSlideshowStatus(
  monitorId: string,
): Promise<SlideshowStatus | null> {
  return invoke("get_monitor_slideshow_status", { monitorId });
}

export async function syncRestartAll(): Promise<void> {
  return invoke("sync_restart_all");
}

// ── Window mover (Pro) ───────────────────────────────────────────────

export async function moveWindowToNextMonitor(): Promise<void> {
  return invoke("move_window_to_next_monitor");
}

// ── Tray ─────────────────────────────────────────────────────────────

export async function updateTrayLocale(locale: string): Promise<void> {
  return invoke("update_tray_locale", { locale });
}
