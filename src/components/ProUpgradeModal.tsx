import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";

interface ProUpgradeModalProps {
  open: boolean;
  onClose: () => void;
  onActivate: (key: string) => Promise<boolean>;
}

export function ProUpgradeModal({
  open,
  onClose,
  onActivate,
}: ProUpgradeModalProps) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleActivate = async () => {
    setError(false);
    const ok = await onActivate(key.trim());
    if (ok) {
      setSuccess(true);
      setTimeout(onClose, 1500);
    } else {
      setError(true);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-sm rounded-2xl border border-ds-border bg-ds-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4 text-center">
              <span className="inline-block rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1 text-sm font-bold text-white">
                PRO
              </span>
              <h2 className="mt-3 text-lg font-bold text-ds-text">
                {t("pro.upgrade")}
              </h2>
              <p className="mt-1 text-sm text-ds-text-muted">
                {t("pro.feature_locked")}
              </p>
            </div>

            {/* Features list */}
            <div className="mb-5 space-y-2">
              <div className="flex items-center gap-2 text-sm text-ds-text-dim">
                <svg className="h-4 w-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t("pro.window_mover_desc")}
              </div>
              <div className="flex items-center gap-2 text-sm text-ds-text-dim">
                <svg className="h-4 w-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t("pro.profiles_desc")}
              </div>
              <div className="flex items-center gap-2 text-sm text-ds-text-dim">
                <svg className="h-4 w-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t("pro.custom_hotkeys")}
              </div>
            </div>

            {/* License key input */}
            <div className="mb-4">
              <input
                type="text"
                value={key}
                onChange={(e) => { setKey(e.target.value); setError(false); }}
                onKeyDown={(e) => e.key === "Enter" && handleActivate()}
                placeholder={t("pro.enter_key")}
                className={`w-full rounded-lg border px-3 py-2 text-sm text-ds-text ${
                  error ? "border-red-500 bg-red-500/10" : "border-ds-border bg-ds-bg/50"
                }`}
              />
              {error && (
                <p className="mt-1 text-xs text-red-400">{t("pro.invalid_key")}</p>
              )}
              {success && (
                <p className="mt-1 text-xs text-emerald-400">{t("pro.activated")}</p>
              )}
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-ds-border py-2 text-sm text-ds-text-muted transition hover:bg-ds-bg/50"
              >
                {t("pro.later")}
              </button>
              <button
                onClick={handleActivate}
                disabled={!key.trim()}
                className="flex-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              >
                {t("pro.activate")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
