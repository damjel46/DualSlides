import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { updateTrayLocale } from "../lib/commands";
import { HotkeyInput } from "./HotkeyInput";
import { ProUpgradeModal } from "./ProUpgradeModal";
import type { HotkeyBinding } from "../hooks/useHotkeys";

interface SettingsProps {
  open: boolean;
  onClose: () => void;
  hotkeys: HotkeyBinding[];
  onUpdateHotkey: (action: string, shortcut: string) => void;
  isPro: boolean;
  onActivatePro: (key: string) => Promise<boolean>;
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
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
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
  open,
  onClose,
  hotkeys,
  onUpdateHotkey,
  isPro,
  onActivatePro,
}: SettingsProps) {
  const { t, i18n } = useTranslation();
  const [autostart, setAutostart] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [proModalOpen, setProModalOpen] = useState(false);

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

  const handleHotkeyChange = (action: string, shortcut: string, proOnly?: boolean) => {
    if (proOnly && !isPro) {
      setProModalOpen(true);
      return;
    }
    onUpdateHotkey(action, shortcut);
  };

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
              className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ds-border bg-ds-card p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-ds-text">
                    {t("app.settings")}
                  </h2>
                  {isPro && (
                    <span className="rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
                      PRO
                    </span>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-ds-text-muted transition hover:bg-ds-bg/50 hover:text-ds-text"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

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
                </div>
              </section>

              {/* Hotkeys */}
              <section className="mb-5 border-t border-ds-border pt-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ds-text-muted">
                  {t("settings.hotkeys")}
                </h3>
                <div className="space-y-2">
                  {hotkeys.map((binding) => (
                    <div key={binding.action} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm capitalize text-ds-text-dim">
                          {binding.action.replace(/_/g, " ")}
                        </span>
                        {binding.proOnly && !isPro && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">
                            PRO
                          </span>
                        )}
                      </div>
                      <HotkeyInput
                        value={binding.shortcut}
                        onChange={(shortcut) =>
                          handleHotkeyChange(binding.action, shortcut, binding.proOnly)
                        }
                        disabled={!!binding.proOnly && !isPro}
                      />
                    </div>
                  ))}
                </div>
              </section>

              {/* Pro features */}
              <section className="border-t border-ds-border pt-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ds-text-muted">
                  {t("settings.pro_features")}
                </h3>
                {isPro ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
                    {t("pro.activated")}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button
                      onClick={() => setProModalOpen(true)}
                      className="flex w-full items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left transition hover:bg-amber-500/10"
                    >
                      <span className="shrink-0 rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
                        PRO
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-amber-200/90">
                          {t("pro.upgrade")}
                        </div>
                        <div className="text-xs text-amber-200/50">
                          {t("pro.window_mover_desc")} · {t("pro.profiles_desc")} · {t("pro.custom_hotkeys")}
                        </div>
                      </div>
                    </button>
                  </div>
                )}
              </section>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ProUpgradeModal
        open={proModalOpen}
        onClose={() => setProModalOpen(false)}
        onActivate={onActivatePro}
      />
    </>
  );
}
