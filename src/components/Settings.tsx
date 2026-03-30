import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import { load } from "@tauri-apps/plugin-store";
import {
  updateTrayLocale,
  getSchedule,
  setSchedule as saveScheduleBackend,
  enableSchedule,
  getActiveScheduleSlot,
} from "../lib/commands";
import type { Schedule, ScheduleSlot } from "../lib/commands";
import { HotkeyInput } from "./HotkeyInput";
import type { HotkeyBinding } from "../hooks/useHotkeys";

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  hotkeys: HotkeyBinding[];
  onUpdateHotkey: (action: string, shortcut: string) => void;
  monitorIds: string[];
}

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
        checked ? "bg-indigo-600 shadow-[0_0_8px_rgba(99,102,241,0.4)]" : "bg-white/10"
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

export function Settings({
  open: isOpen,
  onClose,
  hotkeys,
  onUpdateHotkey,
  monitorIds,
}: SettingsProps) {
  const { t, i18n } = useTranslation();
  const [autostart, setAutostart] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);

  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => {});
  }, []);

  const handleAutostartToggle = async () => {
    try {
      if (autostart) {
        await disable();
      } else {
        await enable();
      }
      setAutostart(!autostart);
    } catch (e) {
      console.error("Autostart toggle failed:", e);
    }
  };

  const handleLanguageChange = async (lng: string) => {
    await i18n.changeLanguage(lng);
    try {
      await updateTrayLocale(lng);
    } catch (e) {
      console.error("Failed to update tray locale:", e);
    }
  };

  const handleHotkeyChange = (action: string, shortcut: string) => {
    onUpdateHotkey(action, shortcut);
  };

  // ── Schedule state ──────────────────────────────────────────────────
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

  /** Save schedule to both backend engine and persistent store */
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
      // Don't add duplicates
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

  const [activeTab, setActiveTab] = useState<"general" | "hotkeys" | "schedule">("general");

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#1c1c3a] to-[#141428] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Top gradient accent line */}
              <div className="h-px bg-gradient-to-r from-transparent via-indigo-500 to-transparent" />

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4">
                <h2 className="text-lg font-bold text-ds-text">
                  {t("app.settings")}
                </h2>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-ds-text-muted transition hover:bg-white/10 hover:text-ds-text"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex">
                {/* Sidebar navigation */}
                <nav className="w-44 shrink-0 border-r border-white/5 bg-black/20 p-3 space-y-1">
                  <button
                    onClick={() => setActiveTab("general")}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      activeTab === "general"
                        ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/20"
                        : "text-ds-text-muted hover:text-ds-text hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {t("settings.general")}
                  </button>
                  <button
                    onClick={() => setActiveTab("hotkeys")}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      activeTab === "hotkeys"
                        ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/20"
                        : "text-ds-text-muted hover:text-ds-text hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
                    </svg>
                    {t("settings.hotkeys")}
                  </button>
                  <button
                    onClick={() => setActiveTab("schedule")}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      activeTab === "schedule"
                        ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/20"
                        : "text-ds-text-muted hover:text-ds-text hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t("schedule.title")}
                  </button>
                </nav>

                {/* Content area */}
                <div className="flex-1 overflow-y-auto p-6" style={{ maxHeight: "calc(80vh - 80px)" }}>
                  {activeTab === "general" && (
                    <>
              {/* General */}
              <section className="mb-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ds-text-muted">
                  {t("settings.general")}
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ds-text">{t("settings.autostart")}</span>
                    <Toggle checked={autostart} onChange={handleAutostartToggle} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ds-text">{t("settings.close_to_tray")}</span>
                    <Toggle checked={closeToTray} onChange={() => setCloseToTray(!closeToTray)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-ds-text">{t("settings.language")}</span>
                    <select
                      value={i18n.language}
                      onChange={(e) => handleLanguageChange(e.target.value)}
                      className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-ds-text"
                    >
                      <option value="en">English</option>
                      <option value="ko">한국어</option>
                      <option value="ja">日本語</option>
                      <option value="zh">中文</option>
                      <option value="de">Deutsch</option>
                      <option value="es">Español</option>
                    </select>
                  </div>
                </div>
              </section>

                    </>
                  )}

                  {activeTab === "hotkeys" && (
                    <>
              {/* Hotkeys */}
              <section className="mb-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ds-text-muted">
                  {t("settings.hotkeys")}
                </h3>
                <div className="space-y-2">
                  {hotkeys.map((binding) => (
                    <div key={binding.action} className="flex items-center justify-between">
                      <span className="text-sm text-ds-text-dim">
                        {t(`hotkeys.${binding.action}`, { defaultValue: binding.action.replace(/_/g, " ") })}
                      </span>
                      <HotkeyInput
                        value={binding.shortcut}
                        onChange={(shortcut) =>
                          handleHotkeyChange(binding.action, shortcut)
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
                    </>
                  )}

                  {activeTab === "schedule" && (
                    <section className="space-y-4">
                      {/* Enable toggle */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <svg className="h-5 w-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm font-medium text-ds-text">{t("schedule.enable")}</span>
                        </div>
                        <Toggle checked={schedule.enabled} onChange={handleScheduleToggle} />
                      </div>

                      {/* Active slot indicator */}
                      {schedule.enabled && activeSlotName && (
                        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
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
                                ? "border-indigo-500/30 bg-indigo-500/5"
                                : "border-white/10 bg-black/20"
                            }`}
                          >
                            {/* Slot header */}
                            <div className="flex items-center gap-3">
                              <input
                                type="text"
                                value={slot.name}
                                onChange={(e) => handleSlotChange(idx, { name: e.target.value })}
                                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-ds-text focus:border-indigo-500/50 focus:outline-none"
                                placeholder={t("schedule.slot_name")}
                              />
                              <input
                                type="time"
                                value={slot.start_time}
                                onChange={(e) => handleSlotChange(idx, { start_time: e.target.value })}
                                className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-ds-text focus:border-indigo-500/50 focus:outline-none"
                              />
                              {schedule.slots.length > 1 && (
                                <button
                                  onClick={() => handleRemoveSlot(idx)}
                                  className="rounded-lg p-1.5 text-ds-text-muted transition hover:bg-red-500/20 hover:text-red-400"
                                  title={t("schedule.remove_slot")}
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>

                            {/* Per-monitor folder mapping */}
                            <div className="space-y-2">
                              <span className="text-xs text-ds-text-muted">{t("schedule.select_folders")}</span>
                              {monitorIds.map((mid, mIdx) => {
                                const folders = slot.folders[mid] || [];
                                return (
                                  <div key={mid} className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-ds-text-dim">
                                        Monitor {mIdx + 1}
                                      </span>
                                      <button
                                        onClick={() => handleAddFolder(idx, mid)}
                                        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-ds-text-muted transition hover:bg-indigo-500/10 hover:text-indigo-300 hover:border-indigo-500/20"
                                      >
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        {t("monitor.folder")}
                                      </button>
                                    </div>
                                    {folders.length === 0 ? (
                                      <div className="rounded-lg border border-dashed border-white/10 bg-black/10 px-3 py-2 text-center text-[10px] text-ds-text-muted">
                                        {t("schedule.no_folders")}
                                      </div>
                                    ) : (
                                      <div className="space-y-1">
                                        {folders.map((f, fi) => (
                                          <div key={fi} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                                            <svg className="h-3 w-3 shrink-0 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                            </svg>
                                            <span className="flex-1 truncate text-[11px] text-ds-text-muted" title={f}>
                                              {f.split(/[/\\]/).pop()}
                                            </span>
                                            <button
                                              onClick={() => handleRemoveFolder(idx, mid, fi)}
                                              className="shrink-0 rounded p-0.5 text-ds-text-muted transition hover:bg-red-500/20 hover:text-red-400"
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
                          </div>
                        ))}
                      </div>

                      {/* Add slot button */}
                      {schedule.slots.length < 6 ? (
                        <button
                          onClick={handleAddSlot}
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/5 py-2.5 text-xs text-ds-text-muted transition hover:border-indigo-500/30 hover:bg-indigo-500/5 hover:text-indigo-300"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          {t("schedule.add_slot")}
                        </button>
                      ) : (
                        <p className="text-center text-xs text-ds-text-muted">{t("schedule.max_slots")}</p>
                      )}
                    </section>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
}
