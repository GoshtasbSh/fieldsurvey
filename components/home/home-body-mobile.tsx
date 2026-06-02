import type { HomeCard } from "@/lib/queries/home";
import { EmptyState } from "./empty-state";
import { MobileProjectRow } from "./mobile-project-row";

type Props = {
  owned: HomeCard[];
  shared: HomeCard[];
  drafts: HomeCard[];
};

/**
 * Mobile /home picker — vertical scrolling list of MobileProjectRow cards
 * grouped by ownership. No view toggle (it's always list on phones), no
 * drafts row (drafts inline into the Owned section with a small badge).
 *
 * Server component: pure render of the same data the desktop bento uses.
 * Tapping a row navigates to /p/[id] which the device middleware then
 * forwards to /p/[id]/m/map.
 */
export function HomeBodyMobile({ owned, shared, drafts }: Props) {
  const empty = owned.length === 0 && shared.length === 0 && drafts.length === 0;
  return (
    <div
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "16px 16px 96px",
      }}
    >
      {empty ? (
        <EmptyState />
      ) : (
        <>
          {drafts.length > 0 ? (
            <Section
              label="Drafts"
              count={drafts.length}
              hint="Tap to finish setup"
            >
              {drafts.map((c) => (
                <MobileProjectRow key={c.id} card={c} />
              ))}
            </Section>
          ) : null}

          {owned.length > 0 ? (
            <Section label="Owned by you" count={owned.length}>
              {owned.map((c) => (
                <MobileProjectRow key={c.id} card={c} />
              ))}
            </Section>
          ) : null}

          {shared.length > 0 ? (
            <Section label="Shared with you" count={shared.length}>
              {shared.map((c) => (
                <MobileProjectRow key={c.id} card={c} />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "0 4px 10px",
        }}
      >
        <h2
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--bento-ink-2)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {label}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--bento-ink-3)",
            }}
          >
            ·  {count}
          </span>
        </h2>
        {hint ? (
          <span style={{ fontSize: 11, color: "var(--bento-ink-3)" }}>
            {hint}
          </span>
        ) : null}
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </section>
  );
}
