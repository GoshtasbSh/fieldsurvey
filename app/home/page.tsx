import Link from "next/link";
import { Button } from "@/components/ui/button";
import { listMyProjects } from "@/lib/queries/projects";
import { ProjectCard } from "@/components/project-card";
import { Plus } from "lucide-react";

export default async function HomePage() {
  const { owned, shared } = await listMyProjects();
  const empty = owned.length === 0 && shared.length === 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Your projects</h1>
          <p className="text-sm text-muted-foreground">Create or open a survey project.</p>
        </div>
        <Button asChild><Link href="/home/new"><Plus className="mr-1.5 h-4 w-4" /> New project</Link></Button>
      </header>

      {empty && (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No projects yet.</p>
          <Button asChild className="mt-4"><Link href="/home/new">Create your first project</Link></Button>
        </div>
      )}

      {owned.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Owned by you</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {owned.map((p) => (
              <ProjectCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                visibility={p.visibility as "private" | "public_read"}
                role={p.project_members[0].role}
              />
            ))}
          </div>
        </section>
      )}

      {shared.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Shared with you</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shared.map((p) => (
              <ProjectCard
                key={p.id}
                id={p.id}
                name={p.name}
                description={p.description}
                visibility={p.visibility as "private" | "public_read"}
                role={p.project_members[0].role}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
