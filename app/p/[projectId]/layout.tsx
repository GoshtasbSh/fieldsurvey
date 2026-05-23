import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/queries/project";

/**
 * Outer project layout — auth + project access gate ONLY.
 * The visual shell lives in (desktop)/layout.tsx and (mobile)/layout.tsx.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const { project, role } = res;
  const canView = role || project.visibility === "public_read";
  if (!canView) {
    if (!user) redirect(`/sign-in?next=/p/${projectId}`);
    notFound();
  }

  return <>{children}</>;
}
