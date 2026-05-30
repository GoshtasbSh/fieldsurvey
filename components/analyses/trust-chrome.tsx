type Props = {
  cardName: string;
  n?: number;
  lastUpdated?: string | null;
  methodHref?: string;
  denominatorLabel?: string;
  modeled?: boolean;
};
export function TrustChrome({ cardName, n, lastUpdated, methodHref, denominatorLabel, modeled }: Props) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <div className="bento-label">{cardName}</div>
      <div className="flex items-center gap-2 font-mono text-[9.5px] text-[var(--shell-text-muted)]">
        {typeof n === "number" && <span>n={n}</span>}
        {denominatorLabel && <span>· {denominatorLabel}</span>}
        {modeled && <span className="rounded-sm bg-[var(--shell-3)] px-1 py-px">modeled</span>}
        {lastUpdated && <span>· as of {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        {methodHref && <a href={methodHref} className="underline">method ↗</a>}
      </div>
    </div>
  );
}
