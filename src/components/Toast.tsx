import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

export type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let globalAddToast: ((message: string, type?: ToastType) => void) | null = null;

/** Show a toast from anywhere (call after ToastProvider is mounted) */
export function toast(message: string, type: ToastType = "info") {
  globalAddToast?.(message, type);
}

// Sonner-inspired: subtle left accent bar, neutral dark bg, clean text
const ACCENT: Record<ToastType, string> = {
  success: "#10b981",
  error: "#ef4444",
  warning: "#f59e0b",
  info: "#a78bfa",
};

const DURATION = 3000;

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  let idCounter = 0;

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + idCounter++;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DURATION);
  }, []);

  useEffect(() => {
    globalAddToast = addToast;
    return () => { globalAddToast = null; };
  }, [addToast]);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[9998] flex flex-col gap-2.5">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="pointer-events-auto flex items-stretch overflow-hidden rounded-lg shadow-lg shadow-black/20"
            style={{ backgroundColor: "rgba(24, 24, 36, 0.95)" }}
          >
            {/* Accent bar */}
            <div className="w-1 shrink-0" style={{ backgroundColor: ACCENT[t.type] }} />
            {/* Content */}
            <div className="flex items-center px-3.5 py-2.5">
              <span className="text-[13px] text-neutral-200">{t.message}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
