"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, Plus, MessageSquare, MoreHorizontal } from "lucide-react";

export function ProjectTabbar({ projectId }: { projectId: string }) {
  const path = usePathname();
  const items = [
    { href: `/p/${projectId}/field`, label: "Map", icon: Map },
    { href: `/p/${projectId}/field/add`, label: "Add", icon: Plus },
    { href: `/p/${projectId}/field/chat`, label: "Chat", icon: MessageSquare },
    { href: `/p/${projectId}/field/more`, label: "More", icon: MoreHorizontal },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex h-14 items-center border-t bg-card md:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = path === href;
        return (
          <Link key={href} href={href} className={`flex flex-1 flex-col items-center gap-0.5 text-[10px] ${active ? "text-primary" : "text-muted-foreground"}`}>
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
