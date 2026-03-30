import { useCallback, useEffect, useRef, useState } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { load } from "@tauri-apps/plugin-store";

export interface HotkeyBinding {
  action: string;
  shortcut: string;
}

const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  { action: "next_wallpaper", shortcut: "Ctrl+Alt+Right" },
  { action: "prev_wallpaper", shortcut: "Ctrl+Alt+Left" },
  { action: "toggle_slideshow", shortcut: "Ctrl+Alt+P" },
  { action: "zen_mode", shortcut: "Ctrl+Alt+Z" },
  { action: "pin_wallpaper", shortcut: "Ctrl+Alt+L" },
  { action: "favorite_current", shortcut: "Ctrl+Alt+F" },
];

const STORE_FILE = "hotkeys.json";

let storePromise: ReturnType<typeof load> | null = null;
function getStore() {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storePromise;
}

export function useHotkeys(
  onAction: (action: string) => void,
) {
  const [hotkeys, setHotkeys] = useState<HotkeyBinding[]>(DEFAULT_HOTKEYS);
  const [loaded, setLoaded] = useState(false);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Load saved hotkeys from store
  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const saved = await store.get<HotkeyBinding[]>("bindings");
        if (saved && saved.length > 0) {
          // Merge: use saved shortcuts but keep default actions/proOnly flags
          const merged = DEFAULT_HOTKEYS.map((def) => {
            const s = saved.find((h) => h.action === def.action);
            return s ? { ...def, shortcut: s.shortcut } : def;
          });
          setHotkeys(merged);
        }
      } catch { /* */ }
      setLoaded(true);
    })();
  }, []);

  // Register global shortcuts
  useEffect(() => {
    if (!loaded) return;
    const registered: string[] = [];

    const registerAll = async () => {
      for (const binding of hotkeys) {
        try {
          await register(binding.shortcut, (event) => {
            if (event.state === "Pressed") {
              onActionRef.current(binding.action);
            }
          });
          registered.push(binding.shortcut);
        } catch (e) {
          console.error(`Failed to register hotkey ${binding.shortcut}:`, e);
        }
      }
    };

    registerAll();

    return () => {
      for (const shortcut of registered) {
        unregister(shortcut).catch(() => {});
      }
    };
  }, [hotkeys, loaded]);

  // Save + re-register on update
  const updateHotkey = useCallback(
    async (action: string, newShortcut: string) => {
      const existing = hotkeys.find((h) => h.action === action);
      if (existing) {
        try {
          await unregister(existing.shortcut);
        } catch { /* */ }
      }

      const updated = hotkeys.map((h) =>
        h.action === action ? { ...h, shortcut: newShortcut } : h,
      );
      setHotkeys(updated);

      // Persist
      try {
        const store = await getStore();
        await store.set("bindings", updated);
      } catch { /* */ }
    },
    [hotkeys],
  );

  return { hotkeys, updateHotkey, loaded };
}
