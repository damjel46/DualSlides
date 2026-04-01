import { useEffect, useState } from "react";
import { getMonitors } from "../lib/commands";
import type { MonitorInfo } from "../lib/commands";

export function useMonitors() {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const result = await getMonitors();
      setMonitors(result);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // Poll for monitor changes every 5 seconds
    const id = setInterval(async () => {
      try {
        const result = await getMonitors();
        setMonitors((prev) => {
          // Only update if monitor count or IDs changed
          if (prev.length !== result.length || prev.some((m, i) => m.id !== result[i]?.id || m.width !== result[i]?.width || m.height !== result[i]?.height)) {
            return result;
          }
          return prev;
        });
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return { monitors, loading, error, refresh };
}
