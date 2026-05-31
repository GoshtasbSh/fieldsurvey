// components/analyses/toolbox-left-rail.tsx
"use client";
import type { Toolbox } from "@/lib/analyses/toolboxes";
import type { ToolboxSlug } from "@/lib/analyses/types";

type Props = {
  toolboxes: Toolbox[];
  activeSlug: ToolboxSlug;
  onSelect: (slug: ToolboxSlug) => void;
};

export function ToolboxLeftRail({ toolboxes, activeSlug, onSelect }: Props) {
  const v1 = toolboxes.filter((t) => !t.isV2).sort((a, b) => a.sortOrder - b.sortOrder);
  const v2 = toolboxes.filter((t) => t.isV2).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <nav
      role="tablist"
      aria-label="Spatial Analysis Toolboxes"
      className="border-r border-[var(--shell-border)] bg-[var(--shell-2)] flex flex-col py-3 gap-0.5 text-sm"
    >
      <div className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">
        Toolboxes
      </div>
      {v1.map((t) => (
        <button
          key={t.slug}
          role="tab"
          aria-selected={activeSlug === t.slug}
          data-v2="false"
          onClick={() => onSelect(t.slug)}
          className={
            "text-left px-3 py-2 mx-1 rounded-md flex items-center gap-2 " +
            (activeSlug === t.slug
              ? "bg-[var(--shell-1)] text-[var(--shell-text)] font-semibold"
              : "text-[var(--shell-text-muted)] hover:bg-[var(--shell-1)]/60")
          }
        >
          <span aria-hidden>{t.icon}</span>
          <span className="text-[12.5px]">{t.label}</span>
        </button>
      ))}
      <div className="px-3 pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--shell-text-muted)]">
        Coming in v2
      </div>
      {v2.map((t) => (
        <div
          key={t.slug}
          role="tab"
          data-v2="true"
          aria-disabled
          className="text-left px-3 py-2 mx-1 rounded-md flex items-center gap-2
                     opacity-50 cursor-not-allowed text-[12.5px]"
        >
          <span aria-hidden>{t.icon}</span>
          <span>{t.label}</span>
        </div>
      ))}
    </nav>
  );
}
