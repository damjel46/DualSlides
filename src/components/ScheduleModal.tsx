import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import {
  getSchedule,
  setSchedule as saveScheduleBackend,
  getActiveScheduleSlot,
} from "../lib/commands";
import type { Schedule, ScheduleSlot } from "../lib/commands";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-ds-accent" : "bg-ds-border"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}

interface ProfileInfo {
  id: string;
  name: string;
}

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  monitorIds: string[];
  profiles?: ProfileInfo[];
}

export function ScheduleModal({ open: isOpen, onClose, monitorIds, profiles = [] }: ScheduleModalProps) {
  const { t } = useTranslation();
  const [schedule, setSchedule] = useState<Schedule>({ enabled: false, slots: [] });
  const [activeSlotName, setActiveSlotName] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    try {
      const s = await getSchedule();
      setSchedule(s);
      const active = await getActiveScheduleSlot();
      setActiveSlotName(active);
    } catch (e) {
      console.error("Failed to load schedule:", e);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadSchedule();
  }, [isOpen, loadSchedule]);

  const persistSchedule = async (sched: Schedule) => {
    try {
      await saveScheduleBackend(sched);
      const store = await load("schedule.json", { autoSave: true, defaults: {} });
      await store.set("schedule", sched);
    } catch { /* */ }
  };

  const handleScheduleToggle = async () => {
    const next = !schedule.enabled;
    const updated = { ...schedule, enabled: next };
    setSchedule(updated);
    try {
      await persistSchedule(updated);
      if (next) {
        const active = await getActiveScheduleSlot();
        setActiveSlotName(active);
      } else {
        setActiveSlotName(null);
      }
    } catch (e) {
      console.error("Failed to toggle schedule:", e);
    }
  };

  const handleAddSlot = async () => {
    if (schedule.slots.length >= 6) return;
    const newSlot: ScheduleSlot = {
      name: `Slot ${schedule.slots.length + 1}`,
      start_time: "12:00",
      end_time: "18:00",
      profile_id: null,
      folders: {},
    };
    const updated = { ...schedule, slots: [...schedule.slots, newSlot] };
    setSchedule(updated);
    await persistSchedule(updated);
  };

  const handleRemoveSlot = async (index: number) => {
    const updated = { ...schedule, slots: schedule.slots.filter((_, i) => i !== index) };
    setSchedule(updated);
    await persistSchedule(updated);
  };

  const handleSlotChange = async (index: number, patch: Partial<ScheduleSlot>) => {
    const slots = schedule.slots.map((s, i) => (i === index ? { ...s, ...patch } : s));
    const updated = { ...schedule, slots };
    setSchedule(updated);
    await persistSchedule(updated);
  };

  const handleAddFolder = async (slotIndex: number, monitorId: string) => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const folder = typeof selected === "string" ? selected : selected;
      const slot = schedule.slots[slotIndex];
      const existing = slot.folders[monitorId] || [];
      if (existing.includes(folder as string)) return;
      const folders = { ...slot.folders, [monitorId]: [...existing, folder as string] };
      handleSlotChange(slotIndex, { folders });
    } catch (e) {
      console.error("Folder selection failed:", e);
    }
  };

  const handleRemoveFolder = async (slotIndex: number, monitorId: string, folderIndex: number) => {
    const slot = schedule.slots[slotIndex];
    const existing = slot.folders[monitorId] || [];
    const folders = { ...slot.folders, [monitorId]: existing.filter((_, i) => i !== folderIndex) };
    handleSlotChange(slotIndex, { folders });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-ds-border bg-ds-card shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-ds-border px-6 py-4">
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-ds-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h2 className="text-base font-semibold text-ds-text">{t("schedule.title")}</h2>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-ds-text-muted transition hover:bg-ds-card-hover hover:text-ds-text"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="space-y-4 p-6">
              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ds-text">{t("schedule.enable")}</span>
                <Toggle checked={schedule.enabled} onChange={handleScheduleToggle} />
              </div>

              {/* Active slot indicator */}
              {schedule.enabled && activeSlotName && (
                <div className="rounded-lg border border-ds-accent/20 bg-ds-accent/10 px-3 py-2 text-xs text-ds-accent-light">
                  {t("schedule.current", { name: activeSlotName })}
                </div>
              )}

              {/* Slots */}
              <div className="space-y-3">
                {schedule.slots.map((slot, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl border p-4 space-y-3 ${
                      activeSlotName === slot.name
                        ? "border-ds-accent/30 bg-ds-accent/5"
                        : "border-ds-border bg-ds-bg/30"
                    }`}
                  >
                    {/* Slot header */}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={slot.name}
                        onChange={(e) => handleSlotChange(idx, { name: e.target.value })}
                        className="min-w-0 flex-1 rounded-lg border border-ds-border bg-ds-bg/50 px-3 py-1.5 text-sm text-ds-text focus:border-ds-accent/50 focus:outline-none"
                        placeholder={t("schedule.slot_name")}
                      />
                      <input
                        type="time"
                        value={slot.start_time}
                        onChange={(e) => handleSlotChange(idx, { start_time: e.target.value })}
                        className="w-[110px] shrink-0 rounded-lg border border-ds-border bg-ds-bg/50 px-2 py-1.5 text-sm text-ds-text focus:border-ds-accent/50 focus:outline-none"
                      />
                      <span className="shrink-0 text-xs text-ds-text">~</span>
                      <input
                        type="time"
                        value={slot.end_time}
                        onChange={(e) => handleSlotChange(idx, { end_time: e.target.value })}
                        className="w-[110px] shrink-0 rounded-lg border border-ds-border bg-ds-bg/50 px-2 py-1.5 text-sm text-ds-text focus:border-ds-accent/50 focus:outline-none"
                      />
                      {schedule.slots.length > 1 && (
                        <button
                          onClick={() => handleRemoveSlot(idx)}
                          className="rounded-lg p-1.5 text-ds-text/60 transition hover:bg-red-500/20 hover:text-red-400"
                          title={t("schedule.remove_slot")}
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Source: profile or direct folders */}
                    <div className="flex items-center gap-2">
                      <select
                        value={slot.profile_id || ""}
                        onChange={(e) => handleSlotChange(idx, { profile_id: e.target.value || null })}
                        className="flex-1 rounded-lg border border-ds-border bg-ds-bg/50 px-2.5 py-1.5 text-xs text-ds-text focus:border-ds-accent/50 focus:outline-none"
                      >
                        <option value="">{t("schedule.no_profile")}</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Per-monitor folder mapping — only when no profile selected */}
                    {!slot.profile_id && (
                    <div className="space-y-2">
                      <span className="text-xs text-ds-text">{t("schedule.select_folders")}</span>
                      {monitorIds.map((mid, mIdx) => {
                        const folders = slot.folders[mid] || [];
                        return (
                          <div key={mid} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-ds-text">
                                Monitor {mIdx + 1}
                              </span>
                              <button
                                onClick={() => handleAddFolder(idx, mid)}
                                className="flex items-center gap-1 rounded-md border border-ds-border bg-ds-card px-2 py-1 text-[10px] text-ds-text/70 transition hover:bg-ds-accent/10 hover:text-ds-accent-light hover:border-ds-accent/20"
                              >
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                {t("monitor.folder")}
                              </button>
                            </div>
                            {folders.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-ds-border bg-ds-bg/20 px-3 py-2 text-center text-[10px] text-ds-text/60">
                                {t("schedule.no_folders")}
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {folders.map((f, fi) => (
                                  <div key={fi} className="flex items-center gap-1.5 rounded-lg border border-ds-border bg-ds-bg/30 px-2.5 py-1.5">
                                    <svg className="h-3 w-3 shrink-0 text-ds-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                    </svg>
                                    <span className="flex-1 truncate text-[11px] text-ds-text" title={f}>
                                      {f.split(/[/\\]/).pop()}
                                    </span>
                                    <button
                                      onClick={() => handleRemoveFolder(idx, mid, fi)}
                                      className="shrink-0 rounded p-0.5 text-ds-text/50 transition hover:bg-red-500/20 hover:text-red-400"
                                    >
                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add slot button */}
              {schedule.slots.length < 6 ? (
                <button
                  onClick={handleAddSlot}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ds-border bg-ds-card py-2.5 text-xs text-ds-text transition hover:border-ds-accent/30 hover:bg-ds-accent/5 hover:text-ds-accent-light"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {t("schedule.add_slot")}
                </button>
              ) : (
                <p className="text-center text-xs text-ds-text/60">{t("schedule.max_slots")}</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
