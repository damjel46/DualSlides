import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getImagesFromFolder, setTaskbarVisible, getTaskbarVisible } from "../lib/commands";
import { useMonitorConfig, syncIntervalFromMonitor } from "../hooks/useMonitorConfig";
import type {
  MonitorInfo,
  ImageInfo,
  SlideshowMode,
  SlideshowStatus,
} from "../lib/commands";

const MAX_INTERVAL = 86400;

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
      <div className="flex max-h-96 flex-wrap content-start gap-1.5 overflow-x-hidden overflow-y-auto rounded-xl border border-ds-border bg-ds-bg/30 p-2">
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
              className="group relative h-24 shrink-0"
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
                      ? "opacity-30 grayscale ring-1 ring-white/5"
                      : isCurrent
                        ? "ring-2 ring-indigo-500 hover:scale-110"
                        : "opacity-80 ring-1 ring-white/5 group-hover:opacity-100 group-hover:scale-110"
                  }`}
                />
              </button>

              {/* Check indicator */}
              {isChecked && (
                <div className="pointer-events-none absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-ds-accent text-white">
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
                className={`absolute top-1 left-1 z-20 flex h-5 w-5 items-center justify-center rounded-full transition ${
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
  onNext: (monitorId: string) => void;
  onPrev: (monitorId: string) => void;
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
  onTogglePin,
  onSyncToggle,
  onStartFiles,
  onStop,
  onNext,
  onPrev,
}: MonitorCardProps) {
  const { t } = useTranslation();
  const { config, update, loaded } = useMonitorConfig(monitor.id);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [taskbarHidden, setTaskbarHidden] = useState(false);

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

  const [filterFavorites, setFilterFavorites] = useState(false);

  // Destructure for convenience
  const {
    folder, folders: foldersArr, selectedFiles, images, excluded: excludedArr, favorites: favoritesArr,
    selectionMode, interval, useCustom, customInput, mode, autoRefresh,
  } = config;
  const excluded = new Set(excludedArr);
  const favorites = new Set(favoritesArr);

  // Effective folders list: migrate from legacy single `folder` field
  const folders = foldersArr && foldersArr.length > 0 ? foldersArr : folder ? [folder] : [];

  // Scan all folders + merge with selectedFiles
  useEffect(() => {
    if (!loaded) return;
    if (folders.length === 0 && selectedFiles.length === 0) return;
    let cancelled = false;

    const scan = async (isInitial: boolean) => {
      try {
        // 1. Scan all folders
        const folderImages: import("../lib/commands").ImageInfo[] = [];
        for (const f of folders) {
          const fresh = await getImagesFromFolder(f);
          folderImages.push(...fresh);
        }

        // 2. Build individual file entries
        const fileImages: import("../lib/commands").ImageInfo[] = selectedFiles.map((p) => ({
          path: p,
          filename: p.split(/[/\\]/).pop() || p,
          size_bytes: 0,
        }));

        // 3. Combine, deduplicate by path
        const seen = new Set<string>();
        const allFresh: import("../lib/commands").ImageInfo[] = [];
        for (const img of [...folderImages, ...fileImages]) {
          if (!seen.has(img.path)) {
            seen.add(img.path);
            allFresh.push(img);
          }
        }

        if (cancelled) return;
        const freshPaths = new Set(allFresh.map((f) => f.path));
        const oldPaths = new Set(images.map((f) => f.path));

        // Skip update if nothing changed
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
      } catch {
        /* ignore */
      }
    };

    scan(images.length === 0);
    let id: number | undefined;
    if (autoRefresh && folders.length > 0) {
      id = window.setInterval(() => scan(false), 5000);
    }
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders.join("|"), selectedFiles.join("|"), loaded, autoRefresh]);

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
      setTimeout(() => syncIntervalFromMonitor(monitor.id), 50);
    }
  };

  const handleCustomBlur = async () => {
    let v = parseInt(customInput, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > MAX_INTERVAL) v = MAX_INTERVAL;
    update({ interval: v, customInput: String(v) });
    if (syncEnabled) {
      setTimeout(() => syncIntervalFromMonitor(monitor.id), 50);
    }
  };

  const effectiveInterval = useCustom
    ? Math.min(Math.max(parseInt(customInput, 10) || 1, 1), MAX_INTERVAL)
    : interval;

  const isRunning = status?.is_running ?? false;
  const hasImages = checkedCount > 0;

  const handlePlay = () => {
    const activePaths = images
      .filter((img) => !excluded.has(img.path))
      .map((img) => img.path);
    if (activePaths.length === 0) return;

    // In shuffle mode, duplicate favorite paths 3x for weighted selection
    let finalPaths = activePaths;
    if (mode === "Shuffle" && favorites.size > 0) {
      const extras: string[] = [];
      for (const p of activePaths) {
        if (favorites.has(p)) {
          extras.push(p, p); // 2 extra copies = 3x total
        }
      }
      finalPaths = [...activePaths, ...extras];
    }
    onStartFiles(monitor.id, finalPaths, effectiveInterval, mode);
  };

  const isPreset = !useCustom && PRESETS.some((p) => p.value === interval);

  if (!loaded) return null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-[#1a1a3e] to-[#16162e] shadow-xl shadow-black/30 overflow-hidden">
      {/* Top accent bar */}
      <div className={`h-px bg-gradient-to-r from-transparent ${isRunning ? "via-emerald-500" : "via-indigo-500"} to-transparent`} />

      <div className="p-5">
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
          <div className="w-0.5 h-4 rounded-full bg-gradient-to-b from-indigo-500 to-purple-500" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-ds-text-muted">{t("monitor.source", { defaultValue: "Source" })}</span>
        </div>
      </div>
      <div className="mb-4 space-y-2">
        {/* Source list: folders + individual files */}
        {(folders.length > 0 || selectedFiles.length > 0) && (
          <div className="space-y-1">
            {folders.map((f) => (
              <div key={f} className="flex items-center gap-2 rounded-xl border border-ds-accent/30 bg-ds-accent/5 px-3 py-2">
                <svg className="h-4 w-4 shrink-0 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="flex-1 truncate text-sm text-ds-text" title={f}>
                  {f.split(/[/\\]/).pop()}
                </span>
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
              <div className="flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-500/5 px-3 py-2">
                <svg className="h-4 w-4 shrink-0 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            className="flex flex-1 items-center gap-2 rounded-xl border border-dashed border-ds-border px-3 py-2.5 text-left text-sm transition hover:border-ds-accent/50 hover:bg-purple-500/5"
          >
            <svg className="h-4 w-4 shrink-0 text-ds-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-ds-text-muted">
              {t("monitor.add_images", { defaultValue: "Add images" })}
            </span>
          </button>
        </div>

        {/* Auto refresh checkbox — when folders exist */}
        {folders.length > 0 && (
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-ds-text-dim transition hover:text-ds-text">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={() => update({ autoRefresh: !autoRefresh })}
              className="h-3.5 w-3.5 accent-ds-accent"
            />
            {t("monitor.auto_refresh")}
          </label>
        )}
      </div>

      {/* Image preview with checkboxes + drag reorder */}
      {images.length > 0 && (
        <div className="mb-4">
          {/* Toggle bar */}
          <button
            onClick={() => setPreviewOpen(!previewOpen)}
            className="mb-2 flex w-full items-center gap-2 text-xs text-ds-text-dim transition hover:text-ds-text"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${previewOpen ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {previewOpen ? t("monitor.preview_collapse") : t("monitor.preview")}
            <span className="text-ds-text-muted">
              ({checkedCount}/{images.length})
            </span>
          </button>

          {previewOpen && (
              <div>
                {/* Select all / Deselect all / Favorites filter */}
                <div className="mb-1.5 flex gap-2 text-[10px]">
                  <button
                    onClick={() => update({ excluded: [] })}
                    className="text-ds-accent-light hover:underline"
                  >
                    {t("monitor.select_all")}
                  </button>
                  <button
                    onClick={() =>
                      update({ excluded: images.map((img) => img.path) })
                    }
                    className="text-ds-text-muted hover:underline"
                  >
                    {t("monitor.deselect_all")}
                  </button>
                  {favorites.size > 0 && (
                    <button
                      onClick={() => setFilterFavorites(!filterFavorites)}
                      className={`flex items-center gap-0.5 ${filterFavorites ? "text-red-400" : "text-ds-text-muted hover:text-red-400"}`}
                    >
                      <svg className="h-3 w-3" fill={filterFavorites ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                      {t("favorite.filter")}
                    </button>
                  )}
                </div>

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
            )}
        </div>
      )}

      {/* Controls row: Interval → Sync → Mode */}
      <div className="mb-4 space-y-3">
        {/* Section header */}
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-4 rounded-full bg-gradient-to-b from-indigo-500 to-purple-500" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-ds-text-muted">{t("monitor.interval")}</span>
        </div>

        {/* Interval segmented control */}
        <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-xl bg-black/30 p-1">
          {PRESETS.map((p) => {
            const isActive = !useCustom && interval === p.value;
            return (
              <button
                key={p.value}
                onClick={() => handlePresetChange(String(p.value))}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                    : "text-ds-text-muted hover:text-ds-text hover:bg-white/5"
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
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                : "text-ds-text-muted hover:text-ds-text hover:bg-white/5"
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
                className="w-16 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-center text-xs text-ds-text"
                placeholder="sec"
              />
              <span className="text-[10px] text-ds-text-muted">{t("interval.seconds")}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">

        <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1.5 text-xs text-ds-text-dim transition hover:border-ds-accent/50">
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={() => onSyncToggle(monitor.id)}
            className="h-3.5 w-3.5 accent-ds-accent"
          />
          {t("slideshow.sync_timers")}
        </label>

        <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-ds-border px-2.5 py-1.5 text-xs text-ds-text-dim transition hover:border-ds-accent/50">
          <input
            type="checkbox"
            checked={taskbarHidden}
            onChange={handleTaskbarToggle}
            className="h-3.5 w-3.5 accent-ds-accent"
          />
          {t("monitor.hide_taskbar")}
        </label>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-ds-text-muted">{t("monitor.mode")}</span>
          <div className="flex rounded-lg overflow-hidden bg-black/30">
            <button
              onClick={() => update({ mode: "Sequential" })}
              className={`px-2.5 py-1.5 text-xs font-medium transition-all ${
                mode === "Sequential"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                  : "text-ds-text-muted hover:text-ds-text hover:bg-white/5"
              }`}
            >
              {t("slideshow.sequential")}
            </button>
            <button
              onClick={() => update({ mode: "Shuffle" })}
              className={`px-2.5 py-1.5 text-xs font-medium transition-all ${
                mode === "Shuffle"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                  : "text-ds-text-muted hover:text-ds-text hover:bg-white/5"
              }`}
            >
              {t("slideshow.shuffle")}
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Playback controls */}
      <div className="mb-3 flex items-center justify-center gap-3 rounded-2xl bg-black/20 py-3 px-4">
        {/* Pin button */}
        <button
          onClick={onTogglePin}
          disabled={!isRunning}
          className={`flex h-10 w-10 items-center justify-center rounded-full transition disabled:opacity-30 ${
            pinned
              ? "bg-indigo-500/20 text-indigo-400"
              : "text-ds-text-dim hover:bg-white/10 hover:text-ds-text"
          }`}
          title={t("pin.toggle")}
        >
          <svg className="h-4 w-4" fill={pinned ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </button>

        <button
          onClick={() => onPrev(monitor.id)}
          disabled={!status}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ds-text-dim transition hover:bg-white/10 hover:text-ds-text disabled:opacity-30"
          title={t("slideshow.prev")}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M15.707 15.707a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 010 1.414zm-6 0a1 1 0 01-1.414 0l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 1.414L5.414 10l4.293 4.293a1 1 0 010 1.414z" />
          </svg>
        </button>

        <AnimatePresence mode="wait">
          {isRunning ? (
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
              className="flex h-12 min-w-[120px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition hover:shadow-indigo-500/40 hover:brightness-110 disabled:opacity-30 disabled:shadow-none"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              {t("slideshow.play")}
            </motion.button>
          )}
        </AnimatePresence>

        <button
          onClick={() => onNext(monitor.id)}
          disabled={!status}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ds-text-dim transition hover:bg-white/10 hover:text-ds-text disabled:opacity-30"
          title={t("slideshow.next")}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4.293 15.707a1 1 0 010-1.414L8.586 10 4.293 5.707a1 1 0 011.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0zm6 0a1 1 0 010-1.414L14.586 10l-4.293-4.293a1 1 0 011.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0z" />
          </svg>
        </button>
      </div>

      {/* Status bar */}
      {status && (
        <div className="flex items-center justify-between text-xs text-ds-text-muted">
          <div className="flex items-center gap-2">
            <span>
              {status.current_index + 1} / {status.total_images}
            </span>
            {pinned && (
              <span className="rounded-md bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400">
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
    </div>
  );
}
