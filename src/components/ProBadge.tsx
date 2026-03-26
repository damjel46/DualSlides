import { useTranslation } from "react-i18next";

interface ProBadgeProps {
  title?: string;
  description?: string;
}

export function ProBadge({ title, description }: ProBadgeProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <span className="shrink-0 rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">
        PRO
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-amber-200/90">
          {title || t("pro.feature_locked")}
        </div>
        {description && (
          <div className="truncate text-xs text-amber-200/50">{description}</div>
        )}
      </div>
      <button className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/30">
        {t("pro.upgrade")}
      </button>
    </div>
  );
}
