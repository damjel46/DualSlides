import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { MonitorInfo, SlideshowStatus } from "../lib/commands";

/** Crossfade thumbnail — old fades out while new fades in */
function CrossfadeThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);

  // Reset failed state when src changes
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) return null;

  return (
    <AnimatePresence mode="sync">
      <motion.img
        key={src}
        src={src}
        alt=""
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.45 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.8 }}
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
        onError={() => setFailed(true)}
      />
    </AnimatePresence>
  );
}

interface MonitorLayoutProps {
  monitors: MonitorInfo[];
  statuses: Record<string, SlideshowStatus>;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  zenActive: boolean;
  onToggleZen: () => void;
  layout?: "vertical" | "horizontal";
}

export function MonitorLayout({
  monitors,
  statuses,
  selectedIndex,
  onSelect,
  zenActive,
  onToggleZen,
  layout = "vertical",
}: MonitorLayoutProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container width and update on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => setContainerWidth(el.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (monitors.length === 0) return null;

  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const maxX = Math.max(...monitors.map((m) => m.x + m.width));
  const maxY = Math.max(...monitors.map((m) => m.y + m.height));

  const totalW = maxX - minX || 1;
  const totalH = maxY - minY || 1;
  const padding = 20;

  // Calculate scale based on available container width (minus padding)
  // For vertical layout, cap at 560px wide; for horizontal, use actual container width
  const availW = containerWidth > 0
    ? containerWidth - padding * 2
    : (layout === "horizontal" ? 400 : 560);
  const maxH = layout === "horizontal" ? 300 : 280;
  const scale = Math.min(availW / totalW, maxH / totalH);
  const shrink = 0.94;

  // Detect if monitors are very wide (3+ monitors) and content needs to shrink
  const isCompact = scale * Math.max(...monitors.map((m) => m.width)) < 160;

  const diagramW = totalW * scale + padding * 2;
  const diagramH = totalH * scale + padding * 2;

  return (
    <div className="space-y-2" ref={containerRef}>
      {/* Zen Mode toggle */}
      <div className="flex justify-end px-1">
        <button
          onClick={onToggleZen}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
            zenActive
              ? "bg-ds-accent/15 text-ds-accent-light border border-ds-accent/30"
              : "bg-ds-card text-ds-text-muted border border-ds-border hover:bg-ds-card-hover hover:text-ds-text"
          }`}
          title={`${t("zen.description")} (Ctrl+Alt+Z)`}
        >
          {/* Eye icon */}
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {zenActive ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
            ) : (
              <>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </>
            )}
          </svg>
          {t("zen.toggle")}
        </button>
      </div>

      <div className="flex justify-center">
      <div
        className="relative rounded-2xl bg-ds-bg border border-ds-border overflow-hidden"
        style={{
          width: diagramW,
          height: diagramH,
          padding,
        }}
      >
        {monitors.map((monitor, i) => {
          const status = statuses[monitor.id];
          const isSelected = selectedIndex === i;
          const isRunning = status?.is_running ?? false;
          const thumbSrc = status?.current_image
            ? convertFileSrc(status.current_image)
            : null;

          return (
            <motion.button
              key={monitor.id}
              onClick={() => onSelect(i)}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.08, duration: 0.25 }}
              className={`absolute overflow-hidden rounded-xl transition-all duration-200 ${
                isSelected
                  ? "ring-2 ring-ds-accent -translate-y-1"
                  : "border border-ds-border hover:-translate-y-0.5 hover:border-ds-text-muted hover:shadow-lg"
              }`}
              style={{
                left: (monitor.x - minX) * scale + padding + (monitor.width * scale * (1 - shrink)) / 2,
                top: (monitor.y - minY) * scale + padding + (monitor.height * scale * (1 - shrink)) / 2,
                width: monitor.width * scale * shrink,
                height: monitor.height * scale * shrink,
              }}
            >
              {/* Crossfade background thumbnail */}
              <CrossfadeThumb src={thumbSrc} />
              {!thumbSrc && (
                <div className={`absolute inset-0 ${isSelected ? "bg-ds-card" : "bg-ds-card"}`} />
              )}
              {thumbSrc && isSelected && (
                <div className="absolute inset-0 bg-ds-accent/5" />
              )}

              {/* Overlay content */}
              <div className="relative z-10 flex h-full flex-col items-center justify-center gap-0.5 p-1">
                {!isCompact && (
                  <span className="text-[9px] font-medium uppercase tracking-wider text-ds-text-muted drop-shadow-sm">
                    {t("monitor.label", { defaultValue: "Monitor" })}
                  </span>
                )}
                <span className={`font-semibold text-ds-text drop-shadow-sm ${isCompact ? "text-[10px]" : "text-sm"}`}>
                  {monitor.name}
                </span>
                <span className={`text-ds-text-dim drop-shadow-sm ${isCompact ? "text-[8px]" : "text-[10px]"}`}>
                  {monitor.width}x{monitor.height}
                </span>

                {/* Badges */}
                <div className={`flex items-center gap-1 ${isCompact ? "mt-0.5" : "mt-1"}`}>
                  {status && (
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                      isRunning ? "bg-emerald-400" : "bg-slate-500"
                    }`} />
                  )}
                  {monitor.is_primary && (
                    <span className={`rounded bg-ds-accent/80 font-bold text-white ${isCompact ? "px-1 py-px text-[7px]" : "px-1.5 py-0.5 text-[9px]"}`}>
                      {t("monitor.primary")}
                    </span>
                  )}
                  {!isCompact && status && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                        isRunning
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/20 text-amber-400"
                      }`}
                    >
                      {isRunning ? t("slideshow.running") : t("slideshow.stopped")}
                    </span>
                  )}
                  {!isCompact && !status && (
                    <span className="rounded bg-ds-border/50 px-1.5 py-0.5 text-[9px] text-ds-text-muted">
                      {t("monitor.not_configured")}
                    </span>
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
