import { getProjectForUser } from "@/lib/queries/project";

export default async function ProjectMapPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const r = await getProjectForUser(projectId);
  return (
    <div className="p-6">
      <h1 className="font-display text-2xl font-bold">{r?.project.name}</h1>
      <p className="text-sm text-muted-foreground">Desktop map view — comes online in M2.</p>
    </div>
  );
}
