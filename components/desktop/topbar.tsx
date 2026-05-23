import Link from "next/link";
import { Bell, Sun } from "lucide-react";

type Props = {
  projectName: string;
  scope: "today" | "week" | "all";
  liveCount: number;
};

/**
 * Slim top bar — 52px. Brand on the left, project switcher + scope toggle
 * in the middle, live pill + notifs + avatar on the right. No navigation
 * lives here — nav is exclusively the left rail.
 */
export function DesktopTopbar({ projectName, scope, liveCount }: Props) {
  return (
    <header className="grid h-[52px] grid-cols-[280px_1fr_360px] items-center border-b border-[oklch(28%_0.02_250/0.55)] bg-gradient-to-b from-[oklch(17%_0.014_250)] to-[oklch(14%_0.012_250)] relative">
      <div className="flex items-center gap-3 pl-[18px]">
        <Link href="/home" className="relative h-[26px] w-[26px] rounded-[7px] bg-[conic-gradient(from_200deg,oklch(78%_0.155_234)_0deg,transparent_220deg,oklch(78%_0.155_234)_360deg)] before:absolute before:inset-1 before:rounded-[4px] before:bg-[oklch(14%_0.012_250)] after:absolute after:inset-0 after:m-auto after:h-[6px] after:w-[6px] after:rounded-full after:bg-[oklch(78%_0.155_234)] after:shadow-[0_0_12px_oklch(78%_0.155_234/0.35)]" />
        <span className="font-display text-[14.5px] font-extrabold tracking-tight">
          field<span className="text-[oklch(78%_0.155_234)]">survey</span>
        </span>
      </div>

      <div className="flex items-center justify-center gap-3.5">
        <button className="inline-flex items-center gap-2.5 rounded-[9px] border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] py-[5px] pl-[6px] pr-3 text-[12.5px] hover:border-[oklch(36%_0.025_250/0.7)] hover:bg-[oklch(24%_0.018_250)] transition">
          <span className="h-[22px] w-[22px] flex-shrink-0 rounded-[5px] bg-gradient-to-br from-[oklch(72%_0.18_305)] to-[oklch(78%_0.155_234)]" />
          <span className="flex flex-col items-start leading-tight">
            <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-[oklch(58%_0.014_250)]">Project</span>
            <span className="font-semibold text-[oklch(96%_0.008_250)] text-[12.5px]">{projectName}</span>
          </span>
          <span className="text-[oklch(58%_0.014_250)] text-[10px]">▾</span>
        </button>
        <div className="inline-flex rounded-lg border border-[oklch(28%_0.02_250/0.55)] bg-[oklch(20%_0.016_250)] p-0.5">
          {(["today", "week", "all"] as const).map((s) => (
            <button
              key={s}
              className={`rounded-md px-[11px] py-1 font-display text-[10.5px] font-bold transition ${
                scope === s
                  ? "bg-[oklch(22%_0.02_250)] text-[oklch(96%_0.008_250)] shadow-[inset_0_0_0_1px_oklch(28%_0.02_250/0.55)]"
                  : "text-[oklch(58%_0.014_250)] hover:text-[oklch(76%_0.012_250)]"
              }`}
            >
              {s === "all" ? "All time" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2.5 pr-[18px]">
        <span className="inline-flex items-center gap-[7px] rounded-full border border-[oklch(76%_0.16_158/0.3)] bg-[oklch(76%_0.16_158/0.1)] py-1 pl-2 pr-[11px] text-[11px] font-semibold text-[oklch(76%_0.16_158)]">
          <span className="relative h-[6px] w-[6px] rounded-full bg-[oklch(76%_0.16_158)] after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-[oklch(76%_0.16_158/0.55)]" />
          Live · {liveCount} surveyors
        </span>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[oklch(76%_0.012_250)] hover:bg-[oklch(20%_0.016_250)] hover:text-[oklch(96%_0.008_250)] transition">
          <Bell className="h-4 w-4" strokeWidth={1.7} />
        </button>
        <button className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[oklch(76%_0.012_250)] hover:bg-[oklch(20%_0.016_250)] hover:text-[oklch(96%_0.008_250)] transition">
          <Sun className="h-4 w-4" strokeWidth={1.7} />
        </button>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[oklch(28%_0.02_250/0.55)] bg-gradient-to-br from-[oklch(72%_0.18_305)] to-[oklch(78%_0.155_234)] text-[11.5px] font-bold text-[oklch(14%_0.012_250)]">
          GS
        </div>
      </div>
    </header>
  );
}
