import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { motion } from "motion/react";
import { MonitorCard } from "./components/MonitorCard";
import { MonitorLayout } from "./components/MonitorLayout";
import { MonitorSource } from "./components/MonitorSource";
import { Settings } from "./components/Settings";
import type { SettingsTab } from "./components/Settings";
import { ScheduleModal } from "./components/ScheduleModal";
import { useMonitors } from "./hooks/useMonitors";
import { useSlideshow } from "./hooks/useSlideshow";
import { useHotkeys } from "./hooks/useHotkeys";
import { useAppConfig, syncSettingsFromMonitor, getAllMonitorConfigs } from "./hooks/useMonitorConfig";
import { useTheme } from "./hooks/useTheme";
import { startSynced, getImagesFromFolder, toggleZenMode, isZenModeActive, togglePinAll, setSchedule } from "./lib/commands";
import { load } from "@tauri-apps/plugin-store";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { LAYOUT_SIZES } from "./lib/layout";
import type { Schedule } from "./lib/commands";

function App() {
  const { t } = useTranslation();
  const { monitors, loading } = useMonitors();
  const {
    statuses, startFiles, stop, next, prev, pause, syncRestart, refresh,
  } = useSlideshow();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedMonitor, setSelectedMonitor] = useState<number | null>(null);

  // Auto-select primary monitor on first load
  useEffect(() => {
    if (monitors.length > 0 && selectedMonitor === null) {
      const primaryIdx = monitors.findIndex((m) => m.is_primary);
      setSelectedMonitor(primaryIdx >= 0 ? primaryIdx : 0);
    }
  }, [monitors]);
  const { syncEnabled, setSync } = useAppConfig();
  const [hasStoredConfigs, setHasStoredConfigs] = useState(false);
  const [zenActive, setZenActive] = useState(false);
  const [allPinned, setAllPinned] = useState(false);
  const [layout, setLayout] = useState<"vertical" | "horizontal">("horizontal");
  const { theme, toggleTheme, accentId, setAccent, customHex, setCustomAccent } = useTheme();

  // ── Profiles ───────────────────────────────────────────────────────
  interface Profile {
    id: string;
    name: string;
    thumbnail: string | null;
    monitors: Record<string, {
      folders: string[];
      selectedFiles: string[];
      interval: number;
      mode: "Sequential" | "Shuffle";
    }>;
  }
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  useEffect(() => {
    load("profiles.json", { autoSave: true, defaults: {} }).then(async (store) => {
      const saved = await store.get<Profile[]>("profiles");
      if (saved) setProfiles(saved);
      const activeId = await store.get<string>("activeProfileId");
      if (activeId) setActiveProfileId(activeId);
    }).catch(() => {});
  }, []);

  const persistProfiles = async (p: Profile[], activeId: string | null) => {
    const store = await load("profiles.json", { autoSave: true, defaults: {} });
    await store.set("profiles", p);
    await store.set("activeProfileId", activeId);
  };

  const handleSaveProfile = async () => {
    if (profiles.length >= 6) return;
    const allConfigs = await getAllMonitorConfigs();
    const monitorsData: Record<string, { folders: string[]; selectedFiles: string[]; interval: number; mode: "Sequential" | "Shuffle" }> = {};
    for (const [mid, cfg] of Object.entries(allConfigs)) {
      const folders = cfg.folders && cfg.folders.length > 0 ? cfg.folders : cfg.folder ? [cfg.folder] : [];
      monitorsData[mid] = {
        folders,
        selectedFiles: cfg.selectedFiles || [],
        interval: cfg.interval,
        mode: cfg.mode,
      };
    }
    // Find a representative thumbnail from first monitor's first image
    let thumbnail: string | null = null;
    const firstCfg = Object.values(allConfigs)[0];
    if (firstCfg?.images?.length > 0) {
      thumbnail = firstCfg.images[0].path;
    }
    const newProfile: Profile = {
      id: Date.now().toString(36),
      name: `Profile ${profiles.length + 1}`,
      thumbnail,
      monitors: monitorsData,
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    setActiveProfileId(newProfile.id);
    await persistProfiles(updated, newProfile.id);
  };

  const handleLoadProfile = async (id: string) => {
    const prof = profiles.find((p) => p.id === id);
    if (!prof) return;
    // Apply each monitor's config to the store
    const store = await load("monitor-configs.json", { autoSave: true, defaults: {} });
    for (const [mid, cfg] of Object.entries(prof.monitors)) {
      const existing = await store.get<Record<string, unknown>>(mid) || {};
      await store.set(mid, {
        ...existing,
        folders: cfg.folders,
        selectedFiles: cfg.selectedFiles,
        interval: cfg.interval,
        mode: cfg.mode,
      });
    }
    setActiveProfileId(id);
    await persistProfiles(profiles, id);
    // Restart slideshows with new config
    await handleStartAll();
  };

  const handleDeleteProfile = async (id: string) => {
    const updated = profiles.filter((p) => p.id !== id);
    const newActiveId = activeProfileId === id ? null : activeProfileId;
    setProfiles(updated);
    setActiveProfileId(newActiveId);
    await persistProfiles(updated, newActiveId);
  };

  const handleSetProfileThumbnail = async (id: string, path: string) => {
    const updated = profiles.map((p) => p.id === id ? { ...p, thumbnail: path } : p);
    setProfiles(updated);
    await persistProfiles(updated, activeProfileId);
  };

  const handleRenameProfile = async (id: string, name: string) => {
    const updated = profiles.map((p) => p.id === id ? { ...p, name } : p);
    setProfiles(updated);
    await persistProfiles(updated, activeProfileId);
  };

  // Load saved layout preference
  useEffect(() => {
    load("settings.json", { autoSave: true, defaults: {} }).then(async (store) => {
      const saved = await store.get<string>("layout");
      if (saved === "vertical" || saved === "horizontal") {
        setLayout(saved);
        // On startup, force resize if saved layout differs from default (vertical)
        await applyLayoutSize(saved, saved !== "horizontal");
      }
    }).catch(() => {});
  }, []);

  const applyLayoutSize = async (mode: "vertical" | "horizontal", forceResize = false) => {
    const win = getCurrentWindow();
    const factor = await win.scaleFactor();
    const { minW, minH, targetW: rawTargetW, targetH: rawTargetH } = LAYOUT_SIZES[mode];

    await win.setMinSize(new LogicalSize(minW, minH));

    if (forceResize) {
      let targetW: number = rawTargetW;
      let targetH: number = rawTargetH;
      // Cap to 90% of screen logical size
      const screenW = Math.floor(window.screen.width * 0.9);
      const screenH = Math.floor(window.screen.height * 0.9);
      targetW = Math.min(targetW, screenW);
      targetH = Math.min(targetH, screenH);
      console.log(`[layout] setSize ${targetW}x${targetH} (mode=${mode})`);
      await win.setSize(new LogicalSize(targetW, targetH));
    } else {
      // On startup: ensure current size meets minimum
      const size = await win.innerSize();
      const logW = Math.round(size.width / factor);
      const logH = Math.round(size.height / factor);
      if (logW < minW || logH < minH) {
        await win.setSize(new LogicalSize(Math.max(logW, minW), Math.max(logH, minH)));
      }
    }
  };

  const toggleLayout = async () => {
    const next = layout === "vertical" ? "horizontal" : "vertical";
    setLayout(next);
    await applyLayoutSize(next, true);
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("layout", next);
  };

  // Zen mode: load initial state + listen for changes (from tray toggle)
  useEffect(() => {
    isZenModeActive().then(setZenActive).catch(() => {});
    const unlisten = listen<boolean>("zen-mode-changed", (event) => {
      setZenActive(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Zen mode: register ESC key to exit
  const handleToggleZenRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!zenActive) return;

    register("Escape", (event) => {
      if (event.state === "Pressed") {
        handleToggleZenRef.current();
      }
    }).catch((e) => console.error("Failed to register Escape hotkey:", e));

    return () => {
      unregister("Escape").catch(() => {});
    };
  }, [zenActive]);

  // ── Schedule: restore from store on startup ─────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const store = await load("schedule.json", { autoSave: true, defaults: {} });
        const saved = await store.get<Schedule>("schedule");
        if (saved && saved.enabled) {
          await setSchedule(saved);
        }
      } catch { /* no saved schedule */ }
    })();
  }, []);

  // ── Schedule: listen for slot changes from backend ──────────────────
  useEffect(() => {
    const unlisten = listen<{ slot_index: number; slot_name: string; folders: Record<string, string[]> }>(
      "schedule-slot-changed",
      async (event) => {
        const { folders } = event.payload;
        const allConfigs = await getAllMonitorConfigs();

        // Stop all current slideshows first
        await pause();

        // For each monitor with folder mapping, scan all folders and restart slideshow
        for (const [mid, folderPaths] of Object.entries(folders)) {
          if (!folderPaths || folderPaths.length === 0) continue;
          try {
            const allPaths: string[] = [];
            for (const folder of folderPaths) {
              const images = await getImagesFromFolder(folder);
              allPaths.push(...images.map((img) => img.path));
            }
            if (allPaths.length > 0) {
              const cfg = allConfigs[mid];
              const interval = cfg?.interval ?? 300;
              const mode = cfg?.mode ?? "Sequential";
              await startFiles(mid, allPaths, interval, mode);
            }
          } catch (e) {
            console.error(`Schedule: failed to apply folder for ${mid}:`, e);
          }
        }
        await refresh();
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [startFiles, refresh, pause]);

  // Track whether slideshow was running before zen mode
  const wasRunningBeforeZen = useRef(false);

  const handleTogglePin = async () => {
    try {
      const pinned = await togglePinAll();
      setAllPinned(pinned);
    } catch (e) {
      console.error("Pin toggle failed:", e);
    }
  };

  const handleToggleFavoriteCurrent = async () => {
    if (!selectedMonitor) return;
    const mon = monitors[selectedMonitor];
    if (!mon) return;
    const currentStatus = statuses[mon.id];
    if (!currentStatus?.current_image) return;

    const allConfigs = await getAllMonitorConfigs();
    const cfg = allConfigs[mon.id];
    if (!cfg) return;

    const favSet = new Set(cfg.favorites || []);
    const path = currentStatus.current_image;
    if (favSet.has(path)) {
      favSet.delete(path);
    } else {
      favSet.add(path);
    }

    // Save directly to store
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("monitor-configs.json", { autoSave: true, defaults: {} });
    await store.set(mon.id, { ...cfg, favorites: [...favSet] });
  };

  // Check if there are saved configs in store (for "Start All" on fresh launch)
  useEffect(() => {
    getAllMonitorConfigs().then((configs) => {
      const hasAny = Object.values(configs).some(
        (cfg) => cfg.images && cfg.images.length > 0,
      );
      setHasStoredConfigs(hasAny);
    });
  }, [statuses]);

  const handleStartAll = useCallback(async (forceSynced?: boolean) => {
    const allConfigs = await getAllMonitorConfigs();

    const perMonitor: { mid: string; paths: string[]; interval: number; mode: "Sequential" | "Shuffle" }[] = [];

    for (const [mid, cfg] of Object.entries(allConfigs)) {
      let activePaths: string[];

      // Combine folders + individual files
      const cfgFolders = cfg.folders && cfg.folders.length > 0 ? cfg.folders : cfg.folder ? [cfg.folder] : [];
      const excludedSet = new Set(cfg.excluded);
      activePaths = [];

      // Scan folders
      for (const f of cfgFolders) {
        try {
          const freshImages = await getImagesFromFolder(f);
          activePaths.push(
            ...freshImages
              .filter((img) => !excludedSet.has(img.path))
              .map((img) => img.path),
          );
        } catch { /* ignore */ }
      }

      // Add individual files
      if (cfg.selectedFiles && cfg.selectedFiles.length > 0) {
        const existing = new Set(activePaths);
        for (const p of cfg.selectedFiles) {
          if (!existing.has(p) && !excludedSet.has(p)) {
            activePaths.push(p);
          }
        }
      }

      // Fallback: if no folders/files, use stored images list
      if (activePaths.length === 0 && cfg.images.length > 0) {
        activePaths = cfg.images
          .filter((img) => !excludedSet.has(img.path))
          .map((img) => img.path);
      }

      if (activePaths.length > 0) {
        // In shuffle mode, duplicate favorite paths 3x for weighted selection
        let finalPaths = activePaths;
        if (cfg.mode === "Shuffle" && cfg.favorites && cfg.favorites.length > 0) {
          const favSet = new Set(cfg.favorites);
          const extras: string[] = [];
          for (const p of activePaths) {
            if (favSet.has(p)) {
              extras.push(p, p); // 2 extra copies = 3x total
            }
          }
          finalPaths = [...activePaths, ...extras];
        }
        perMonitor.push({
          mid,
          paths: finalPaths,
          interval: cfg.interval,
          mode: cfg.mode,
        });
      }
    }

    if (perMonitor.length === 0) return;

    if ((syncEnabled || forceSynced) && perMonitor.length > 1) {
      const syncInterval = perMonitor[0].interval;
      const syncMode = perMonitor[0].mode;
      const monitorsData: [string, string[]][] = perMonitor.map((m) => [m.mid, m.paths]);
      await startSynced(monitorsData, syncInterval, syncMode);
    } else {
      for (const m of perMonitor) {
        await startFiles(m.mid, m.paths, m.interval, m.mode);
      }
    }
    await refresh();
  }, [syncEnabled, startFiles, refresh]);

  const handleToggleZen = useCallback(async () => {
    try {
      const anyRunningNow = Object.values(statuses).some((s) => s.is_running);

      const active = await toggleZenMode();
      setZenActive(active);

      if (active) {
        // Entering zen mode: save current slideshow state
        wasRunningBeforeZen.current = anyRunningNow;
        // If not running, start all slideshows with synced timers
        if (!anyRunningNow) {
          await handleStartAll(true);
        }
      } else {
        // Exiting zen mode: if slideshow wasn't running before, stop it
        if (!wasRunningBeforeZen.current) {
          await pause();
        }
      }
    } catch (e) {
      console.error("Zen mode toggle failed:", e);
    }
  }, [statuses, handleStartAll, pause]);

  // Keep ref in sync for ESC handler
  handleToggleZenRef.current = handleToggleZen;

  const selectedMonitorId =
    selectedMonitor !== null
      ? (monitors[selectedMonitor]?.id ?? "monitor_0")
      : "monitor_0";

  const handleSyncToggle = async (sourceMonitorId: string) => {
    const next = !syncEnabled;
    await setSync(next);
    if (next) {
      // Copy interval from the source monitor to all others
      await syncSettingsFromMonitor(sourceMonitorId);
      // If multiple slideshows running, restart them in sync
      const runningCount = Object.values(statuses).filter(
        (s) => s.is_running,
      ).length;
      if (runningCount >= 2) {
        await syncRestart();
      }
    }
  };

  const startFilesWithSync = async (
    monitorId: string,
    imagePaths: string[],
    intervalSecs: number,
    mode: "Sequential" | "Shuffle",
  ) => {
    if (!syncEnabled) {
      // Normal: start only this monitor
      await startFiles(monitorId, imagePaths, intervalSecs, mode);
    } else {
      // Sync: gather all monitors and start them in ONE call
      const allConfigs = await getAllMonitorConfigs();
      const monitorsData: [string, string[]][] = [];

      // Add the clicked monitor
      monitorsData.push([monitorId, imagePaths]);

      // Add other monitors from store
      for (const [mid, cfg] of Object.entries(allConfigs)) {
        if (mid === monitorId) continue;
        let activePaths = cfg.images
          .filter((img) => !cfg.excluded.includes(img.path))
          .map((img) => img.path);
        if (activePaths.length === 0) continue;
        // Apply favorite weighting in shuffle mode
        if (mode === "Shuffle" && cfg.favorites && cfg.favorites.length > 0) {
          const favSet = new Set(cfg.favorites);
          const extras: string[] = [];
          for (const p of activePaths) {
            if (favSet.has(p)) extras.push(p, p);
          }
          activePaths = [...activePaths, ...extras];
        }
        monitorsData.push([mid, activePaths]);
      }

      await startSynced(monitorsData, intervalSecs, mode);
    }
    await refresh();
  };

  const nextWithSync = async (monitorId: string) => {
    if (syncEnabled) {
      const running = Object.entries(statuses).filter(([, s]) => s.is_running);
      for (const [mid] of running) {
        await next(mid);
      }
    } else {
      await next(monitorId);
    }
  };

  const prevWithSync = async (monitorId: string) => {
    if (syncEnabled) {
      const running = Object.entries(statuses).filter(([, s]) => s.is_running);
      for (const [mid] of running) {
        await prev(mid);
      }
    } else {
      await prev(monitorId);
    }
  };

  const stopWithSync = async (monitorId: string) => {
    if (syncEnabled) {
      await pause();
    } else {
      await stop(monitorId);
    }
  };

  // Sync pin state from backend statuses
  useEffect(() => {
    const running = Object.values(statuses).filter((s) => s.is_running);
    if (running.length > 0) {
      setAllPinned(running.every((s) => s.is_pinned));
    } else {
      setAllPinned(false);
    }
  }, [statuses]);

  const anyRunning = Object.values(statuses).some((s) => s.is_running);
  const anyStopped = Object.values(statuses).some(
    (s) => !s.is_running && s.total_images > 0,
  );

  const handleHotkeyAction = useCallback(
    (action: string) => {
      switch (action) {
        case "toggle_slideshow":
          if (statuses[selectedMonitorId]?.is_running) {
            stop(selectedMonitorId);
          } else {
            handleStartAll();
          }
          break;
        case "zen_mode":
          handleToggleZen();
          break;
        case "pin_wallpaper":
          handleTogglePin();
          break;
        case "favorite_current":
          handleToggleFavoriteCurrent();
          break;
      }
    },
    [selectedMonitorId, statuses, nextWithSync, prevWithSync, stop, handleStartAll, handleToggleZen, handleTogglePin, handleToggleFavoriteCurrent],
  );

  const { hotkeys, updateHotkey } = useHotkeys(handleHotkeyAction);

  const selectedMon =
    selectedMonitor !== null ? monitors[selectedMonitor] : null;

  return (
    <div className="relative flex min-h-screen flex-col bg-ds-bg text-ds-text overflow-hidden">
      {/* Header */}
      <header className="relative z-10 shrink-0 bg-ds-card/80 backdrop-blur-xl border-b border-ds-border">
        <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2.5">
          {/* Logo */}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ds-accent">
            <svg
              className="h-4 w-4 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
          </div>
          <h1 className="text-ds-text text-base font-bold">{t("app.name")}</h1>
        </div>

        <div className="flex items-center gap-1 rounded-full px-1 py-1">
          {/* Pause All / Resume All */}
          {anyRunning && (
            <motion.button
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={pause}
              className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/20"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              {t("slideshow.pause_all")}
            </motion.button>
          )}
          {!anyRunning && !anyStopped && hasStoredConfigs && (
            <button
              onClick={() => handleStartAll()}
              className="flex items-center gap-1.5 rounded-full border border-ds-accent/30 bg-ds-accent/10 px-3 py-1.5 text-xs font-medium text-ds-accent-light transition hover:bg-ds-accent/20"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
              {t("slideshow.start_all")}
            </button>
          )}
          {anyStopped && !anyRunning && (
            <motion.button
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={() => handleStartAll()}
              className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/20"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
              {t("slideshow.resume_all")}
            </motion.button>
          )}

          {/* Layout toggle */}
          <button
            onClick={toggleLayout}
            className="rounded-full p-2 text-ds-text-muted transition hover:bg-ds-card-hover hover:text-ds-text"
            title={layout === "vertical" ? t("app.layout_horizontal") : t("app.layout_vertical")}
          >
            {layout === "vertical" ? (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h4m6-18h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v18" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9V5a2 2 0 012-2h14a2 2 0 012 2v4m-18 6v4a2 2 0 002 2h14a2 2 0 002-2v-4" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12h18" />
              </svg>
            )}
          </button>

          {/* Schedule shortcut */}
          <button
            onClick={() => setScheduleOpen(true)}
            className="rounded-full p-2 text-ds-text-muted transition hover:bg-ds-card-hover hover:text-ds-text"
            title={t("schedule.title")}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </button>

          {/* Settings gear */}
          <button
            onClick={() => { setSettingsTab("general"); setSettingsOpen(true); }}
            className="rounded-full p-2 text-ds-text-muted transition hover:bg-ds-card-hover hover:text-ds-text"
            title={t("app.settings")}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 overflow-y-auto px-6 py-5">
        <div className={`mx-auto ${layout === "horizontal" ? "flex max-w-6xl gap-5 items-start" : "max-w-4xl space-y-5"}`}>
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-ds-accent border-t-transparent" />
            </div>
          )}

          {/* Monitor layout diagram */}
          {!loading && monitors.length > 0 && (
            <div className={layout === "horizontal" ? "w-2/5 min-w-[280px] shrink-0 self-start" : ""}>
              <MonitorLayout
                monitors={monitors}
                statuses={statuses}
                selectedIndex={selectedMonitor}
                onSelect={setSelectedMonitor}
                zenActive={zenActive}
                onToggleZen={handleToggleZen}
                layout={layout}
              />
              {layout === "horizontal" && selectedMon && (
                <MonitorSource monitor={selectedMon} />
              )}
            </div>
          )}

          {/* Selected monitor config panel */}
          <div className={layout === "horizontal" ? "min-w-[380px] flex-1 overflow-y-auto" : ""}>
            {selectedMon ? (
              <MonitorCard
                monitor={selectedMon}
                status={statuses[selectedMon.id]}
                syncEnabled={syncEnabled}
                pinned={allPinned}
                onTogglePin={handleTogglePin}
                onSyncToggle={handleSyncToggle}
                onStartFiles={startFilesWithSync}
                onStop={stopWithSync}
                onRefresh={refresh}
                layout={layout}
                profiles={profiles}
                activeProfileId={activeProfileId}
                onSaveProfile={handleSaveProfile}
                onLoadProfile={handleLoadProfile}
                onDeleteProfile={handleDeleteProfile}
                onSetProfileThumbnail={handleSetProfileThumbnail}
                onRenameProfile={handleRenameProfile}
              />
            ) : (
              !loading &&
              monitors.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="rounded-2xl border border-dashed border-ds-border py-12 text-center text-sm text-ds-text-muted"
                >
                  {t("monitor.select_monitor")}
                </motion.div>
              )
            )}
          </div>
        </div>
      </main>

      {/* Settings modal */}
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        hotkeys={hotkeys}
        onUpdateHotkey={updateHotkey}
        monitorIds={monitors.map((m) => m.id)}
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
        theme={theme}
        onThemeChange={toggleTheme}
        accentId={accentId}
        onAccentChange={setAccent}
        customHex={customHex}
        onCustomAccentChange={setCustomAccent}
      />

      {/* Schedule modal */}
      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        monitorIds={monitors.map((m) => m.id)}
      />
    </div>
  );
}

export default App;
