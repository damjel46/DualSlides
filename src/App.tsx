import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { MonitorCard } from "./components/MonitorCard";
import { MonitorLayout } from "./components/MonitorLayout";
import { Settings } from "./components/Settings";
import { useMonitors } from "./hooks/useMonitors";
import { useSlideshow } from "./hooks/useSlideshow";
import { useHotkeys } from "./hooks/useHotkeys";
import { useAppConfig, syncIntervalFromMonitor, getAllMonitorConfigs } from "./hooks/useMonitorConfig";
import { usePro } from "./hooks/usePro";
import { startSynced, getImagesFromFolder, moveWindowToNextMonitor } from "./lib/commands";

function App() {
  const { t } = useTranslation();
  const { monitors, loading } = useMonitors();
  const {
    statuses, startFiles, stop, next, prev, pause, syncRestart, refresh,
  } = useSlideshow();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedMonitor, setSelectedMonitor] = useState<number | null>(null);
  const { syncEnabled, setSync } = useAppConfig();
  const { isPro, activate: activatePro } = usePro();
  const [hasStoredConfigs, setHasStoredConfigs] = useState(false);

  // Check if there are saved configs in store (for "Start All" on fresh launch)
  useEffect(() => {
    getAllMonitorConfigs().then((configs) => {
      const hasAny = Object.values(configs).some(
        (cfg) => cfg.images && cfg.images.length > 0,
      );
      setHasStoredConfigs(hasAny);
    });
  }, [statuses]);

  const handleStartAll = async () => {
    const allConfigs = await getAllMonitorConfigs();

    const perMonitor: { mid: string; paths: string[]; interval: number; mode: "Sequential" | "Shuffle" }[] = [];

    for (const [mid, cfg] of Object.entries(allConfigs)) {
      let activePaths: string[];

      if (cfg.selectionMode === "folder" && cfg.folder) {
        // Re-scan folder to get fresh file list
        try {
          const freshImages = await getImagesFromFolder(cfg.folder);
          const excludedSet = new Set(cfg.excluded);
          activePaths = freshImages
            .filter((img) => !excludedSet.has(img.path))
            .map((img) => img.path);
        } catch {
          activePaths = [];
        }
      } else {
        // File selection mode — use stored list
        const excludedSet = new Set(cfg.excluded);
        activePaths = cfg.images
          .filter((img) => !excludedSet.has(img.path))
          .map((img) => img.path);
      }

      if (activePaths.length > 0) {
        perMonitor.push({
          mid,
          paths: activePaths,
          interval: cfg.interval,
          mode: cfg.mode,
        });
      }
    }

    if (perMonitor.length === 0) return;

    if (syncEnabled && perMonitor.length > 1) {
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
  };

  const selectedMonitorId =
    selectedMonitor !== null
      ? (monitors[selectedMonitor]?.id ?? "monitor_0")
      : "monitor_0";

  const handleSyncToggle = async (sourceMonitorId: string) => {
    const next = !syncEnabled;
    await setSync(next);
    if (next) {
      // Copy interval from the source monitor to all others
      await syncIntervalFromMonitor(sourceMonitorId);
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
        const activePaths = cfg.images
          .filter((img) => !cfg.excluded.includes(img.path))
          .map((img) => img.path);
        if (activePaths.length > 0) {
          monitorsData.push([mid, activePaths]);
        }
      }

      await startSynced(monitorsData, intervalSecs, mode);
    }
    await refresh();
  };

  const stopWithSync = async (monitorId: string) => {
    if (syncEnabled) {
      await pause();
    } else {
      await stop(monitorId);
    }
  };

  const anyRunning = Object.values(statuses).some((s) => s.is_running);
  const anyStopped = Object.values(statuses).some(
    (s) => !s.is_running && s.total_images > 0,
  );

  const handleHotkeyAction = useCallback(
    (action: string) => {
      switch (action) {
        case "next_wallpaper":
          next(selectedMonitorId);
          break;
        case "prev_wallpaper":
          prev(selectedMonitorId);
          break;
        case "toggle_slideshow":
          if (statuses[selectedMonitorId]?.is_running) {
            stop(selectedMonitorId);
          } else {
            handleStartAll();
          }
          break;
        case "move_window":
          moveWindowToNextMonitor().catch((e) =>
            console.error("Move window failed:", e),
          );
          break;
      }
    },
    [selectedMonitorId, statuses, next, prev, stop],
  );

  const { hotkeys, updateHotkey } = useHotkeys(handleHotkeyAction, isPro);

  const selectedMon =
    selectedMonitor !== null ? monitors[selectedMonitor] : null;

  return (
    <div className="flex min-h-screen flex-col bg-ds-bg text-ds-text">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-ds-border px-5 py-3">
        <div className="flex items-center gap-2.5">
          {/* Logo */}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-ds-accent to-ds-accent-light">
            <svg
              className="h-4 w-4 text-white"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
          </div>
          <h1 className="text-base font-bold">{t("app.name")}</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Pause All / Resume All */}
          {anyRunning && (
            <motion.button
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={pause}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/20"
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
              onClick={handleStartAll}
              className="flex items-center gap-1.5 rounded-lg border border-ds-accent/30 bg-ds-accent/10 px-3 py-1.5 text-xs font-medium text-ds-accent-light transition hover:bg-ds-accent/20"
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
              onClick={handleStartAll}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/20"
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

          {/* Settings gear */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg p-2 text-ds-text-muted transition hover:bg-ds-card hover:text-ds-text"
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
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-4xl">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-ds-accent border-t-transparent" />
            </div>
          )}

          {/* Monitor layout diagram */}
          {!loading && monitors.length > 0 && (
            <MonitorLayout
              monitors={monitors}
              statuses={statuses}
              selectedIndex={selectedMonitor}
              onSelect={setSelectedMonitor}
            />
          )}

          {/* Selected monitor config panel */}
          {selectedMon ? (
            <MonitorCard
              monitor={selectedMon}
              status={statuses[selectedMon.id]}
              syncEnabled={syncEnabled}
              onSyncToggle={handleSyncToggle}
              onStartFiles={startFilesWithSync}
              onStop={stopWithSync}
              onNext={next}
              onPrev={prev}
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
      </main>

      {/* Settings modal */}
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        hotkeys={hotkeys}
        onUpdateHotkey={updateHotkey}
        isPro={isPro}
        onActivatePro={activatePro}
      />
    </div>
  );
}

export default App;
