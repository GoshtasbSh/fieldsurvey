"use client";

import type { HomeCard } from "@/lib/queries/home";
import { DraftsRow } from "./drafts-row";
import { EmptyState } from "./empty-state";
import { ProjectCard } from "./project-card";
import { ProjectRow } from "./project-row";
import { ViewToggle, useHomeView } from "./view-toggle";

type Props = {
  owned: HomeCard[];
  shared: HomeCard[];
  drafts: HomeCard[];
};

export function HomeBody({ owned, shared, drafts }: Props) {
  const [view, setView] = useHomeView();
  const empty = owned.length === 0 && shared.length === 0 && drafts.length === 0;
  return (
    <div className="mx-auto max-w-[1320px] px-6 py-10">
      {empty ? (
        <EmptyState />
      ) : (
        <>
          <DraftsRow cards={drafts} />
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="bento-label">
              Owned by you ·{" "}
              <span className="text-[var(--bento-ink-3)]">{owned.length}</span>
            </h2>
            <ViewToggle view={view} onChange={setView} />
          </div>
          {owned.length === 0 ? (
            <p className="mb-10 text-[13px] text-[var(--bento-ink-3)]">
              You don&apos;t own any projects yet.
            </p>
          ) : view === "grid" ? (
            <div className="mb-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {owned.map((c) => (
                <ProjectCard key={c.id} card={c} />
              ))}
            </div>
          ) : (
            <div className="mb-10 overflow-hidden rounded-[var(--bento-radius-lg)] border border-[var(--bento-rule)] bg-[var(--bento-surface)]">
              {owned.map((c) => (
                <ProjectRow key={c.id} card={c} />
              ))}
            </div>
          )}
          {shared.length > 0 && (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="bento-label">
                  Shared with you ·{" "}
                  <span className="text-[var(--bento-ink-3)]">
                    {shared.length}
                  </span>
                </h2>
              </div>
              {view === "grid" ? (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {shared.map((c) => (
                    <ProjectCard key={c.id} card={c} />
                  ))}
                </div>
              ) : (
                <div className="overflow-hidden rounded-[var(--bento-radius-lg)] border border-[var(--bento-rule)] bg-[var(--bento-surface)]">
                  {shared.map((c) => (
                    <ProjectRow key={c.id} card={c} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
