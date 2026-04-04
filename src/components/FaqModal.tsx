import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";

interface FaqItem {
  icon: string;
  titleKey: string;
  items: string[];
}

const FAQ_SECTIONS: FaqItem[] = [
  {
    icon: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    titleKey: "faq.basics",
    items: [
      "faq.basics_1",
      "faq.basics_2",
      "faq.basics_3",
      "faq.basics_4",
    ],
  },
  {
    icon: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
    titleKey: "faq.favorites",
    items: [
      "faq.favorites_1",
      "faq.favorites_2",
      "faq.favorites_3",
    ],
  },
  {
    icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    titleKey: "faq.profiles",
    items: [
      "faq.profiles_1",
      "faq.profiles_2",
      "faq.profiles_3",
      "faq.profiles_4",
    ],
  },
  {
    icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    titleKey: "faq.schedule",
    items: [
      "faq.schedule_1",
      "faq.schedule_2",
    ],
  },
  {
    icon: "M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    titleKey: "faq.zen",
    items: [
      "faq.zen_1",
      "faq.zen_2",
      "faq.zen_3",
    ],
  },
  {
    icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707",
    titleKey: "faq.hotkeys",
    items: [
      "faq.hotkeys_1",
      "faq.hotkeys_2",
      "faq.hotkeys_3",
      "faq.hotkeys_4",
      "faq.hotkeys_5",
    ],
  },
  {
    icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
    titleKey: "faq.troubleshooting",
    items: [
      "faq.trouble_1",
      "faq.trouble_2",
      "faq.trouble_3",
      "faq.trouble_4",
      "faq.trouble_5",
    ],
  },
];

export function FaqModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
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
            className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-ds-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h2 className="text-lg font-bold text-ds-text">{t("faq.title")}</h2>
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

            {/* Accordion */}
            <div className="overflow-y-auto px-6 pb-6" style={{ maxHeight: "calc(80vh - 72px)" }}>
              <div className="space-y-2">
                {FAQ_SECTIONS.map((section, idx) => (
                  <div key={idx} className="rounded-xl border border-ds-border bg-ds-bg/30 overflow-hidden">
                    <button
                      onClick={() => setExpanded(expanded === idx ? null : idx)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ds-card-hover"
                    >
                      <svg className="h-4 w-4 shrink-0 text-ds-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={section.icon} />
                      </svg>
                      <span className="flex-1 text-sm font-medium text-ds-text">{t(section.titleKey)}</span>
                      <svg
                        className={`h-4 w-4 shrink-0 text-ds-text-muted transition-transform ${expanded === idx ? "rotate-180" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <AnimatePresence>
                      {expanded === idx && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <ul className="space-y-2 px-4 pb-4 pt-1">
                            {section.items.map((key, i) => (
                              <li key={i} className="flex gap-2 text-xs leading-relaxed text-ds-text/80">
                                <span className="mt-1 shrink-0 text-ds-accent">•</span>
                                <span>{t(key)}</span>
                              </li>
                            ))}
                          </ul>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>

              {/* Contact */}
              <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-ds-border bg-ds-bg/30 px-4 py-3">
                <svg className="h-4 w-4 shrink-0 text-ds-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="text-xs text-ds-text-muted">{t("faq.contact")}</span>
                <a
                  href="mailto:noit0411@gmail.com"
                  className="text-xs font-medium text-ds-accent hover:underline"
                >
                  noit0411@gmail.com
                </a>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
