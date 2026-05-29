export function AuthWordmark({ tagline }: { tagline?: string }) {
  return (
    <div className="mb-6 text-center">
      <div className="mb-3 flex items-center justify-center gap-3">
        <div className="fos-wordmark-tile" aria-hidden>
          <div className="fos-wordmark-tile-inner" />
          <div className="fos-wordmark-tile-dot" />
        </div>
        <div className="font-display text-[22px] font-bold leading-none tracking-tight">
          field<span style={{ color: "var(--bento-accent)" }}>survey</span>
        </div>
      </div>
      {tagline ? (
        <p className="text-[13.5px] leading-snug text-[var(--bento-ink-2)]">{tagline}</p>
      ) : null}
    </div>
  );
}
