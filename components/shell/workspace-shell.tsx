"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { PageTransition } from "@/components/motion/page-transition";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/components/ui/cn";
import { CommandPalette } from "./command-palette";
import { PRIMARY_NAV_ITEMS, resolveNavItem } from "./nav-items";
import { useSse } from "./sse-provider";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";

const emptySubscribe = () => () => {};

function getClientShortcutLabel(): string {
  if (
    typeof navigator !== "undefined" &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
  ) {
    return "⌘K";
  }
  return "Ctrl K";
}

function useShortcutLabel(): string {
  return React.useSyncExternalStore(
    emptySubscribe,
    getClientShortcutLabel,
    () => "Ctrl K"
  );
}

function LiveStatusPill() {
  const { connectionState, broadcastUnavailable } = useSse();

  const statusMeta = React.useMemo(() => {
    switch (connectionState) {
      case "connected":
        return {
          label: "Live",
          dotClass: "bg-[var(--accent)]",
          textClass: "text-[var(--text-secondary)]",
          title: broadcastUnavailable
            ? "Live SSE connected (per-tab mode: BroadcastChannel unavailable)"
            : "Live worker updates connected",
        };
      case "reconnecting":
        return {
          label: "Reconnecting",
          dotClass: "bg-[var(--warning)]",
          textClass: "text-[var(--text-secondary)]",
          title: "Reconnecting to live worker event stream",
        };
      case "paused":
        return {
          label: "Live updates paused",
          dotClass: "bg-[var(--text-tertiary)]",
          textClass: "text-[var(--text-secondary)]",
          title: "SSE disconnected over 30s; checking visible tasks every 30s",
        };
    }
  }, [broadcastUnavailable, connectionState]);

  return (
    <div
      role="status"
      aria-live="polite"
      title={statusMeta.title}
      className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] whitespace-nowrap"
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dotClass)}
      />
      <span className={cn("font-data", statusMeta.textClass)}>
        {statusMeta.label}
      </span>
    </div>
  );
}

function NavList({
  collapsed,
  pathname,
  onNavigate,
}: {
  collapsed: boolean;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary navigation" className="flex flex-col gap-0.5 px-2 py-2">
      {PRIMARY_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            aria-label={collapsed ? item.label : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "group flex h-9 items-center gap-2.5 rounded-[4px] px-2.5 text-[13px] font-medium transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
              collapsed && "justify-center px-0",
              isActive
                ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                isActive
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
              )}
              aria-hidden="true"
            />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function WorkspaceShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activeRoute = resolveNavItem(pathname);
  const shortcutLabel = useShortcutLabel();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const {
    searchProfiles,
    activeProfileId,
    setActiveProfileId,
    sidebarCollapsed,
    toggleSidebar,
    setCommandPaletteOpen,
  } = useWorkspace();

  return (
    <div className="flex min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      {/* Persistent left rail for tablet/desktop (>=768px) */}
      <aside
        aria-label="Workspace sidebar"
        className={cn(
          "hidden shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-150 md:flex",
          sidebarCollapsed ? "w-[64px]" : "w-[220px]"
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-[var(--border)] px-3",
            sidebarCollapsed ? "justify-center" : "justify-between"
          )}
        >
          {!sidebarCollapsed ? (
            <Link
              href="/"
              className="truncate text-[13px] font-semibold tracking-tight text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Job Copilot
            </Link>
          ) : null}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={
              sidebarCollapsed ? "Expand navigation rail" : "Collapse navigation rail"
            }
            title={
              sidebarCollapsed ? "Expand navigation rail" : "Collapse navigation rail"
            }
            className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <NavList collapsed={sidebarCollapsed} pathname={pathname} />
        </div>

        {!sidebarCollapsed ? (
          <div className="border-t border-[var(--border)] px-3 py-2.5 text-[11px] text-[var(--text-tertiary)]">
            Local-first workbench
          </div>
        ) : null}
      </aside>

      {/* Accessible mobile navigation drawer (<768px) */}
      <Drawer open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DrawerContent side="left" aria-label="Mobile navigation">
          <DrawerHeader>
            <DrawerTitle>Job Copilot</DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="px-2 py-2">
            <NavList
              collapsed={false}
              pathname={pathname}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Right column: compact 56px top bar + scrollable content region */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:bg-[var(--surface-muted)] md:hidden"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <h1 className="truncate text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
              {activeRoute.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Search profile selector placeholder / active switcher */}
            <div className="hidden sm:block sm:w-[190px]">
              {searchProfiles.length > 0 ? (
                <Select
                  value={activeProfileId ?? undefined}
                  onValueChange={(val) => setActiveProfileId(val)}
                >
                  <SelectTrigger
                    aria-label="Active search profile"
                    className="h-8 text-[12px]"
                  >
                    <SelectValue placeholder="Select search profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {searchProfiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Link
                  href="/search-profiles"
                  className="inline-flex h-8 w-full items-center justify-between rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-2.5 text-[12px] text-[var(--text-secondary)] hover:border-[var(--control-border)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <span className="truncate">No search profile</span>
                  <span className="font-data text-[11px] text-[var(--accent)]">
                    Set up
                  </span>
                </Link>
              )}
            </div>

            <LiveStatusPill />

            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Open command palette"
              className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Command</span>
              <kbd className="rounded-[3px] border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 font-data text-[11px] leading-none text-[var(--text-tertiary)]">
                {shortcutLabel}
              </kbd>
            </button>
          </div>
        </header>

        <main id="main-content" className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}

/**
 * Persistent Quiet-Workbench shell: left navigation rail, 56px top bar,
 * responsive mobile drawer, command palette, and content-only route transitions.
 */
export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <WorkspaceShellInner>{children}</WorkspaceShellInner>
    </WorkspaceProvider>
  );
}
