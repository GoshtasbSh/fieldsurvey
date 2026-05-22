import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getProjectForUser } from "@/lib/queries/project";
import { ProjectSidebar } from "@/components/project-sidebar";
import { ProjectTabbar } from "@/components/project-tabbar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  const res = await getProjectForUser(projectId);
  if (!res) notFound();

  const { project, role } = res;
  const canView = role || project.visibility === "public_read";
  if (!canView) {
    if (!user) redirect(`/sign-in?next=/p/${projectId}`);
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="flex h-14 items-center gap-3 border-b bg-card px-4 md:hidden">
        <h1 className="truncate font-display text-base font-bold">{project.name}</h1>
      </header>
      <ProjectSidebar projectId={projectId} />
      <main className="flex-1 pb-14 md:pb-0">{children}</main>
      <ProjectTabbar projectId={projectId} />
    </div>
  );
}
