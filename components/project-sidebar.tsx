"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, List, BarChart3, Inbox, MessageSquare, Users, Settings, Upload } from "lucide-react";

const items = [
  { href: "map", label: "Map", icon: Map },
  { href: "points", label: "Points", icon: List },
  { href: "responses", label: "Responses", icon: Inbox },
  { href: "analytics", label: "Analytics", icon: BarChart3 },
  { href: "chat", label: "Chat", icon: MessageSquare },
  { href: "members", label: "Members", icon: Users },
  { href: "settings", label: "Settings", icon: Settings },
  { href: "import", label: "Import", icon: Upload },
];

export function ProjectSidebar({ projectId }: { projectId: string }) {
  const path = usePathname();
  return (
    <aside className="hidden w-16 shrink-0 flex-col border-r bg-card md:flex">
      {items.map(({ href, label, icon: Icon }) => {
        const active = path?.includes(`/${href}`);
        return (
          <Link
            key={href}
            href={`/p/${projectId}/${href}`}
            className={`flex flex-col items-center gap-1 py-3 text-[10px] uppercase tracking-wider transition ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            title={label}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        );
      })}
    </aside>
  );
}
