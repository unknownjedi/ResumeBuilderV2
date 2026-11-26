"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowRight,
  Briefcase,
  CornerDownLeft,
  Link2,
  PanelLeft,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { PRIMARY_NAV_ITEMS } from "./nav-items";
import { useWorkspace } from "./workspace-context";

interface JobSearchResult {
  id: string;
  title: string;
  company: string;
  location?: string | null;
}

interface PaletteOption {
  id: string;
  group: "Navigate" | "Search profiles" | "Jobs" | "Actions";
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onSelect: () => void;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('[contenteditable="true"], [contenteditable=""]'));
}

/**
 * Accessible Cmd+K / Ctrl+K command palette for navigation, search-profile switching,
 * job lookup, and confirmed local actions.
 */
export function CommandPalette() {
  const router = useRouter();
  const { toast } = useToast();
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    searchProfiles,
    activeProfileId,
    setActiveProfileId,
    toggleSidebar,
  } = useWorkspace();

  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [jobResults, setJobResults] = React.useState<JobSearchResult[]>([]);
  const [jobsLoading, setJobsLoading] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<"create-backup" | null>(null);
  const [runningBackup, setRunningBackup] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement>(null);

  const resetPaletteState = React.useCallback(() => {
    setQuery("");
    setSelectedIndex(0);
    setJobResults([]);
    setJobsLoading(false);
    setPendingAction(null);
  }, []);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      resetPaletteState();
      setCommandPaletteOpen(nextOpen);
    },
    [resetPaletteState, setCommandPaletteOpen]
  );

  // Global Cmd+K / Ctrl+K listener; ignores inputs, textareas, selects, and contenteditable.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (
          isEditableElement(event.target) ||
          isEditableElement(document.activeElement)
        ) {
          return;
        }
        event.preventDefault();
        resetPaletteState();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, resetPaletteState, setCommandPaletteOpen]);

  // Focus input when dialog opens.
  React.useEffect(() => {
    if (!commandPaletteOpen) return;
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [commandPaletteOpen]);

  const trimmedQuery = query.trim();
  const canSearchJobs = commandPaletteOpen && trimmedQuery.length >= 2;

  // Debounced job lookup when query >= 2 chars.
  React.useEffect(() => {
    if (!canSearchJobs) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setJobsLoading(true);
      try {
        const res = await fetch(
          `/api/jobs?q=${encodeURIComponent(trimmedQuery)}&limit=6`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          setJobResults([]);
          return;
        }
        const data: unknown = await res.json();
        const raw = Array.isArray(data)
          ? data
          : data &&
              typeof data === "object" &&
              Array.isArray((data as { items?: unknown }).items)
            ? (data as { items: unknown[] }).items
            : [];

        const parsed: JobSearchResult[] = raw
          .filter(
            (item): item is JobSearchResult =>
              Boolean(
                item &&
                  typeof item === "object" &&
                  typeof (item as { id?: unknown }).id === "string" &&
                  typeof (item as { title?: unknown }).title === "string" &&
                  typeof (item as { company?: unknown }).company === "string"
              )
          )
          .slice(0, 6);
        setJobResults(parsed);
      } catch {
        if (!controller.signal.aborted) {
          setJobResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setJobsLoading(false);
        }
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [canSearchJobs, trimmedQuery]);

  const closeAndRun = React.useCallback(
    (fn: () => void) => {
      handleOpenChange(false);
      fn();
    },
    [handleOpenChange]
  );

  const visibleJobResults = React.useMemo(
    () => (canSearchJobs ? jobResults : []),
    [canSearchJobs, jobResults]
  );

  const options = React.useMemo<PaletteOption[]>(() => {
    const q = trimmedQuery.toLowerCase();
    const list: PaletteOption[] = [];

    for (const item of PRIMARY_NAV_ITEMS) {
      if (
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.shortDescription.toLowerCase().includes(q)
      ) {
        list.push({
          id: `nav-${item.href}`,
          group: "Navigate",
          label: item.label,
          hint: item.shortDescription,
          icon: item.icon,
          onSelect: () => closeAndRun(() => router.push(item.href)),
        });
      }
    }

    for (const profile of searchProfiles) {
      if (!q || profile.name.toLowerCase().includes(q) || "profile".includes(q)) {
        list.push({
          id: `profile-${profile.id}`,
          group: "Search profiles",
          label: `Switch to ${profile.name}`,
          hint: profile.id === activeProfileId ? "Active" : "Search profile",
          icon: SlidersHorizontal,
          onSelect: () =>
            closeAndRun(() => {
              setActiveProfileId(profile.id);
              toast({
                title: "Search profile switched",
                description: profile.name,
                tone: "accent",
              });
            }),
        });
      }
    }

    for (const job of visibleJobResults) {
      list.push({
        id: `job-${job.id}`,
        group: "Jobs",
        label: `${job.title} — ${job.company}`,
        hint: job.location ?? "Inspect job",
        icon: Briefcase,
        onSelect: () =>
          closeAndRun(() =>
            router.push(`/discover?job=${encodeURIComponent(job.id)}`)
          ),
      });
    }

    const localActions: PaletteOption[] = [
      {
        id: "action-add-job-url",
        group: "Actions",
        label: "Add job URL",
        hint: "Import a posting in Discover jobs",
        icon: Link2,
        onSelect: () =>
          closeAndRun(() => router.push("/discover?action=add-url")),
      },
      {
        id: "action-create-backup",
        group: "Actions",
        label: "Create backup",
        hint: "Requires confirmation",
        icon: Archive,
        onSelect: () => setPendingAction("create-backup"),
      },
      {
        id: "action-toggle-rail",
        group: "Actions",
        label: "Toggle navigation rail",
        hint: "Expand or collapse left sidebar",
        icon: PanelLeft,
        onSelect: () => closeAndRun(() => toggleSidebar()),
      },
    ];

    for (const action of localActions) {
      if (
        !q ||
        action.label.toLowerCase().includes(q) ||
        (action.hint?.toLowerCase().includes(q) ?? false)
      ) {
        list.push(action);
      }
    }

    return list;
  }, [
    activeProfileId,
    closeAndRun,
    router,
    searchProfiles,
    setActiveProfileId,
    toast,
    toggleSidebar,
    trimmedQuery,
    visibleJobResults,
  ]);

  const clampedIndex =
    options.length === 0 ? 0 : Math.min(selectedIndex, options.length - 1);

  const handleConfirmBackup = async () => {
    setRunningBackup(true);
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      if (!response.ok) {
        throw new Error(`Request returned ${response.status}`);
      }
      toast({
        title: "Backup queued",
        description: "Local archive creation has been scheduled.",
        tone: "accent",
      });
      handleOpenChange(false);
    } catch {
      toast({
        title: "Backup endpoint unavailable",
        description: "Open Settings once backup services are configured.",
        tone: "warning",
      });
      setPendingAction(null);
    } finally {
      setRunningBackup(false);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (pendingAction) {
      if (event.key === "Escape") {
        event.preventDefault();
        setPendingAction(null);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (options.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % options.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + options.length) % options.length);
      }
    } else if (event.key === "Enter") {
      const active = options[clampedIndex];
      if (active) {
        event.preventDefault();
        active.onSelect();
      }
    }
  };

  // Group options for clear section headers while keeping flat keyboard index.
  const grouped = React.useMemo(() => {
    const groups: Array<{
      name: PaletteOption["group"];
      items: Array<{ option: PaletteOption; index: number }>;
    }> = [];
    const byName = new Map<
      PaletteOption["group"],
      Array<{ option: PaletteOption; index: number }>
    >();

    options.forEach((option, index) => {
      const existing = byName.get(option.group);
      if (existing) {
        existing.push({ option, index });
      } else {
        const entry = [{ option, index }];
        byName.set(option.group, entry);
        groups.push({ name: option.group, items: entry });
      }
    });
    return groups;
  }, [options]);

  const activeOptionId = options[clampedIndex]?.id;

  return (
    <Dialog open={commandPaletteOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label="Command palette"
        className="max-w-[560px] gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Navigate to views, switch search profiles, search jobs, or run local actions.
        </DialogDescription>

        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-3.5 py-2.5">
          <Search
            className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              const nextVal = e.target.value;
              setQuery(nextVal);
              setSelectedIndex(0);
              setPendingAction(null);
              if (nextVal.trim().length < 2) {
                setJobResults([]);
                setJobsLoading(false);
              }
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Jump to view, switch profile, search jobs, or run action..."
            aria-label="Command search"
            aria-controls="command-palette-listbox"
            aria-activedescendant={
              activeOptionId ? `palette-opt-${activeOptionId}` : undefined
            }
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            className="h-8 w-full bg-transparent text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          />
          <kbd className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-muted)] px-1.5 py-0.5 font-data text-[11px] text-[var(--text-secondary)]">
            Esc
          </kbd>
        </div>

        {pendingAction === "create-backup" ? (
          <div className="p-4">
            <p className="text-[14px] font-medium text-[var(--text-primary)]">
              Create local backup archive?
            </p>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              This snapshots the SQLite database, original documents, and exported files into your local backups folder.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPendingAction(null)}
                disabled={runningBackup}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={runningBackup}
                onClick={handleConfirmBackup}
              >
                Confirm backup
              </Button>
            </div>
          </div>
        ) : (
          <div
            id="command-palette-listbox"
            role="listbox"
            aria-label="Command palette results"
            className="max-h-[360px] overflow-y-auto py-2"
          >
            {options.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]">
                {jobsLoading ? "Searching jobs..." : "No matching commands or jobs."}
              </div>
            ) : (
              grouped.map((group) => (
                <div key={group.name} className="mb-1.5 last:mb-0">
                  <div className="px-3.5 py-1 text-[11px] font-medium tracking-wide text-[var(--text-tertiary)] uppercase">
                    {group.name}
                  </div>
                  {group.items.map(({ option, index }) => {
                    const Icon = option.icon;
                    const isSelected = index === clampedIndex;
                    return (
                      <button
                        key={option.id}
                        id={`palette-opt-${option.id}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={option.onSelect}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left transition-colors duration-100",
                          isSelected
                            ? "bg-[var(--accent-soft)] text-[var(--text-primary)]"
                            : "text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Icon
                            className={cn(
                              "h-4 w-4 shrink-0",
                              isSelected
                                ? "text-[var(--accent)]"
                                : "text-[var(--text-secondary)]"
                            )}
                            aria-hidden={true}
                          />
                          <span className="truncate text-[13px] font-medium">
                            {option.label}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {option.hint ? (
                            <span className="hidden max-w-[200px] truncate text-[12px] text-[var(--text-tertiary)] sm:inline">
                              {option.hint}
                            </span>
                          ) : null}
                          {isSelected ? (
                            <ArrowRight
                              className="h-3.5 w-3.5 text-[var(--accent)]"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-[11px] text-[var(--text-tertiary)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded-[3px] border border-[var(--border)] bg-[var(--surface-raised)] px-1 font-data">
                ↑↓
              </kbd>
              Navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="inline-flex items-center rounded-[3px] border border-[var(--border)] bg-[var(--surface-raised)] px-1 font-data">
                <CornerDownLeft className="h-2.5 w-2.5" aria-hidden="true" />
              </kbd>
              Select
            </span>
          </div>
          <span>Local workspace</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
