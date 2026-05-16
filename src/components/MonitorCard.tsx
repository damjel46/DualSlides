import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { Toggle } from "./Settings";
import { toast } from "./Toast";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getImagesFromFolder, setTaskbarVisible, getTaskbarVisible, openFolder } from "../lib/commands";
import { useMonitorConfig, syncSettingsFromMonitor } from "../hooks/useMonitorConfig";
import type {
  MonitorInfo,
  ImageInfo,
  SlideshowMode,
  SlideshowStatus,
} from "../lib/commands";

const MAX_INTERVAL = 86400;

// ── Profile types ───────────────────────────────────────────────────
interface Profile {
  id: string;
  name: string;
  thumbnail: string | null; // user-chosen representative image path
  monitors: Record<string, {
    folders: string[];
    selectedFiles: string[];
    interval: number;
    mode: "Sequential" | "Shuffle";
  }>;
}


function SafeImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-ds-bg/50 ${className ?? ""}`}
      >
        <svg
          className="h-5 w-5 text-ds-text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

function ImageGrid({
  images,
  excluded,
  favorites,
  currentImage,
  onToggle,
  onToggleFavorite,
  onReorder,
  filterFavorites,
}: {
  images: ImageInfo[];
  excluded: Set<string>;
  favorites: Set<string>;
  currentImage: string | undefined | null;
  onToggle: (path: string) => void;
  onToggleFavorite: (path: string) => void;
  onReorder: (imgs: ImageInfo[]) => void;
  filterFavorites: boolean;
}) {
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [dragState, setDragState] = useState<{
    path: string;
    x: number;
    y: number;
    w: number;
    h: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Pointer move/up are on window so dragging works even outside the grid
  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      setDragState((prev) =>
        prev ? { ...prev, x: e.clientX - prev.offsetX, y: e.clientY - prev.offsetY } : prev,
      );
    };
    const onUp = (e: PointerEvent) => {
      // Find drop target: closest item center to pointer
      const px = e.clientX;
      const py = e.clientY;
      let closestPath: string | null = null;
      let closestDist = Infinity;
      for (const [path, el] of itemRefs.current) {
        if (path === dragState.path) continue;
        const r = el.getBoundingClientRect();
        const dx = r.left + r.width / 2 - px;
        const dy = r.top + r.height / 2 - py;
        const dist = dx * dx + dy * dy;
        if (dist < closestDist) {
          closestDist = dist;
          closestPath = path;
        }
      }
      if (closestPath) {
        const fromIdx = images.findIndex((i) => i.path === dragState.path);
        const toIdx = images.findIndex((i) => i.path === closestPath);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const next = [...images];
          const [moved] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, moved);
          onReorder(next);
        }
      }
      setDragState(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragState, images, onReorder]);

  const startDrag = (path: string, e: React.PointerEvent) => {
    const el = itemRefs.current.get(path);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDragState({
      path,
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    });
  };

  const displayImages = filterFavorites ? images.filter((img) => favorites.has(img.path)) : images;

  return (
    <>
      <div className="flex max-h-96 flex-wrap content-start gap-3 overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-ds-bg/30 p-3">
        {displayImages.map((img) => {
          const isChecked = !excluded.has(img.path);
          const isCurrent = currentImage === img.path;
          const isFav = favorites.has(img.path);
          const isBeingDragged = dragState?.path === img.path;
          return (
            <div
              key={img.path}
              ref={(el) => {
                if (el) itemRefs.current.set(img.path, el);
                else itemRefs.current.delete(img.path);
              }}
              className={`group relative h-24 shrink-0 transition-transform duration-200 ${
                !isBeingDragged && isChecked && !isCurrent ? "group-hover:scale-110" : ""
              } ${isCurrent ? "scale-110" : ""}`}
              style={{ opacity: isBeingDragged ? 0.3 : 1 }}
            >
              {/* Drag handle */}
              <div
                onPointerDown={(e) => {
                  e.preventDefault();
                  startDrag(img.path, e);
                }}
                className="absolute inset-x-0 top-0 z-20 flex cursor-grab justify-center rounded-t-lg bg-black/40 py-1 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
                style={{ touchAction: "none" }}
              >
                <div className="h-0.5 w-6 rounded-full bg-white/60" />
              </div>

              {/* Click to toggle */}
              <button
                onClick={() => onToggle(img.path)}
                className="h-full select-none"
                draggable={false}
              >
                <SafeImage
                  src={convertFileSrc(img.path)}
                  alt={img.filename}
                  className={`pointer-events-none h-full min-w-16 w-auto rounded-lg transition-all duration-200 ${
                    !isChecked
                      ? "opacity-30 grayscale ring-1 ring-ds-border"
                      : isCurrent
                        ? "ring-2 ring-ds-accent"
                        : "opacity-80 ring-1 ring-ds-border group-hover:opacity-100"
                  }`}
                />
              </button>

              {/* Check indicator */}
              {isChecked && (
                <div className="pointer-events-none absolute top-3.5 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-ds-accent text-white">
                  <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              )}

              {/* Favorite heart */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(img.path); }}
                className={`absolute top-3.5 left-1 z-20 flex h-5 w-5 items-center justify-center rounded-full transition ${
                  isFav
                    ? "bg-red-500/80 text-white opacity-100"
                    : "bg-black/40 text-white/60 opacity-0 group-hover:opacity-100 hover:text-red-400"
                }`}
              >
                <svg className="h-3 w-3" fill={isFav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>

              {/* Filename */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 opacity-0 transition group-hover:opacity-100">
                <span className="block truncate text-[9px] text-white">
                  {img.filename}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating drag ghost — follows cursor */}
      {dragState && (() => {
        const img = images.find((i) => i.path === dragState.path);
        if (!img) return null;
        return (
          <div
            className="pointer-events-none fixed z-[9999] h-24 rounded-lg shadow-2xl ring-2 ring-ds-accent"
            style={{
              left: dragState.x,
              top: dragState.y,
              width: dragState.w,
            }}
          >
            <SafeImage
              src={convertFileSrc(img.path)}
              alt={img.filename}
              className="h-full w-full rounded-lg object-cover"
            />
          </div>
        );
      })()}
    </>
  );
}

interface MonitorCardProps {
  monitor: MonitorInfo;
  status: SlideshowStatus | undefined;
  syncEnabled: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onSyncToggle: (sourceMonitorId: string) => void;
  onStartFiles: (
    monitorId: string,
    imagePaths: string[],
    intervalSecs: number,
    mode: SlideshowMode,
  ) => void;
  onStop: (monitorId: string) => void;
  onRefresh: () => void;
  layout?: "vertical" | "horizontal";
  profiles: Profile[];
  activeProfileId: string | null;
  onSaveProfile: (name?: string, thumbnail?: string | null) => void;
  onLoadProfile: (id: string, skipConfirm?: boolean) => void;
  onDeleteProfile: (id: string) => void;
  onSetProfileThumbnail: (id: string, path: string) => void;
  onRenameProfile: (id: string, name: string) => void;
  onUpdateProfile: (id: string) => void;
  configReloadKey?: number;
}

const PRESETS = [
  { value: 10, key: "10s" },
  { value: 30, key: "30s" },
  { value: 60, key: "1m" },
  { value: 300, key: "5m" },
  { value: 600, key: "10m" },
  { value: 1800, key: "30m" },
  { value: 3600, key: "1h" },
];

export function MonitorCard({
  monitor,
  status,
  syncEnabled,
  pinned,
  onTogglePin: _onTogglePin,
  onSyncToggle,
  onStartFiles,
  onStop,
  onRefresh: _onRefresh,
  layout = "vertical",
  profiles,
  activeProfileId,
  onSaveProfile,
  onLoadProfile,
  onDeleteProfile,
  onSetProfileThumbnail,
  onRenameProfile,
  onUpdateProfile,
  configReloadKey,
}: MonitorCardProps) {
  const { t } = useTranslation();
  const { config, update, loaded } = useMonitorConfig(monitor.id, configReloadKey);
  const [taskbarHidden, setTaskbarHidden] = useState(false);
  const [profileMenu, setProfileMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [profileEdit, setProfileEdit] = useState<{ id: string | null; name: string; thumbnail: string | null; isNew?: boolean } | null>(null);

  // Close profile context menu on click outside
  useEffect(() => {
    if (!profileMenu) return;
    const close = () => setProfileMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [profileMenu]);

  // Read initial taskbar visibility
  const monitorIndex = parseInt(monitor.id.replace("monitor_", ""), 10);
  useEffect(() => {
    getTaskbarVisible(monitorIndex, monitor.x, monitor.y, monitor.width, monitor.height)
      .then((visible) => setTaskbarHidden(!visible))
      .catch(() => {});
  }, [monitorIndex, monitor.x, monitor.y, monitor.width, monitor.height]);

  const handleTaskbarToggle = async () => {
    const newHidden = !taskbarHidden;
    try {
      await setTaskbarVisible(monitorIndex, monitor.x, monitor.y, monitor.width, monitor.height, !newHidden);
      setTaskbarHidden(newHidden);
    } catch (e) {
      console.error("Taskbar toggle failed:", e);
    }
  };

  // Destructure for convenience
  const {
    folder, folders: foldersArr, selectedFiles, images, excluded: excludedArr, favorites: favoritesArr,
    filterFavorites, selectionMode: _selectionMode, interval, useCustom, customInput, mode,
  } = config;
  const setFilterFavorites = (val: boolean) => update({ filterFavorites: val });
  const excluded = new Set(excludedArr || []);
  const favorites = new Set(favoritesArr || []);

  // Compute effective interval once for use everywhere
  const effectiveInterval = useCustom ? Math.max(1, Math.min(MAX_INTERVAL, Number(customInput) || interval)) : interval;

  // Build the image path list that would be used if we started/applied now
  const buildActivePaths = () => {
    let activePaths = images
      .filter((img) => !excluded.has(img.path))
      .map((img) => img.path);
    // Favorites only mode: play only favorited images
    if (filterFavorites && favorites.size > 0) {
      activePaths = activePaths.filter((p) => favorites.has(p));
    }
    if (mode === "Shuffle" && favorites.size > 0 && !filterFavorites) {
      const extras: string[] = [];
      for (const p of activePaths) {
        if (favorites.has(p)) extras.push(p, p);
      }
      return [...activePaths, ...extras];
    }
    return activePaths;
  };

  // Detect if running slideshow settings differ from config
  // Only compare after config is fully loaded to prevent false positives during monitor switch
  const isRunning = status?.is_running ?? false;
  const currentPaths = buildActivePaths();
  const settingsChanged = loaded && isRunning && (
    status!.interval_secs !== effectiveInterval ||
    status!.mode !== mode ||
    status!.total_images !== currentPaths.length
  );

  const handleApplySettings = () => {
    // Use onStartFiles which handles sync mode properly (restarts all monitors together)
    onStartFiles(monitor.id, currentPaths, effectiveInterval, mode);
  };

  // Auto-apply when image count changes during running slideshow (folder add/remove detected by auto-refresh)
  const prevImageCount = useRef(status?.total_images ?? 0);
  useEffect(() => {
    if (!loaded || !isRunning) {
      prevImageCount.current = currentPaths.length;
      return;
    }
    const runningCount = status!.total_images;
    if (currentPaths.length !== runningCount && currentPaths.length > 0 && currentPaths.length !== prevImageCount.current) {
      prevImageCount.current = currentPaths.length;
      onStartFiles(monitor.id, currentPaths, effectiveInterval, mode);
    }
  }, [currentPaths.length, loaded]);

  // Effective folders list: migrate from legacy single `folder` field
  const folders = foldersArr && foldersArr.length > 0 ? foldersArr : folder ? [folder] : [];

  // Shared scan function
  const scanImages = async (isInitial: boolean) => {
    try {
      const folderImages: import("../lib/commands").ImageInfo[] = [];
      for (const f of folders) {
        const fresh = await getImagesFromFolder(f);
        folderImages.push(...fresh);
      }
      const fileImages: import("../lib/commands").ImageInfo[] = selectedFiles.map((p) => ({
        path: p,
        filename: p.split(/[/\\]/).pop() || p,
        size_bytes: 0,
      }));
      const seen = new Set<string>();
      const allFresh: import("../lib/commands").ImageInfo[] = [];
      for (const img of [...folderImages, ...fileImages]) {
        if (!seen.has(img.path)) {
          seen.add(img.path);
          allFresh.push(img);
        }
      }
      const freshPaths = new Set(allFresh.map((f) => f.path));
      const oldPaths = new Set(images.map((f) => f.path));
      if (
        !isInitial &&
        allFresh.length === images.length &&
        allFresh.every((f) => oldPaths.has(f.path))
      ) return;
      if (isInitial && images.length === 0) {
        update({ images: allFresh, excluded: [] });
      } else {
        const kept = images.filter((img) => freshPaths.has(img.path));
        const keptPaths = new Set(kept.map((k) => k.path));
        const added = allFresh.filter((f) => !keptPaths.has(f.path));
        const merged = [...kept, ...added];
        const cleanExcluded = excludedArr.filter((p) => freshPaths.has(p));
        update({ images: merged, excluded: cleanExcluded });
      }
    } catch { /* ignore */ }
  };

  // 1) Immediate scan when folders/files list changes
  useEffect(() => {
    if (!loaded) return;
    if (folders.length === 0 && selectedFiles.length === 0) return;
    scanImages(images.length === 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.join("|"), selectedFiles.join("|"), loaded]);

  // 2) Background polling: detect images added/removed inside folders
  useEffect(() => {
    if (!loaded || folders.length === 0) return;
    const id = window.setInterval(() => scanImages(false), 5000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.join("|"), loaded]);

  const handleAddFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const path = selected as string;
      if (folders.includes(path)) return;
      const newFolders = [...folders, path];
      update({
        folders: newFolders,
        folder: newFolders[0],
        selectionMode: "folder",
      });
    }
  };

  const handleRemoveFolder = (folderPath: string) => {
    const newFolders = folders.filter((f) => f !== folderPath);
    update({
      folders: newFolders,
      folder: newFolders[0] || "",
    });
  };

  const handleSelectFiles = async () => {
    const selected = await open({
      directory: false,
      multiple: true,
      filters: [
        { name: "Images", extensions: ["jpg", "jpeg", "png", "bmp", "webp"] },
      ],
    });
    if (selected && Array.isArray(selected) && selected.length > 0) {
      const paths = selected as string[];
      // Append to existing selectedFiles, deduplicate
      const existing = new Set(selectedFiles);
      const newFiles = paths.filter((p) => !existing.has(p));
      update({
        selectedFiles: [...selectedFiles, ...newFiles],
      });
    }
  };

  const toggleCheck = (path: string) => {
    const next = new Set(excluded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    update({ excluded: [...next] });
  };

  const toggleFavorite = (path: string) => {
    const next = new Set(favorites);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    update({ favorites: [...next] });
  };

  const setImages = (imgs: ImageInfo[]) => update({ images: imgs });

  const checkedCount = images.length - excluded.size;

  const handlePresetChange = async (val: string) => {
    if (val === "custom") {
      update({ useCustom: true, customInput: String(interval) });
    } else {
      update({ useCustom: false, interval: Number(val) });
    }
    if (syncEnabled) {
      // Wait for store save, then sync to others
      setTimeout(() => syncSettingsFromMonitor(monitor.id), 50);
    }
  };

  const handleCustomBlur = async () => {
    let v = parseInt(customInput, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > MAX_INTERVAL) v = MAX_INTERVAL;
    update({ interval: v, customInput: String(v) });
    if (syncEnabled) {
      setTimeout(() => syncSettingsFromMonitor(monitor.id), 50);
    }
  };

  const hasImages = checkedCount > 0;

  const handlePlay = () => {
    const paths = buildActivePaths();
    if (paths.length === 0) return;
    onStartFiles(monitor.id, paths, effectiveInterval, mode);
  };


  if (!loaded) return null;

  return (
    <div className="rounded-2xl border border-ds-border bg-ds-card overflow-hidden">

      <div className="p-5">
      {/* Header + Source — hidden in horizontal layout (shown in MonitorSource instead) */}
      {layout !== "horizontal" && (
        <>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-ds-text">
            {monitor.name}
          </h3>
          {monitor.is_primary && (
            <span className="rounded-md bg-ds-accent/20 px-2 py-0.5 text-[10px] font-bold text-ds-accent-light">
              {t("monitor.primary")}
            </span>
          )}
        </div>
        <span className="text-xs text-ds-text-muted">
          {monitor.width}x{monitor.height}
        </span>
      </div>

      {/* Source selection */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-0.5 h-4 rounded-full bg-ds-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-ds-text-muted">{t("monitor.source", { defaultValue: "Source" })}</span>
        </div>
      </div>
      <div className="mb-4 space-y-2">
        {/* Source list: folders + individual files */}
        {(folders.length > 0 || selectedFiles.length > 0) && (
          <div className="space-y-1">
            {folders.map((f) => (
              <div key={f} className="flex items-center gap-2 rounded-xl border border-ds-accent/30 bg-ds-accent/5 px-3 py-2">
                <svg className="h-4 w-4 shrink-0 text-ds-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <button
                  className="flex-1 truncate text-left text-sm text-ds-text hover:text-ds-accent-light transition cursor-pointer"
                  title={f}
                  onClick={() => openFolder(f)}
                >
                  {f.split(/[/\\]/).pop()}
                </button>
                <button
                  onClick={() => handleRemoveFolder(f)}
                  className="shrink-0 rounded-lg p-1 text-ds-text-muted transition hover:bg-red-500/20 hover:text-red-400"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {selectedFiles.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-ds-accent/30 bg-ds-accent/5 px-3 py-2">
                <svg className="h-4 w-4 shrink-0 text-ds-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="flex-1 text-sm text-ds-text">
                  {t("monitor.folder_images", { count: selectedFiles.length })}
                </span>
                <button
                  onClick={() => update({ selectedFiles: [] })}
                  className="shrink-0 rounded-lg p-1 text-ds-text-muted transition hover:bg-red-500/20 hover:text-red-400"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action buttons row */}
        <div className="flex gap-2">
          <button
            onClick={handleAddFolder}
            className="flex flex-1 items-center gap-2 rounded-xl border border-dashed border-ds-border px-3 py-2.5 text-left text-sm transition hover:border-ds-accent/50 hover:bg-ds-accent/5"
          >
            <svg className="h-4 w-4 shrink-0 text-ds-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-ds-text-muted">
              {t("monitor.add_folder", { defaultValue: "Add folder" })}
            </span>
          </button>
          <button
            onClick={handleSelectFiles}
            className="flex flex-1 items-center gap-2 rounded-xl border border-dashed border-ds-border px-3 py-2.5 text-left text-sm transition hover:border-ds-accent/50 hover:bg-ds-accent/5"
          >
            <svg className="h-4 w-4 shrink-0 text-ds-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-ds-text-muted">
              {t("monitor.add_images", { defaultValue: "Add images" })}
            </span>
          </button>
        </div>

      </div>
        </>
      )}

      {/* Image preview with checkboxes + drag reorder */}
      {images.length > 0 && (
        <div className="mb-4">
          {/* Preview header */}
          <div className="mb-2 flex items-center gap-2 text-xs text-ds-text-dim">
            {t("monitor.preview")}
            <span className="text-ds-text-muted">
              ({checkedCount}/{images.length})
            </span>
          </div>

          {/* Select all / Deselect all / Favorites filter */}
          <div className="mb-1.5 flex items-center gap-2 text-[10px]">
            <button
              onClick={() => update({ excluded: [] })}
              title={t("monitor.select_all_tip")}
              className="rounded-md border border-ds-accent/30 bg-ds-accent/10 px-2 py-0.5 font-medium text-ds-accent-light transition hover:bg-ds-accent/25 active:scale-95"
            >
              {t("monitor.select_all")}
            </button>
            <button
              onClick={() =>
                update({ excluded: images.map((img) => img.path) })
              }
              title={t("monitor.deselect_all_tip")}
              className="rounded-md border border-ds-border px-2 py-0.5 font-medium text-ds-text-muted transition hover:bg-ds-card-hover hover:text-ds-text active:scale-95"
            >
              {t("monitor.deselect_all")}
            </button>
            <button
              onClick={() => {
                if (!filterFavorites && favorites.size === 0) {
                  toast(t("favorite.no_favorites"), "warning");
                  return;
                }
                setFilterFavorites(!filterFavorites);
              }}
              className={`flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium transition active:scale-95 ${
                filterFavorites
                  ? "border-red-400/40 bg-red-500/15 text-red-400"
                  : "border-ds-border text-ds-text-muted hover:border-red-400/40 hover:bg-red-500/5 hover:text-red-400"
              }`}
            >
              <svg className="h-3 w-3" fill={filterFavorites ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {t("favorite.filter")}
            </button>
            <button
              onClick={() => { onStop(monitor.id); update({ folders: [], selectedFiles: [], images: [], excluded: [] }); }}
              title={t("monitor.delete_all_tip")}
              className="ml-auto flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-0.5 font-medium text-red-400/70 transition hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-400 active:scale-95"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {t("monitor.delete_all")}
            </button>
          </div>

          <div className="max-h-[270px] overflow-y-auto rounded-lg">
            <ImageGrid
              images={images}
              excluded={excluded}
              favorites={favorites}
              currentImage={status?.current_image}
              onToggle={toggleCheck}
              onToggleFavorite={toggleFavorite}
              onReorder={setImages}
              filterFavorites={filterFavorites}
            />
          </div>
        </div>
      )}

      {/* Controls row: Interval → Sync → Mode */}
      <div className="mb-4 space-y-3">
        {/* Section header */}
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-4 rounded-full bg-ds-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-ds-text-muted">{t("monitor.interval")}</span>
        </div>

        {/* Interval segmented control */}
        <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-xl bg-ds-bg/50 p-1">
          {PRESETS.map((p) => {
            const isActive = !useCustom && interval === p.value;
            return (
              <button
                key={p.value}
                onClick={() => handlePresetChange(String(p.value))}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-ds-accent text-white"
                    : "text-ds-text-muted hover:text-ds-text hover:bg-ds-card-hover"
                }`}
              >
                {t(`interval.${p.key}`)}
              </button>
            );
          })}
          <button
            onClick={() => handlePresetChange("custom")}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              useCustom
                ? "bg-ds-accent text-white"
                : "text-ds-text-muted hover:text-ds-text hover:bg-ds-card-hover"
            }`}
          >
            {t("interval.custom")}
          </button>
        </div>
          {useCustom && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={MAX_INTERVAL}
                value={customInput}
                onChange={(e) => update({ customInput: e.target.value })}
                onBlur={handleCustomBlur}
                onKeyDown={(e) => e.key === "Enter" && handleCustomBlur()}
                className="w-16 rounded-lg border border-ds-border bg-ds-bg/50 px-2 py-1.5 text-center text-xs text-ds-text [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                placeholder="sec"
              />
              <span className="text-[10px] text-ds-text-muted">{t("interval.seconds")}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">

        <div className="flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-bg/30 px-2.5 py-1.5" title={t("slideshow.sync_settings_tip")}>
          <Toggle checked={syncEnabled} onChange={() => onSyncToggle(monitor.id)} />
          <span className="text-xs font-medium text-ds-text">{t("slideshow.sync_settings")}</span>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-bg/30 px-2.5 py-1.5" title={t("monitor.hide_taskbar_tip")}>
          <Toggle checked={taskbarHidden} onChange={handleTaskbarToggle} />
          <span className="text-xs font-medium text-ds-text">{t("monitor.hide_taskbar")}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-ds-text-muted">{t("monitor.mode")}</span>
          <div className="flex rounded-lg overflow-hidden bg-ds-bg/50">
            <button
              onClick={() => { update({ mode: "Sequential" }); if (syncEnabled) setTimeout(() => syncSettingsFromMonitor(monitor.id), 50); }}
              className={`px-2.5 py-1.5 text-xs font-medium transition-all ${
                mode === "Sequential"
                  ? "bg-ds-accent text-white"
                  : "text-ds-text-muted hover:text-ds-text hover:bg-ds-card-hover"
              }`}
            >
              {t("slideshow.sequential")}
            </button>
            <button
              onClick={() => { update({ mode: "Shuffle" }); if (syncEnabled) setTimeout(() => syncSettingsFromMonitor(monitor.id), 50); }}
              className={`px-2.5 py-1.5 text-xs font-medium transition-all ${
                mode === "Shuffle"
                  ? "bg-ds-accent text-white"
                  : "text-ds-text-muted hover:text-ds-text hover:bg-ds-card-hover"
              }`}
            >
              {t("slideshow.shuffle")}
            </button>
          </div>


        </div>
        </div>
      </div>

      {/* Playback controls with profiles */}
      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-ds-bg/50 py-3 px-3">
        {/* Left 3 profile slots */}
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => {
            const prof = profiles[i];
            return prof ? (
              <button
                key={prof.id}
                onClick={() => onLoadProfile(prof.id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setProfileMenu({ id: prof.id, x: e.clientX, y: e.clientY }); }}
                className={`relative flex h-10 w-14 items-center justify-center overflow-hidden rounded-lg border transition active:scale-90 ${
                  activeProfileId === prof.id
                    ? "border-ds-accent bg-ds-accent/10"
                    : "border-ds-border bg-ds-card hover:border-ds-accent/30"
                }`}
                title={`${prof.name} (Ctrl+Alt+${i + 1})`}
              >
                {prof.thumbnail ? (
                  <img src={convertFileSrc(prof.thumbnail)} className="absolute inset-0 h-full w-full object-cover opacity-30" alt="" />
                ) : null}
                <span className="relative z-10 truncate px-0.5 text-[9px] font-medium text-ds-text">{prof.name}</span>
              </button>
            ) : (
              <button
                key={`add-l-${i}`}
                onClick={() => setProfileEdit({ id: null, name: `Profile ${profiles.length + 1}`, thumbnail: null, isNew: true })}
                className="flex h-10 w-14 items-center justify-center rounded-lg border border-dashed border-ds-border/30 text-ds-text-muted/30 transition hover:border-ds-accent/20 hover:text-ds-accent-light/50 active:scale-90"
                title={t("profile.save")}
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            );
          })}
        </div>

        {/* Center play/pause/apply */}
        <div className="flex-1 flex justify-center">
        <AnimatePresence mode="wait">
          {settingsChanged ? (
            <motion.button
              key="apply"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={handleApplySettings}
              className="flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-xl bg-emerald-500/20 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/30"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {t("slideshow.apply")}
            </motion.button>
          ) : isRunning ? (
            <motion.button
              key="pause"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={() => onStop(monitor.id)}
              className="flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-xl bg-red-500/20 text-sm font-medium text-red-400 transition hover:bg-red-500/30"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {t("slideshow.pause")}
            </motion.button>
          ) : (
            <motion.button
              key="play"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={handlePlay}
              disabled={!hasImages}
              className="flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-xl bg-ds-accent text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-30"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              {t("slideshow.play")}
            </motion.button>
          )}
        </AnimatePresence>
        </div>

        {/* Right 3 profile slots */}
        <div className="flex gap-1.5">
          {[3, 4, 5].map((i) => {
            const prof = profiles[i];
            return prof ? (
              <button
                key={prof.id}
                onClick={() => onLoadProfile(prof.id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setProfileMenu({ id: prof.id, x: e.clientX, y: e.clientY }); }}
                className={`relative flex h-10 w-14 items-center justify-center overflow-hidden rounded-lg border transition active:scale-90 ${
                  activeProfileId === prof.id
                    ? "border-ds-accent bg-ds-accent/10"
                    : "border-ds-border bg-ds-card hover:border-ds-accent/30"
                }`}
                title={`${prof.name} (Ctrl+Alt+${i + 1})`}
              >
                {prof.thumbnail ? (
                  <img src={convertFileSrc(prof.thumbnail)} className="absolute inset-0 h-full w-full object-cover opacity-30" alt="" />
                ) : null}
                <span className="relative z-10 truncate px-0.5 text-[9px] font-medium text-ds-text">{prof.name}</span>
              </button>
            ) : (
              <button
                key={`add-r-${i}`}
                onClick={() => setProfileEdit({ id: null, name: `Profile ${profiles.length + 1}`, thumbnail: null, isNew: true })}
                className="flex h-10 w-14 items-center justify-center rounded-lg border border-dashed border-ds-border/30 text-ds-text-muted/30 transition hover:border-ds-accent/20 hover:text-ds-accent-light/50 active:scale-90"
                title={t("profile.save")}
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            );
          })}
        </div>
      </div>

      {/* Status bar */}
      {status && (
        <div className="flex items-center justify-between text-xs text-ds-text-muted">
          <div className="flex items-center gap-2">
            <span>
              {status.current_index + 1} / {status.total_images}
            </span>
            {pinned && (
              <span className="rounded-md bg-ds-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-ds-accent-light">
                {t("pin.pinned")}
              </span>
            )}
          </div>
          {status.current_image && (
            <span className="max-w-[200px] truncate">
              {status.current_image.split(/[/\\]/).pop()}
            </span>
          )}
        </div>
      )}
      </div>

      {/* Profile context menu */}
      {profileMenu && (() => {
        const prof = profiles.find((p) => p.id === profileMenu.id);
        if (!prof) return null;
        const menuH = 120;
        const flipUp = profileMenu.y + menuH > window.innerHeight;
        const posStyle = flipUp
          ? { left: profileMenu.x, bottom: window.innerHeight - profileMenu.y }
          : { left: profileMenu.x, top: profileMenu.y };
        return (
          <div
            className="fixed z-50 min-w-[160px] rounded-lg border border-ds-border bg-ds-card py-1 shadow-xl"
            style={posStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setProfileEdit({ id: prof.id, name: prof.name, thumbnail: prof.thumbnail }); setProfileMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ds-text hover:bg-white/5"
            >
              {t("profile.edit", { defaultValue: "Edit profile" })}
            </button>
            <button
              onClick={() => { onUpdateProfile(prof.id); setProfileMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-ds-text hover:bg-white/5"
            >
              {t("profile.update", { defaultValue: "Update with current settings" })}
            </button>
            <div className="my-1 h-px bg-ds-border/50" />
            <button
              onClick={() => { onDeleteProfile(prof.id); setProfileMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
            >
              {t("profile.delete", { defaultValue: "Delete profile" })}
            </button>
          </div>
        );
      })()}

      {/* Profile edit modal */}
      {profileEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setProfileEdit(null)}>
          <div className="w-72 rounded-xl border border-ds-border bg-ds-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-ds-text">{t("profile.edit")}</h3>

            {/* Name */}
            <label className="mb-1 block text-[10px] font-medium text-ds-text-muted">{t("profile.name")}</label>
            <input
              type="text"
              value={profileEdit.name}
              onChange={(e) => setProfileEdit({ ...profileEdit, name: e.target.value })}
              className="mb-3 w-full rounded-lg border border-ds-border bg-ds-bg/50 px-2.5 py-1.5 text-xs text-ds-text focus:border-ds-accent/50 focus:outline-none"
              autoFocus
            />

            {/* Thumbnail preview + change */}
            <label className="mb-1 block text-[10px] font-medium text-ds-text-muted">{t("profile.thumbnail")}</label>
            <div
              className="mb-3 group relative h-28 w-full cursor-pointer overflow-hidden rounded-xl border border-ds-border bg-ds-bg/30"
              onClick={async () => {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const selected = await open({ multiple: false, filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "bmp", "webp"] }] });
                if (selected && typeof selected === "string") {
                  setProfileEdit({ ...profileEdit, thumbnail: selected });
                }
              }}
            >
              {profileEdit.thumbnail ? (
                <img src={convertFileSrc(profileEdit.thumbnail)} className="h-full w-full object-cover" alt="" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-ds-text-muted">{t("profile.no_image")}</div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                <span className="text-xs font-medium text-white">{t("profile.thumbnail_change")}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setProfileEdit(null)}
                className="rounded-lg px-3 py-1.5 text-xs text-ds-text-muted hover:bg-white/5"
              >
                {t("app.cancel", { defaultValue: "Cancel" })}
              </button>
              <button
                onClick={() => {
                  if (profileEdit.name.trim()) {
                    if (profileEdit.isNew) {
                      onSaveProfile(profileEdit.name.trim(), profileEdit.thumbnail);
                    } else if (profileEdit.id) {
                      onRenameProfile(profileEdit.id, profileEdit.name.trim());
                      onSetProfileThumbnail(profileEdit.id, profileEdit.thumbnail || "");
                    }
                  }
                  setProfileEdit(null);
                }}
                className="rounded-lg bg-ds-accent/20 px-3 py-1.5 text-xs text-ds-accent-light hover:bg-ds-accent/30"
              >
                {t("app.save", { defaultValue: "Save" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
