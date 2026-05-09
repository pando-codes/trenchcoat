"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Terminal,
  Wrench,
  Bot,
  Activity,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

export interface SidebarProps {
  userName: string;
  avatarUrl: string | null;
  userEmail: string;
}

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/sessions", label: "Sessions", icon: Terminal },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/teams", label: "Teams", icon: Users },
];

const bottomItems = [
  { href: "/settings", label: "Settings", icon: Settings },
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function SidebarContent({
  userName,
  avatarUrl,
  userEmail,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <>
      <div className="flex h-14 items-center px-6">
        <Link href="/" className="flex items-center gap-2" onClick={onNavigate}>
          <Terminal className="size-5 text-sidebar-primary" />
          <span className="text-lg font-semibold tracking-tight">
            Claude Telemetry
          </span>
        </Link>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-1 px-3 pb-2">
        {bottomItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <Separator />

      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar size="sm">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={userName} />}
          <AvatarFallback>{getInitials(userName)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col overflow-hidden">
          <span className="truncate text-sm font-medium">{userName}</span>
          <span className="truncate text-xs text-sidebar-foreground/60">
            {userEmail}
          </span>
        </div>
      </div>
    </>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <SidebarContent {...props} />
    </aside>
  );
}
