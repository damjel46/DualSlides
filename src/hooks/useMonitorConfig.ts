import { useCallback, useEffect, useRef, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import type { ImageInfo, SlideshowMode } from "../lib/commands";

export interface MonitorConfig {
  folder: string;
  folders: string[];
  selectedFiles: string[];
  images: ImageInfo[];
  excluded: string[];
  favorites: string[];
  selectionMode: "folder" | "files";
  interval: number;
  useCustom: boolean;
  customInput: string;
  mode: SlideshowMode;
  autoRefresh: boolean;
}

const DEFAULT_CONFIG: MonitorConfig = {
  folder: "",
  folders: [],
  selectedFiles: [],
  images: [],
  excluded: [],
  favorites: [],
  selectionMode: "folder",
  interval: 300,
  useCustom: false,
  customInput: "",
  mode: "Sequential",
  autoRefresh: true,
};

const STORE_FILE = "monitor-configs.json";

let storePromise: ReturnType<typeof load> | null = null;
function getStore() {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storePromise;
}

export function useMonitorConfig(monitorId: string) {
  const [config, setConfig] = useState<MonitorConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);
  const saving = useRef(false);
  // Track which monitorId the current config belongs to, to prevent cross-save
  const loadedForId = useRef<string | null>(null);

  // Load from store on monitorId change
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    loadedForId.current = null;

    (async () => {
      try {
        const store = await getStore();
        const saved = await store.get<MonitorConfig>(monitorId);
        if (!cancelled) {
          setConfig(saved ? { ...DEFAULT_CONFIG, ...saved } : { ...DEFAULT_CONFIG });
          loadedForId.current = monitorId;
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setConfig({ ...DEFAULT_CONFIG });
          loadedForId.current = monitorId;
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [monitorId]);

  // Save to store — only when ready AND the config is for the current monitorId
  useEffect(() => {
    if (!ready || saving.current || loadedForId.current !== monitorId) return;
    saving.current = true;
    (async () => {
      try {
        const store = await getStore();
        await store.set(monitorId, config);
      } catch {
        // ignore
      }
      // Delay resetting flag to prevent onKeyChange from overwriting
      setTimeout(() => { saving.current = false; }, 100);
    })();
  }, [monitorId, config, ready]);

  // Listen for external store changes (e.g. sync from another monitor)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const store = await getStore();
        unlisten = await store.onKeyChange(monitorId, (val) => {
          if (val && !saving.current && loadedForId.current === monitorId) {
            setConfig({ ...DEFAULT_CONFIG, ...(val as MonitorConfig) });
          }
        });
      } catch {
        /* */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [monitorId]);

  const update = useCallback(
    (patch: Partial<MonitorConfig>) => {
      setConfig((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  return { config, update, loaded: ready };
}

/** Get all monitor configs from store (for sync-start) */
export async function getAllMonitorConfigs(): Promise<Record<string, MonitorConfig>> {
  const result: Record<string, MonitorConfig> = {};
  try {
    const store = await getStore();
    const keys = await store.keys();
    for (const key of keys) {
      if (!key.startsWith("monitor_")) continue;
      const cfg = await store.get<MonitorConfig>(key);
      if (cfg && cfg.images && cfg.images.length > 0) {
        result[key] = { ...DEFAULT_CONFIG, ...cfg };
      }
    }
  } catch { /* */ }
  return result;
}

/** Sync interval + mode settings from one monitor to all others in the store */
export async function syncSettingsFromMonitor(sourceMonitorId: string) {
  try {
    const store = await getStore();
    const source = await store.get<MonitorConfig>(sourceMonitorId);
    if (!source) return;

    const keys = await store.keys();
    for (const key of keys) {
      if (!key.startsWith("monitor_") || key === sourceMonitorId) continue;
      const target = await store.get<MonitorConfig>(key);
      if (!target) continue;
      // Copy interval + mode — never folder, images, excluded, etc.
      await store.set(key, {
        ...target,
        interval: source.interval,
        useCustom: source.useCustom,
        customInput: source.customInput,
        mode: source.mode,
      });
    }
  } catch {
    /* */
  }
}

/** Load global app settings (syncEnabled, etc.) */
export function useAppConfig() {
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const val = await store.get<boolean>("syncEnabled");
        if (val !== undefined && val !== null) setSyncEnabled(val);
      } catch {
        /* */
      }
      setLoaded(true);
    })();
  }, []);

  const setSync = useCallback(async (val: boolean) => {
    setSyncEnabled(val);
    try {
      const store = await getStore();
      await store.set("syncEnabled", val);
    } catch {
      /* */
    }
  }, []);

  return { syncEnabled, setSync, loaded };
}
