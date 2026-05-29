import Link from "next/link";
import { Plus } from "lucide-react";

export function EmptyState() {
  return (
    <div className="rounded-[var(--bento-radius-xl)] border border-dashed border-[var(--bento-rule)] bg-[var(--bento-surface-2)] p-16 text-center">
      <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-[var(--bento-radius-lg)] bg-[var(--bento-accent-soft)]">
        <div
          className="h-3 w-3 rounded-full"
          style={{
            background: "var(--bento-accent)",
            boxShadow: "0 0 18px var(--bento-accent-glow)",
          }}
        />
      </div>
      <h2 className="mb-2 font-display text-[24px] font-bold text-[var(--bento-ink-1)]">
        Your first survey starts with a parcel.
      </h2>
      <p className="mx-auto mb-6 max-w-[480px] text-[13.5px] leading-relaxed text-[var(--bento-ink-2)]">
        Upload an address list, draw a study area, or import a CSV of responses.
        FieldSurvey re-geocodes every address and snaps it to its parcel center
        automatically.
      </p>
      <div className="flex items-center justify-center gap-4">
        <Link
          href="/home/new"
          className="inline-flex items-center gap-2 rounded-[var(--bento-radius-md)] bg-[var(--bento-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--bento-on-accent)] shadow-[var(--bento-shadow-accent)] transition-transform hover:-translate-y-0.5"
        >
          <Plus size={14} /> Create your first project
        </Link>
      </div>
    </div>
  );
}
