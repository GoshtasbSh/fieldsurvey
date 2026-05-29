import Link from "next/link";

export default async function UseDesktopPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = sp.next ?? "/home";
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[var(--bento-bg)] px-6 text-[var(--bento-ink-1)]">
      <div className="max-w-md text-center">
        <h1 className="mb-3 font-display text-[24px] font-bold">
          Open this on a desktop
        </h1>
        <p className="mb-6 text-[14px] text-[var(--bento-ink-2)]">
          Viewer access is read-only and lives on the desktop dashboard. The
          mobile shell is for surveyors who collect points in the field.
        </p>
        <Link
          href={next}
          className="inline-flex items-center gap-2 rounded-[var(--bento-radius-md)] bg-[var(--bento-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--bento-on-accent)] shadow-[var(--bento-shadow-accent)]"
        >
          Go to desktop
        </Link>
      </div>
    </main>
  );
}
