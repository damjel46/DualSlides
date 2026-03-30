import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { updateTrayLocale } from "../lib/commands";
import { HotkeyInput } from "./HotkeyInput";
import type { HotkeyBinding } from "../hooks/useHotkeys";

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  hotkeys: HotkeyBinding[];
  onUpdateHotkey: (action: string, shortcut: string) => void;
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
  open,
  onClose,
  hotkeys,
  onUpdateHotkey,
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

  const [activeTab, setActiveTab] = useState<"general" | "hotkeys">("general");

  return (
    <>
      <AnimatePresence>
        {open && (
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
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </>
  );
}
