import { useCallback, useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";

const STORE_FILE = "license.json";

let storePromise: ReturnType<typeof load> | null = null;
function getStore() {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storePromise;
}

export function usePro() {
  const [license, setLicense] = useState<"lite" | "pro">("lite");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const val = await store.get<string>("license");
        if (val === "pro") setLicense("pro");
      } catch { /* */ }
      setLoaded(true);
    })();
  }, []);

  const isPro = license === "pro";

  const activate = useCallback(async (key: string) => {
    // Placeholder: in production, validate key with server or Steam DLC check
    if (key === "DUALSLIDE-PRO" || key === "pro") {
      setLicense("pro");
      try {
        const store = await getStore();
        await store.set("license", "pro");
      } catch { /* */ }
      return true;
    }
    return false;
  }, []);

  return { isPro, license, loaded, activate };
}
