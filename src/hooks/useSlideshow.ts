import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  startSlideshow,
  startSlideshowFiles,
  stopSlideshow,
  nextWallpaper,
  prevWallpaper,
  pauseAll,
  resumeAll,
  syncRestartAll,
  getSlideshowStatus,
  clearFullscreenAutoPause,
} from "../lib/commands";
import type { SlideshowMode, SlideshowStatus } from "../lib/commands";

export function useSlideshow() {
  const [statuses, setStatuses] = useState<Record<string, SlideshowStatus>>({});

  const refresh = useCallback(async () => {
    try {
      setStatuses(await getSlideshowStatus());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    // Fallback polling every 5s (in case event is missed)
    const id = setInterval(refresh, 5000);
    // Instant refresh on wallpaper change event from Rust
    const unlisten = listen("wallpaper-changed", () => { refresh(); });
    return () => {
      clearInterval(id);
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  const start = async (
    monitorId: string,
    folderPath: string,
    intervalSecs: number,
    mode: SlideshowMode,
  ) => {
    await startSlideshow(monitorId, folderPath, intervalSecs, mode);
    await refresh();
  };

  const startFiles = async (
    monitorId: string,
    imagePaths: string[],
    intervalSecs: number,
    mode: SlideshowMode,
  ) => {
    await startSlideshowFiles(monitorId, imagePaths, intervalSecs, mode);
    await refresh();
  };

  const stop = async (monitorId: string) => {
    await stopSlideshow(monitorId);
    await refresh();
  };

  const next = async (monitorId: string) => {
    await nextWallpaper(monitorId);
    await refresh();
  };

  const prev = async (monitorId: string) => {
    await prevWallpaper(monitorId);
    await refresh();
  };

  const pause = async () => {
    await clearFullscreenAutoPause();
    await pauseAll();
    await refresh();
  };

  const resume = async () => {
    await clearFullscreenAutoPause();
    await resumeAll();
    await refresh();
  };

  const syncRestart = async () => {
    await syncRestartAll();
    await refresh();
  };

  return { statuses, start, startFiles, stop, next, prev, pause, resume, syncRestart, refresh };
}
