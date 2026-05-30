export function CardSkeleton({ label }: { label: string }) {
  return (
    <div className="bento-panel p-4 animate-pulse">
      <div className="bento-label mb-3">{label}</div>
      <div className="h-20 rounded-lg bg-[var(--shell-2)]" />
    </div>
  );
}
