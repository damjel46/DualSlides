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
  }, []);

  return { monitors, loading, error, refresh };
}
