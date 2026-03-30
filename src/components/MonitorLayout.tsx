import { useEffect, useState } from "react";
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
}

export function MonitorLayout({
  monitors,
  statuses,
  selectedIndex,
  onSelect,
}: MonitorLayoutProps) {
  const { t } = useTranslation();

  if (monitors.length === 0) return null;

  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const maxX = Math.max(...monitors.map((m) => m.x + m.width));
  const maxY = Math.max(...monitors.map((m) => m.y + m.height));

  const totalW = maxX - minX || 1;
  const totalH = maxY - minY || 1;
  const scale = Math.min(560 / totalW, 280 / totalH);
  const shrink = 0.94; // shrink each monitor to create visual gaps

  return (
    <div className="flex justify-center">
      <div
        className="relative rounded-2xl bg-[#0d0d1f] border border-white/5 p-5 shadow-inner shadow-black/40"
        style={{
          width: totalW * scale + 40,
          height: totalH * scale + 40,
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
                  ? "border-2 border-transparent shadow-[0_0_0_2px_#6366f1,0_0_20px_rgba(99,102,241,0.3)] -translate-y-1"
                  : "border border-white/[0.08] hover:-translate-y-0.5 hover:border-white/[0.15] hover:shadow-lg"
              }`}
              style={{
                left: (monitor.x - minX) * scale + 20 + (monitor.width * scale * (1 - shrink)) / 2,
                top: (monitor.y - minY) * scale + 20 + (monitor.height * scale * (1 - shrink)) / 2,
                width: monitor.width * scale * shrink,
                height: monitor.height * scale * shrink,
              }}
            >
              {/* Crossfade background thumbnail */}
              <CrossfadeThumb src={thumbSrc} />
              {!thumbSrc && (
                <div className={`absolute inset-0 ${isSelected ? "bg-gradient-to-br from-indigo-900/40 to-purple-900/30" : "bg-ds-card"}`} />
              )}
              {thumbSrc && isSelected && (
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 to-purple-600/10" />
              )}

              {/* Overlay content */}
              <div className="relative z-10 flex h-full flex-col items-center justify-center gap-1 p-2">
                {/* Monitor label */}
                <span className="text-[9px] font-medium uppercase tracking-wider text-ds-text-muted drop-shadow-sm">
                  {t("monitor.label", { defaultValue: "Monitor" })}
                </span>
                <span className="text-sm font-semibold text-ds-text drop-shadow-sm">
                  {monitor.name}
                </span>
                <span className="text-[10px] text-ds-text-dim drop-shadow-sm">
                  {monitor.width}x{monitor.height}
                </span>

                {/* Badges */}
                <div className="mt-1 flex items-center gap-1.5">
                  {/* Status indicator dot */}
                  {status && (
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                      isRunning
                        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                        : "bg-slate-500"
                    }`} />
                  )}
                  {monitor.is_primary && (
                    <span className="rounded bg-ds-accent/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      {t("monitor.primary")}
                    </span>
                  )}
                  {status ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                        isRunning
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/20 text-amber-400"
                      }`}
                    >
                      {isRunning
                        ? t("slideshow.running")
                        : t("slideshow.stopped")}
                    </span>
                  ) : (
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
  );
}
