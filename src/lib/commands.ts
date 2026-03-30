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
  is_pinned: boolean;
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

// ── Pin ─────────────────────────────────────────────────────────────

export async function togglePinAll(): Promise<boolean> {
  return invoke("toggle_pin_all");
}

export async function isAllPinned(): Promise<boolean> {
  return invoke("is_all_pinned");
}

// ── Taskbar ──────────────────────────────────────────────────────────

export async function setTaskbarVisible(
  monitorIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
  visible: boolean,
): Promise<void> {
  return invoke("set_taskbar_visible", {
    monitorIndex,
    x,
    y,
    width,
    height,
    visible,
  });
}

export async function getTaskbarVisible(
  monitorIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<boolean> {
  return invoke("get_taskbar_visible", {
    monitorIndex,
    x,
    y,
    width,
    height,
  });
}

// ── Zen Mode ────────────────────────────────────────────────────────

export async function toggleZenMode(): Promise<boolean> {
  return invoke("toggle_zen_mode");
}

export async function isZenModeActive(): Promise<boolean> {
  return invoke("is_zen_mode_active");
}

// ── Schedule ─────────────────────────────────────────────────────────

export interface ScheduleSlot {
  name: string;
  start_time: string; // "HH:MM"
  profile_id: string | null;
  folders: Record<string, string[]>; // monitor_id → folder paths
}

export interface Schedule {
  enabled: boolean;
  slots: ScheduleSlot[];
}

export async function setSchedule(schedule: Schedule): Promise<void> {
  return invoke("set_schedule", { schedule });
}

export async function getSchedule(): Promise<Schedule> {
  return invoke("get_schedule");
}

export async function enableSchedule(enabled: boolean): Promise<void> {
  return invoke("enable_schedule", { enabled });
}

export async function getActiveScheduleSlot(): Promise<string | null> {
  return invoke("get_active_schedule_slot");
}

// ── Tray ─────────────────────────────────────────────────────────────

export async function updateTrayLocale(locale: string): Promise<void> {
  return invoke("update_tray_locale", { locale });
}
