import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { MapPin, Users } from "lucide-react";

type Props = {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "public_read";
  role: string;
};

export function ProjectCard({ id, name, description, visibility, role }: Props) {
  return (
    <Link href={`/p/${id}`}>
      <Card className="h-full transition hover:border-primary/50 hover:shadow-lg">
        <CardHeader className="pb-2">
          <h2 className="font-display text-lg font-bold leading-tight">{name}</h2>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {description || "No description"}
          </p>
        </CardHeader>
        <CardContent className="flex items-center gap-3 pt-0 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {visibility === "public_read" ? "Public" : "Private"}</span>
          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {role}</span>
        </CardContent>
      </Card>
    </Link>
  );
}
