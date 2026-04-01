import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { useMonitorConfig } from "../hooks/useMonitorConfig";
import type { MonitorInfo } from "../lib/commands";

interface MonitorSourceProps {
  monitor: MonitorInfo;
}

export function MonitorSource({ monitor }: MonitorSourceProps) {
  const { t } = useTranslation();
  const { config, update, loaded } = useMonitorConfig(monitor.id);

  const { folder, folders: foldersArr, selectedFiles, autoRefresh: _autoRefresh } = config;
  const folders = foldersArr && foldersArr.length > 0 ? foldersArr : folder ? [folder] : [];

  const handleAddFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      const path = selected as string;
      if (folders.includes(path)) return;
      const newFolders = [...folders, path];
      update({
        folders: newFolders,
        folder: newFolders[0],
        selectionMode: "folder",
      });
    }
  };

  const handleRemoveFolder = (folderPath: string) => {
    const newFolders = folders.filter((f) => f !== folderPath);
    update({
      folders: newFolders,
      folder: newFolders[0] || "",
    });
  };

  const handleSelectFiles = async () => {
    const selected = await open({
      directory: false,
      multiple: true,
      filters: [
        { name: "Images", extensions: ["jpg", "jpeg", "png", "bmp", "webp"] },
      ],
    });
    if (selected && Array.isArray(selected) && selected.length > 0) {
      const paths = selected as string[];
      const existing = new Set(selectedFiles);
      const newFiles = paths.filter((p) => !existing.has(p));
      update({
        selectedFiles: [...selectedFiles, ...newFiles],
      });
    }
  };

  if (!loaded) return null;

  return (
    <div className="mt-4 rounded-2xl border border-ds-border bg-ds-card p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-ds-text">
            {monitor.name}
          </h3>
          {monitor.is_primary && (
            <span className="rounded-md bg-ds-accent/20 px-2 py-0.5 text-[10px] font-bold text-ds-accent-light">
              {t("monitor.primary")}
            </span>
          )}
        </div>
        <span className="text-xs text-ds-text-muted">
          {monitor.width}x{monitor.height}
        </span>
      </div>

      {/* Source selection */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-0.5 h-4 rounded-full bg-ds-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-ds-text-muted">{t("monitor.source", { defaultValue: "Source" })}</span>
        </div>
      </div>
      <div className="space-y-2">
        {/* Source list: folders + individual files */}
        {(folders.length > 0 || selectedFiles.length > 0) && (
          <div className="space-y-1">
            {folders.map((f) => (
              <div key={f} className="flex items-center gap-2 rounded-xl border border-ds-accent/30 bg-ds-accent/5 px-3 py-2">
                <svg className="h-4 w-4 shrink-0 text-ds-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="flex-1 truncate text-sm text-ds-text" title={f}>
                  {f.split(/[/\\]/).pop()}
                </span>
                <button
                  onClick={() => handleRemoveFolder(f)}
                  className="shrink-0 rounded-lg p-1 text-ds-text-muted transition hover:bg-red-500/20 hover:text-red-400"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {selectedFiles.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-ds-accent/30 bg-ds-accent/5 px-3 py-2">
                <svg className="h-4 w-4 shrink-0 text-ds-accent-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="flex-1 text-sm text-ds-text">
                  {t("monitor.folder_images", { count: selectedFiles.length })}
                </span>
                <button
                  onClick={() => update({ selectedFiles: [] })}
                  className="shrink-0 rounded-lg p-1 text-ds-text-muted transition hover:bg-red-500/20 hover:text-red-400"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action buttons row */}
        <div className="flex gap-2">
          <button
            onClick={handleAddFolder}
            className="flex flex-1 items-center gap-2 rounded-xl border border-dashed border-ds-border px-3 py-2.5 text-left text-sm transition hover:border-ds-accent/50 hover:bg-ds-accent/5"
          >
            <svg className="h-4 w-4 shrink-0 text-ds-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-ds-text-muted">
              {t("monitor.add_folder", { defaultValue: "Add folder" })}
            </span>
          </button>
          <button
            onClick={handleSelectFiles}
            className="flex flex-1 items-center gap-2 rounded-xl border border-dashed border-ds-border px-3 py-2.5 text-left text-sm transition hover:border-ds-accent/50 hover:bg-ds-accent/5"
          >
            <svg className="h-4 w-4 shrink-0 text-ds-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-ds-text-muted">
              {t("monitor.add_images", { defaultValue: "Add images" })}
            </span>
          </button>
        </div>

      </div>
    </div>
  );
}
