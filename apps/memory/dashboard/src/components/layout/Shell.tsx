import { Outlet } from "react-router-dom";
import { NavLink } from "./NavLink";
import { StatusBadge } from "./StatusBadge";
import { useHealth } from "@/api/hooks";
import {
  LayoutDashboard,
  Database,
  Search,
  Brain,
} from "lucide-react";

export function Shell() {
  const { data: health } = useHealth();

  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="flex items-center gap-2 border-b px-4 py-4">
          <Brain className="size-5 text-primary" />
          <span className="font-semibold">Memory</span>
          <StatusBadge status={health?.status} />
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          <NavLink to="/" icon={LayoutDashboard} label="Overview" />
          <NavLink to="/memories" icon={Database} label="Memories" />
          <NavLink to="/search" icon={Search} label="Search" />
        </nav>
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">
          {health ? `${health.memoryCount} memories` : "..."}
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
