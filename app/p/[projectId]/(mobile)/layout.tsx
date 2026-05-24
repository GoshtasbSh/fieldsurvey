/**
 * Mobile shell — field-collection only. NEVER imports survey-response
 * code (see project_fieldsurvey_mobile_scope in memory). Auth + access
 * checks happen in the parent ../layout.tsx.
 */
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--shell-base)] text-[var(--shell-text)]">
      {children}
    </div>
  );
}
