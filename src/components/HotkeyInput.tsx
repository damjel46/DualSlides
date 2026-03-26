import { useState, useRef } from "react";

interface HotkeyInputProps {
  value: string;
  onChange: (shortcut: string) => void;
  disabled?: boolean;
}

export function HotkeyInput({ value, onChange, disabled }: HotkeyInputProps) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");

    const key = e.key;
    if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
      const normalizedKey =
        key === " "
          ? "Space"
          : key === "ArrowLeft"
            ? "Left"
            : key === "ArrowRight"
              ? "Right"
              : key === "ArrowUp"
                ? "Up"
                : key === "ArrowDown"
                  ? "Down"
                  : key.length === 1
                    ? key.toUpperCase()
                    : key;
      parts.push(normalizedKey);
      onChange(parts.join("+"));
      setRecording(false);
    }
  };

  return (
    <button
      ref={ref}
      onClick={() => !disabled && setRecording(true)}
      onKeyDown={handleKeyDown}
      onBlur={() => setRecording(false)}
      className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition ${
        disabled
          ? "cursor-not-allowed border-ds-border bg-ds-bg/30 text-ds-text-muted opacity-50"
          : recording
            ? "border-ds-accent bg-ds-accent/10 text-ds-accent-light"
            : "border-ds-border bg-ds-bg/50 text-ds-text-dim hover:border-ds-accent/50"
      }`}
    >
      {recording ? "..." : value}
    </button>
  );
}
