import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { updateTrayLocale } from "../lib/commands";
import { HotkeyInput } from "./HotkeyInput";
import type { HotkeyBinding } from "../hooks/useHotkeys";

export type SettingsTab = "general" | "hotkeys";

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  hotkeys: HotkeyBinding[];
  onUpdateHotkey: (action: string, shortcut: string) => void;
  monitorIds: string[];
  activeTab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  theme?: "dark" | "light";
  onThemeChange?: () => void;
  accentId?: string;
  onAccentChange?: (id: string) => void;
  customHex?: string | null;
  onCustomAccentChange?: (hex: string) => void;
}

function CustomColorPicker({
  accentId,
  customHex,
  onCustomAccentChange,
}: {
  accentId: string;
  customHex: string | null | undefined;
  onCustomAccentChange: (hex: string) => void;
}) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hexInput, setHexInput] = useState(customHex || "#6366f1");
  const pickerRef = useRef<HTMLDivElement>(null);

  const parseHex = (hex: string) => {
    const h = hex.replace("#", "");
    if (h.length !== 6) return { r: 99, g: 102, b: 241 };
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  };

  const rgbToHex = (r: number, g: number, b: number) =>
    `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

  const currentRgb = parseHex(hexInput);

  const applyHex = (hex: string) => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      setHexInput(hex);
      onCustomAccentChange(hex);
    }
  };

  const handleRgbChange = (channel: "r" | "g" | "b", val: string) => {
    let n = parseInt(val, 10);
    if (isNaN(n)) n = 0;
    n = Math.max(0, Math.min(255, n));
    const rgb = { ...currentRgb, [channel]: n };
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    setHexInput(hex);
    onCustomAccentChange(hex);
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  useEffect(() => {
    if (customHex) setHexInput(customHex);
  }, [customHex]);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        onClick={() => setPickerOpen(!pickerOpen)}
        className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all ${
          accentId === "custom"
            ? "ring-2 ring-ds-text ring-offset-2 ring-offset-ds-card scale-110 border-transparent"
            : "border-dashed border-ds-text-muted/40 hover:scale-110 hover:border-ds-text-muted"
        }`}
        style={accentId === "custom" && customHex ? { backgroundColor: customHex } : undefined}
        title={t("settings.custom_color", { defaultValue: "Custom Color" })}
      >
        {accentId !== "custom" && (
          <svg className="h-4 w-4 text-ds-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>

      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-10 right-0 z-50 w-56 rounded-xl border border-ds-border bg-ds-card p-4 shadow-xl shadow-black/30"
          >
            {/* Preview bar */}
            <div
              className="mb-3 h-8 w-full rounded-lg"
              style={{ backgroundColor: hexInput }}
            />

            {/* HEX input */}
            <div className="mb-3">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-ds-text-muted">HEX</label>
              <input
                type="text"
                value={hexInput}
                onChange={(e) => {
                  let v = e.target.value;
                  if (!v.startsWith("#")) v = "#" + v;
                  setHexInput(v);
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                    onCustomAccentChange(v);
                  }
                }}
                onBlur={() => applyHex(hexInput)}
                onKeyDown={(e) => e.key === "Enter" && applyHex(hexInput)}
                maxLength={7}
                className="w-full rounded-lg border border-ds-border bg-ds-bg/50 px-2.5 py-1.5 text-sm font-mono text-ds-text focus:border-ds-accent focus:outline-none"
                placeholder="#6366f1"
              />
            </div>

            {/* RGB inputs */}
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-ds-text-muted">RGB</label>
              <div className="flex gap-2">
                {(["r", "g", "b"] as const).map((ch) => (
                  <div key={ch} className="flex-1">
                    <div className="mb-0.5 text-center text-[9px] font-bold uppercase text-ds-text-muted/60">{ch}</div>
                    <input
                      type="number"
                      min={0}
                      max={255}
                      value={currentRgb[ch]}
                      onChange={(e) => handleRgbChange(ch, e.target.value)}
                      className="w-full rounded-lg border border-ds-border bg-ds-bg/50 px-1.5 py-1.5 text-center text-xs text-ds-text focus:border-ds-accent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
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

export function Settings({
  open: isOpen,
  onClose,
  hotkeys,
  onUpdateHotkey,
  monitorIds: _monitorIds,
  activeTab: externalTab,
  onTabChange,
  theme,
  onThemeChange,
  accentId,
  onAccentChange,
  customHex,
  onCustomAccentChange,
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

  const [activeTab, setActiveTabLocal] = useState<SettingsTab>("general");

  // Sync with external tab prop
  useEffect(() => {
    if (externalTab) setActiveTabLocal(externalTab);
  }, [externalTab]);

  const setActiveTab = (tab: SettingsTab) => {
    setActiveTabLocal(tab);
    onTabChange?.(tab);
  };

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
              className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4">
                <h2 className="text-lg font-bold text-ds-text">
                  {t("app.settings")}
                </h2>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-ds-text-muted transition hover:bg-ds-card-hover hover:text-ds-text"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex">
                {/* Sidebar navigation */}
                <nav className="w-44 shrink-0 border-r border-ds-border bg-ds-bg/50 p-3 space-y-1">
                  <button
                    onClick={() => setActiveTab("general")}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      activeTab === "general"
                        ? "bg-ds-accent/15 text-ds-accent-light border border-ds-accent/20"
                        : "text-ds-text-muted hover:text-ds-text hover:bg-ds-card-hover border border-transparent"
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
                        ? "bg-ds-accent/15 text-ds-accent-light border border-ds-accent/20"
                        : "text-ds-text-muted hover:text-ds-text hover:bg-ds-card-hover border border-transparent"
                    }`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707" />
                    </svg>
                    {t("settings.hotkeys")}
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
                      className="rounded-lg border border-ds-border bg-ds-bg/50 px-3 py-1.5 text-sm text-ds-text"
                    >
                      <option value="en">English</option>
                      <option value="ko">한국어</option>
                      <option value="ja">日本語</option>
                      <option value="zh">中文</option>
                      <option value="de">Deutsch</option>
                      <option value="es">Español</option>
                    </select>
                  </div>
                  {onThemeChange && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-ds-text">{t("settings.theme", { defaultValue: "Theme" })}</span>
                      <button
                        onClick={onThemeChange}
                        className="flex items-center gap-2 rounded-lg border border-ds-border bg-ds-bg/50 px-3 py-1.5 text-sm text-ds-text transition hover:bg-ds-card-hover"
                      >
                        {theme === "dark" ? (
                          <>
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                            </svg>
                            Dark
                          </>
                        ) : (
                          <>
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                            </svg>
                            Light
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Accent color picker */}
                  {onAccentChange && (
                    <div className="space-y-2">
                      <span className="text-sm text-ds-text">{t("settings.accent_color", { defaultValue: "Accent Color" })}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {[
                          { id: "cyan",    color: "#0891b2" },
                          { id: "blue",    color: "#2563eb" },
                          { id: "indigo",  color: "#4f46e5" },
                          { id: "violet",  color: "#7c3aed" },
                          { id: "rose",    color: "#e11d48" },
                          { id: "amber",   color: "#d97706" },
                          { id: "emerald", color: "#059669" },
                          { id: "slate",   color: "#64748b" },
                        ].map((c) => (
                          <button
                            key={c.id}
                            onClick={() => onAccentChange(c.id)}
                            className={`h-8 w-8 rounded-full transition-all ${
                              accentId === c.id
                                ? "ring-2 ring-ds-text ring-offset-2 ring-offset-ds-card scale-110"
                                : "hover:scale-110"
                            }`}
                            style={{ backgroundColor: c.color }}
                            title={c.id.charAt(0).toUpperCase() + c.id.slice(1)}
                          />
                        ))}
                        {/* Custom color picker */}
                        {onCustomAccentChange && (
                          <CustomColorPicker
                            accentId={accentId || "cyan"}
                            customHex={customHex}
                            onCustomAccentChange={onCustomAccentChange}
                          />
                        )}
                      </div>
                    </div>
                  )}
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

                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
}
