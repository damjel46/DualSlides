import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../locales/en.json";
import ko from "../locales/ko.json";
import ja from "../locales/ja.json";
import zh from "../locales/zh.json";
import es from "../locales/es.json";

const SUPPORTED = ["en", "ko", "ja", "zh", "es"];

function detectLanguage(): string {
  const sysLng = navigator.language.split("-")[0];
  return SUPPORTED.includes(sysLng) ? sysLng : "en";
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ko: { translation: ko },
      ja: { translation: ja },
      zh: { translation: zh },
      es: { translation: es },
    },
    lng: detectLanguage(),
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

// Load saved language preference from store (async)
import("@tauri-apps/plugin-store")
  .then((m) => m.load("settings.json", { autoSave: true, defaults: {} }))
  .then(async (store) => {
    const saved = await store.get<string>("language");
    if (saved && saved !== "auto") {
      i18n.changeLanguage(saved);
    }
    // "auto" or no saved preference → keep detected language
  })
  .catch(() => {});

export default i18n;
