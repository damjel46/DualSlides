import { useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";

export type Theme = "dark" | "light";

export interface AccentColor {
  id: string;
  name: string;
  dark: { accent: string; accentLight: string };
  light: { accent: string; accentLight: string };
}

export const ACCENT_COLORS: AccentColor[] = [
  { id: "cyan",    name: "Cyan",    dark: { accent: "#0e7490", accentLight: "#0891b2" }, light: { accent: "#0891b2", accentLight: "#06b6d4" } },
  { id: "blue",    name: "Blue",    dark: { accent: "#2563eb", accentLight: "#3b82f6" }, light: { accent: "#1d4ed8", accentLight: "#2563eb" } },
  { id: "indigo",  name: "Indigo",  dark: { accent: "#4f46e5", accentLight: "#6366f1" }, light: { accent: "#4338ca", accentLight: "#4f46e5" } },
  { id: "violet",  name: "Violet",  dark: { accent: "#7c3aed", accentLight: "#8b5cf6" }, light: { accent: "#6d28d9", accentLight: "#7c3aed" } },
  { id: "rose",    name: "Rose",    dark: { accent: "#e11d48", accentLight: "#f43f5e" }, light: { accent: "#be123c", accentLight: "#e11d48" } },
  { id: "amber",   name: "Amber",   dark: { accent: "#d97706", accentLight: "#f59e0b" }, light: { accent: "#b45309", accentLight: "#d97706" } },
  { id: "emerald", name: "Emerald", dark: { accent: "#059669", accentLight: "#10b981" }, light: { accent: "#047857", accentLight: "#059669" } },
  { id: "slate",   name: "Slate",   dark: { accent: "#64748b", accentLight: "#94a3b8" }, light: { accent: "#475569", accentLight: "#64748b" } },
];

// Lighten a hex color by a fixed amount for the "accentLight" variant
function lightenHex(hex: string, amount = 25): string {
  const h = hex.replace("#", "");
  const r = Math.min(255, parseInt(h.substring(0, 2), 16) + amount);
  const g = Math.min(255, parseInt(h.substring(2, 4), 16) + amount);
  const b = Math.min(255, parseInt(h.substring(4, 6), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function applyAccent(theme: Theme, color: AccentColor) {
  const values = theme === "dark" ? color.dark : color.light;
  document.documentElement.style.setProperty("--ds-accent", values.accent);
  document.documentElement.style.setProperty("--ds-accent-light", values.accentLight);
}

function applyCustomAccent(hex: string) {
  document.documentElement.style.setProperty("--ds-accent", hex);
  document.documentElement.style.setProperty("--ds-accent-light", lightenHex(hex));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [accentId, setAccentIdState] = useState("cyan");
  const [customHex, setCustomHexState] = useState<string | null>(null);

  useEffect(() => {
    load("settings.json", { autoSave: true, defaults: {} }).then(async (store) => {
      const savedTheme = await store.get<Theme>("theme");
      const savedAccent = await store.get<string>("accentColor");
      const savedCustom = await store.get<string>("customAccentHex");

      const t = savedTheme === "dark" || savedTheme === "light" ? savedTheme : "dark";
      document.documentElement.dataset.theme = t;
      setThemeState(t);

      if (savedAccent === "custom" && savedCustom) {
        setAccentIdState("custom");
        setCustomHexState(savedCustom);
        applyCustomAccent(savedCustom);
      } else {
        const a = ACCENT_COLORS.find((c) => c.id === savedAccent) ? savedAccent! : "cyan";
        setAccentIdState(a);
        applyAccent(t, ACCENT_COLORS.find((c) => c.id === a)!);
      }
    }).catch(() => {});
  }, []);

  const setTheme = async (t: Theme) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    if (accentId === "custom" && customHex) {
      applyCustomAccent(customHex);
    } else {
      const color = ACCENT_COLORS.find((c) => c.id === accentId)!;
      applyAccent(t, color);
    }
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("theme", t);
  };

  const setAccent = async (id: string) => {
    const color = ACCENT_COLORS.find((c) => c.id === id);
    if (!color) return;
    setAccentIdState(id);
    setCustomHexState(null);
    applyAccent(theme, color);
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("accentColor", id);
    await store.set("customAccentHex", null);
  };

  const setCustomAccent = async (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    setAccentIdState("custom");
    setCustomHexState(hex);
    applyCustomAccent(hex);
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("accentColor", "custom");
    await store.set("customAccentHex", hex);
  };

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return { theme, setTheme, toggleTheme, accentId, setAccent, customHex, setCustomAccent };
}
