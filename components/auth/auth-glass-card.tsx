export function AuthGlassCard({
  title,
  ribbon,
  children,
}: {
  title: string;
  ribbon?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fos-card p-7">
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="font-display text-[22px] font-bold leading-none">{title}</h1>
        {ribbon ? <span className="fos-ribbon">{ribbon}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function AuthCardFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 text-center text-[13px] text-[var(--bento-ink-2)]">
      {children}
    </div>
  );
}
