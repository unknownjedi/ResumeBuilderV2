"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  GitMerge,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useSse } from "@/components/shell/sse-provider";
import { useWorkspace } from "@/components/shell/workspace-context";
import { listSources } from "@/features/job-sources/api";
import {
  getJobDetail,
  listJobs,
  updateJobDiscoveryState,
} from "./api";
import { DuplicateReviewDialog } from "./duplicate-review-dialog";
import { JobDetailView } from "./job-detail-view";
import { ManualImportDialog } from "./manual-import-dialog";
import {
  computeFreshness,
  formatSalaryRange,
  formatShortDate,
  formatWorkplaceLabel,
  type JobDetailItem,
  type JobListItem,
  type JobSortOption,
  type JobUserStateFilter,
  type PostedDateFilter,
  type SourceFilterOption,
  type UserJobDiscoveryState,
  type WorkplaceType,
} from "./types";

export interface DiscoverWorkbenchProps {
  initialJobId?: string | null;
  initialOpenImport?: boolean;
}

const DESKTOP_DRAWER_QUERY = "(min-width: 1280px)";

function subscribeDesktopDrawer(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(DESKTOP_DRAWER_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getDesktopDrawerSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia(DESKTOP_DRAWER_QUERY).matches;
}

function useIsDesktopDrawer(): boolean {
  return React.useSyncExternalStore(
    subscribeDesktopDrawer,
    getDesktopDrawerSnapshot,
    () => true
  );
}

function getRowSalaryDisplay(job: JobListItem): string {
  const disclosed = formatSalaryRange(
    job.salaryMin,
    job.salaryMax,
    job.salaryCurrency,
    job.salaryPeriod
  );
  if (disclosed) return disclosed;

  if (job.compensationOverride) {
    const override = formatSalaryRange(
      job.compensationOverride.minAmount,
      job.compensationOverride.maxAmount,
      job.compensationOverride.currency,
      job.compensationOverride.period
    );
    if (override) return `${override} (user)`;
  }

  return "Salary unknown";
}

/**
 * Primary job discovery ledger with facet filters, keyboard row navigation,
 * optimistic Save/Dismiss with Undo, duplicate review, manual import, and
 * 1280px+ right-side detail drawer.
 */
export function DiscoverWorkbench({
  initialJobId = null,
  initialOpenImport = false,
}: DiscoverWorkbenchProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { subscribe } = useSse();
  const { activeProfileId } = useWorkspace();
  const shouldReduceMotion = useReducedMotion();
  const isDesktopDrawer = useIsDesktopDrawer();

  // Filter & sort state
  const [searchInput, setSearchInput] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [stateFilter, setStateFilter] =
    React.useState<JobUserStateFilter>("active");
  const [sourceFilter, setSourceFilter] = React.useState<string>("all");
  const [workplaceFilter, setWorkplaceFilter] = React.useState<
    WorkplaceType | "all"
  >("all");
  const [postedDateFilter, setPostedDateFilter] =
    React.useState<PostedDateFilter>("any");
  const [sortOption, setSortOption] =
    React.useState<JobSortOption>("recommended");

  // Data state
  const [jobs, setJobs] = React.useState<JobListItem[]>([]);
  const [totalJobs, setTotalJobs] = React.useState(0);
  const [pendingDuplicateCount, setPendingDuplicateCount] = React.useState(0);
  const [sourceOptions, setSourceOptions] = React.useState<SourceFilterOption[]>(
    []
  );
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Dialogs
  const [importDialogOpen, setImportDialogOpen] = React.useState(
    Boolean(initialOpenImport)
  );
  const [duplicateDialogOpen, setDuplicateDialogOpen] = React.useState(false);

  // Right-side drawer state (desktop >= 1280px)
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [drawerJob, setDrawerJob] = React.useState<JobDetailItem | null>(null);
  const [drawerLoading, setDrawerLoading] = React.useState(false);
  const [drawerError, setDrawerError] = React.useState<string | null>(null);
  const [pendingStateIds, setPendingStateIds] = React.useState<
    Record<string, boolean>
  >({});

  // Keyboard & focus restoration refs
  const rowButtonRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());
  const invokingRowIdRef = React.useRef<string | null>(null);
  const selectedJobIdRef = React.useRef<string | null>(selectedJobId);
  const drawerOpenRef = React.useRef<boolean>(drawerOpen);

  React.useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen, selectedJobId]);

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, 220);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Load source options for the source facet filter
  React.useEffect(() => {
    let active = true;
    listSources()
      .then((sources) => {
        if (!active) return;
        setSourceOptions(
          sources.map((s) => ({
            id: s.id,
            displayName: s.displayName,
            sourceType: s.sourceType,
          }))
        );
      })
      .catch(() => {
        // Non-fatal: /api/jobs may also supply sources
      });
    return () => {
      active = false;
    };
  }, []);

  const fetchJobs = React.useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        const res = await listJobs({
          q: debouncedQuery || undefined,
          state: stateFilter,
          sourceId: sourceFilter,
          workplaceType: workplaceFilter,
          postedDate: postedDateFilter,
          sort: sortOption,
          searchProfileId: activeProfileId,
          limit: 100,
        });
        setJobs(res.items);
        setTotalJobs(res.total);
        setPendingDuplicateCount(res.pendingDuplicateCount);
        if (res.sources.length > 0) {
          setSourceOptions(res.sources);
        }
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Could not load jobs."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      activeProfileId,
      debouncedQuery,
      postedDateFilter,
      sortOption,
      sourceFilter,
      stateFilter,
      workplaceFilter,
    ]
  );

  React.useEffect(() => {
    let active = true;
    listJobs({
      q: debouncedQuery || undefined,
      state: stateFilter,
      sourceId: sourceFilter,
      workplaceType: workplaceFilter,
      postedDate: postedDateFilter,
      sort: sortOption,
      searchProfileId: activeProfileId,
      limit: 100,
    })
      .then((res) => {
        if (!active) return;
        setJobs(res.items);
        setTotalJobs(res.total);
        setPendingDuplicateCount(res.pendingDuplicateCount);
        if (res.sources.length > 0) {
          setSourceOptions(res.sources);
        }
        setLoadError(null);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(
          err instanceof Error ? err.message : "Could not load jobs."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    activeProfileId,
    debouncedQuery,
    postedDateFilter,
    sortOption,
    sourceFilter,
    stateFilter,
    workplaceFilter,
  ]);

  const loadDrawerJob = React.useCallback(
    async (jobId: string, quiet = false) => {
      if (!quiet) {
        setDrawerLoading(true);
        setDrawerError(null);
      }
      try {
        const detail = await getJobDetail(jobId, activeProfileId);
        if (selectedJobIdRef.current === jobId) {
          setDrawerJob(detail);
          setDrawerError(null);
        }
      } catch (err) {
        if (selectedJobIdRef.current === jobId && !quiet) {
          setDrawerError(
            err instanceof Error ? err.message : "Could not load job details."
          );
        }
      } finally {
        if (selectedJobIdRef.current === jobId) {
          setDrawerLoading(false);
        }
      }
    },
    [activeProfileId]
  );

  const openJobInspection = React.useCallback(
    (jobId: string, triggerElement?: HTMLButtonElement | null) => {
      if (!isDesktopDrawer) {
        router.push(`/jobs/${encodeURIComponent(jobId)}`);
        return;
      }

      invokingRowIdRef.current = jobId;
      if (triggerElement) {
        rowButtonRefs.current.set(jobId, triggerElement);
      }
      setSelectedJobId(jobId);
      selectedJobIdRef.current = jobId;
      setDrawerJob((prev) => (prev?.id === jobId ? prev : null));
      setDrawerOpen(true);
      void loadDrawerJob(jobId);
    },
    [isDesktopDrawer, loadDrawerJob, router]
  );

  // Handle ?job= query param passed from Command Palette or deep links.
  const handledInitialJobRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!initialJobId || handledInitialJobRef.current === initialJobId) {
      return;
    }
    handledInitialJobRef.current = initialJobId;

    if (!isDesktopDrawer) {
      router.replace(`/jobs/${encodeURIComponent(initialJobId)}`);
      return;
    }

    Promise.resolve().then(() => {
      setSelectedJobId(initialJobId);
      selectedJobIdRef.current = initialJobId;
      setDrawerOpen(true);
      void loadDrawerJob(initialJobId);
    });
  }, [initialJobId, isDesktopDrawer, loadDrawerJob, router]);

  // Subscribe to SSE for `source` and `job` resource updates without resetting scroll/filters.
  React.useEffect(() => {
    return subscribe((msg) => {
      if (msg.kind === "reset" || msg.kind === "poll") {
        void fetchJobs(true);
        if (drawerOpenRef.current && selectedJobIdRef.current) {
          void loadDrawerJob(selectedJobIdRef.current, true);
        }
        return;
      }

      const ev = msg.event;
      const isRelevantResource =
        ev.resourceType === "job" ||
        ev.resourceType === "source" ||
        ev.taskType.includes("source") ||
        ev.taskType.includes("job");

      if (!isRelevantResource) return;

      if (
        ev.eventType === "resource.updated" ||
        ev.eventType === "task.succeeded"
      ) {
        void fetchJobs(true);
        if (
          drawerOpenRef.current &&
          selectedJobIdRef.current &&
          (ev.resourceType === "job"
            ? !ev.resourceId || ev.resourceId === selectedJobIdRef.current
            : true)
        ) {
          void loadDrawerJob(selectedJobIdRef.current, true);
        }
      }
    });
  }, [fetchJobs, loadDrawerJob, subscribe]);

  const handleChangeJobState = React.useCallback(
    async (
      jobId: string,
      nextState: UserJobDiscoveryState | "active",
      options?: { isUndo?: boolean }
    ) => {
      const existing = jobs.find((j) => j.id === jobId) ?? null;
      const prevUserState: UserJobDiscoveryState | null =
        existing?.userState ??
        (drawerJob?.id === jobId ? drawerJob.userState : null);
      const nextNormalized: UserJobDiscoveryState | null =
        nextState === "active" ? null : nextState;

      // Snapshot list for instant rollback if persistence fails
      const previousJobs = jobs;
      const previousDrawerJob = drawerJob;

      // 1) Optimistic update
      setPendingStateIds((prev) => ({ ...prev, [jobId]: true }));

      setJobs((prev) => {
        const updated = prev.map((item) =>
          item.id === jobId ? { ...item, userState: nextNormalized } : item
        );
        if (stateFilter === "active" && nextNormalized === "dismissed") {
          return updated.filter((item) => item.id !== jobId);
        }
        if (stateFilter === "saved" && nextNormalized !== "saved") {
          return updated.filter((item) => item.id !== jobId);
        }
        if (stateFilter === "dismissed" && nextNormalized !== "dismissed") {
          return updated.filter((item) => item.id !== jobId);
        }
        return updated;
      });

      if (drawerJob?.id === jobId) {
        setDrawerJob((prev) =>
          prev ? { ...prev, userState: nextNormalized } : prev
        );
      }

      if (nextNormalized === "dismissed" && !options?.isUndo) {
        if (drawerOpen && selectedJobId === jobId) {
          setDrawerOpen(false);
        }
        toast({
          title: "Job dismissed",
          description: existing?.title ?? "Removed from active discovery list.",
          tone: "neutral",
          actionLabel: "Undo",
          onAction: () => {
            void updateJobDiscoveryState(jobId, prevUserState ?? "active", {
              searchProfileId: activeProfileId,
            })
              .then(() => {
                void fetchJobs(true);
                toast({
                  title: "Dismissal undone",
                  description: existing?.title,
                  tone: "accent",
                });
              })
              .catch((err) => {
                toast({
                  title: "Could not undo dismissal",
                  description:
                    err instanceof Error ? err.message : "Request failed.",
                  tone: "danger",
                });
              });
          },
        });
      } else if (nextNormalized === "saved" && !options?.isUndo) {
        toast({
          title: "Job saved",
          description: existing?.title,
          tone: "accent",
        });
      }

      // 2) Persist immediately and roll back on error
      try {
        await updateJobDiscoveryState(jobId, nextState, {
          searchProfileId: activeProfileId,
        });
        if (options?.isUndo) {
          void fetchJobs(true);
        }
      } catch (err) {
        setJobs(previousJobs);
        if (previousDrawerJob?.id === jobId) {
          setDrawerJob(previousDrawerJob);
        }
        toast({
          title: "Could not update job state",
          description:
            err instanceof Error ? err.message : "State change failed; reverted.",
          tone: "danger",
        });
      } finally {
        setPendingStateIds((prev) => {
          const copy = { ...prev };
          delete copy[jobId];
          return copy;
        });
      }
    },
    [
      activeProfileId,
      drawerJob,
      drawerOpen,
      fetchJobs,
      jobs,
      selectedJobId,
      stateFilter,
      toast,
    ]
  );

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextJob = jobs[index + 1];
      if (nextJob) {
        rowButtonRefs.current.get(nextJob.id)?.focus();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prevJob = jobs[index - 1];
      if (prevJob) {
        rowButtonRefs.current.get(prevJob.id)?.focus();
      }
    }
  };

  const handleDrawerOpenChange = (nextOpen: boolean) => {
    setDrawerOpen(nextOpen);
    if (!nextOpen) {
      const targetId = invokingRowIdRef.current ?? selectedJobId;
      if (targetId) {
        requestAnimationFrame(() => {
          rowButtonRefs.current.get(targetId)?.focus();
        });
      }
    }
  };

  const handleImportedJob = (
    importedJob: JobDetailItem,
    duplicateCandidates: Array<{ id: string }>
  ) => {
    toast({
      title: "Job imported",
      description:
        duplicateCandidates.length > 0
          ? `${importedJob.title} added with ${duplicateCandidates.length} duplicate suggestion(s) to review.`
          : `${importedJob.title} — ${importedJob.companyName}`,
      tone: duplicateCandidates.length > 0 ? "warning" : "accent",
    });
    void fetchJobs(true);
    if (isDesktopDrawer) {
      setSelectedJobId(importedJob.id);
      selectedJobIdRef.current = importedJob.id;
      setDrawerJob(importedJob);
      setDrawerOpen(true);
    } else {
      router.push(`/jobs/${encodeURIComponent(importedJob.id)}`);
    }
  };

  const hasActiveFilters =
    Boolean(debouncedQuery) ||
    sourceFilter !== "all" ||
    workplaceFilter !== "all" ||
    postedDateFilter !== "any";

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Discover jobs
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Review normalized postings from configured sources and manual imports. Missing posted dates and salaries remain explicitly unknown.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDuplicateDialogOpen(true)}
          >
            <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Review duplicates</span>
            {pendingDuplicateCount > 0 ? (
              <Badge tone="warning" className="ml-0.5 font-data">
                {pendingDuplicateCount}
              </Badge>
            ) : null}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setImportDialogOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Import job
          </Button>
        </div>
      </div>

      {/* State tabs & filter bar */}
      <div className="space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <Tabs
            value={stateFilter}
            onValueChange={(val) => setStateFilter(val as JobUserStateFilter)}
            indicatorId="discover-state-tabs"
          >
            <TabsList aria-label="Discovery state filter">
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="saved">Saved</TabsTrigger>
              <TabsTrigger value="dismissed">Dismissed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-1 items-center gap-2 lg:max-w-md">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--text-tertiary)]"
                aria-hidden="true"
              />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search title, company, location, or skills..."
                aria-label="Search jobs"
                className="pr-8 pl-9"
              />
              {searchInput ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchInput("")}
                  className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--text-tertiary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Refresh job list"
              onClick={() => void fetchJobs(false)}
            >
              <RefreshCw
                className={cn("h-4 w-4", loading && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>

        {/* Facet filters & sort */}
        <div className="grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label
              htmlFor="filter-source"
              className="block text-[11px] font-medium text-[var(--text-tertiary)] uppercase"
            >
              Source
            </label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger id="filter-source" className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sourceOptions.map((src) => (
                  <SelectItem key={src.id} value={src.id}>
                    {src.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="filter-workplace"
              className="block text-[11px] font-medium text-[var(--text-tertiary)] uppercase"
            >
              Workplace
            </label>
            <Select
              value={workplaceFilter}
              onValueChange={(val) =>
                setWorkplaceFilter(val as WorkplaceType | "all")
              }
            >
              <SelectTrigger id="filter-workplace" className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workplace types</SelectItem>
                <SelectItem value="remote">Remote</SelectItem>
                <SelectItem value="hybrid">Hybrid</SelectItem>
                <SelectItem value="onsite">Onsite</SelectItem>
                <SelectItem value="unspecified">Unspecified</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="filter-posted"
              className="block text-[11px] font-medium text-[var(--text-tertiary)] uppercase"
            >
              Posted date
            </label>
            <Select
              value={postedDateFilter}
              onValueChange={(val) =>
                setPostedDateFilter(val as PostedDateFilter)
              }
            >
              <SelectTrigger id="filter-posted" className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any date</SelectItem>
                <SelectItem value="24h">Posted in last 24h</SelectItem>
                <SelectItem value="3d">Posted in last 3 days</SelectItem>
                <SelectItem value="7d">Posted in last 7 days</SelectItem>
                <SelectItem value="30d">Posted in last 30 days</SelectItem>
                <SelectItem value="known_only">Posted date known only</SelectItem>
                <SelectItem value="unknown_only">Posting date unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="sort-jobs"
              className="block text-[11px] font-medium text-[var(--text-tertiary)] uppercase"
            >
              Sort by
            </label>
            <Select
              value={sortOption}
              onValueChange={(val) => setSortOption(val as JobSortOption)}
            >
              <SelectTrigger id="sort-jobs" className="h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recommended">Recommended</SelectItem>
                <SelectItem value="documented_fit">Documented fit</SelectItem>
                <SelectItem value="employer_posted_at">
                  Employer posted (when known)
                </SelectItem>
                <SelectItem value="first_seen_at">First discovered</SelectItem>
                <SelectItem value="company_title">Company / Title</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Results meta bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--text-secondary)]">
        <span className="font-data">
          Showing {jobs.length} of {totalJobs} job{totalJobs === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-3">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                setDebouncedQuery("");
                setSourceFilter("all");
                setWorkplaceFilter("all");
                setPostedDateFilter("any");
              }}
              className="font-medium text-[var(--accent)] hover:underline"
            >
              Reset filters
            </button>
          ) : null}
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Manage sources</span>
          </Link>
        </div>
      </div>

      {/* Job ledger list */}
      {loading ? (
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
          <div className="p-3.5">
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="p-3.5">
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="p-3.5">
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-[8px] border border-[#E4B8B4] bg-[#F8EAE8] px-4 py-3 text-[13px]"
        >
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-[var(--danger)]"
              aria-hidden="true"
            />
            <span>{loadError}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void fetchJobs(false)}>
            Retry
          </Button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
          <p className="text-[14px] font-medium text-[var(--text-primary)]">
            {hasActiveFilters
              ? "No jobs match the current filters"
              : stateFilter === "saved"
                ? "No saved jobs yet"
                : stateFilter === "dismissed"
                  ? "No dismissed jobs"
                  : "No job postings imported or fetched yet"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
            {hasActiveFilters
              ? "Adjust your search query or facet filters to see more postings."
              : "Import a job URL/description manually or configure a Greenhouse, Lever, Ashby, or Career Page source in Settings."}
          </p>
          {!hasActiveFilters && stateFilter === "active" ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Import job
              </Button>
              <Link
                href="/settings"
                className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
              >
                Configure sources
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          role="list"
          aria-label="Discovered job postings"
          className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]"
        >
          <AnimatePresence initial={false}>
            {jobs.map((job, index) => {
              const isSelected = drawerOpen && selectedJobId === job.id;
              const isSaved = job.userState === "saved";
              const isDismissed =
                job.userState === "dismissed" || job.userState === "hidden";
              const isBusy = Boolean(pendingStateIds[job.id]);
              const freshness = computeFreshness(job.employerPostedAt);
              const salaryText = getRowSalaryDisplay(job);

              return (
                <motion.div
                  key={job.id}
                  role="listitem"
                  layout={!shouldReduceMotion}
                  initial={shouldReduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, height: 0, overflow: "hidden" }
                  }
                  transition={{
                    duration: shouldReduceMotion ? 0.06 : 0.16,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={cn(
                    "group flex min-h-[54px] items-center justify-between gap-3 px-3.5 py-2.5 transition-colors duration-100",
                    isSelected
                      ? "bg-[var(--surface-muted)]"
                      : "hover:bg-[var(--surface-raised)]"
                  )}
                >
                  {/* Primary clickable/keyboard-navigable row button */}
                  <button
                    ref={(el) => {
                      if (el) {
                        rowButtonRefs.current.set(job.id, el);
                      } else {
                        rowButtonRefs.current.delete(job.id);
                      }
                    }}
                    type="button"
                    onClick={(e) => openJobInspection(job.id, e.currentTarget)}
                    onKeyDown={(e) => handleRowKeyDown(e, index)}
                    className="min-w-0 flex-1 rounded-[4px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
                        {job.title}
                      </span>
                      <span className="text-[13px] font-medium text-[var(--text-secondary)]">
                        {job.companyName}
                      </span>
                      {job.hasDuplicateCandidates ? (
                        <Badge tone="warning">Needs duplicate review</Badge>
                      ) : null}
                      {job.status === "possibly_closed" ? (
                        <Badge tone="warning">Possibly closed</Badge>
                      ) : job.status === "closed" ? (
                        <Badge tone="danger">Closed</Badge>
                      ) : null}
                      {isSaved && stateFilter !== "saved" ? (
                        <Badge tone="accent">Saved</Badge>
                      ) : null}
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--text-secondary)]">
                      <span>{job.locationText || "Location unknown"}</span>
                      <span>{formatWorkplaceLabel(job.workplaceType)}</span>
                      <span className="font-data text-[var(--text-tertiary)]">
                        {salaryText}
                      </span>
                      <span className="font-data text-[var(--text-tertiary)]">
                        {job.employerPostedAt
                          ? `Posted ${formatShortDate(job.employerPostedAt)} (${freshness.label})`
                          : `Discovered ${formatShortDate(job.firstSeenAt)} (Date unknown)`}
                      </span>
                      {job.primarySourceName ? (
                        <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                          {job.primarySourceName}
                        </span>
                      ) : null}
                    </div>
                  </button>

                  {/* Right metadata & quick optimistic actions */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {typeof job.documentedFitScore === "number" ? (
                      <span
                        title="Documented-fit score"
                        className="mr-1 rounded-[4px] border border-[var(--border)] bg-[var(--canvas)] px-2 py-0.5 font-data text-[12px] font-medium text-[var(--text-primary)]"
                      >
                        {Math.round(job.documentedFitScore)}%
                      </span>
                    ) : null}

                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={isBusy}
                      aria-label={isSaved ? `Unsave ${job.title}` : `Save ${job.title}`}
                      aria-pressed={isSaved}
                      title={isSaved ? "Remove from Saved" : "Save job"}
                      onClick={() =>
                        void handleChangeJobState(
                          job.id,
                          isSaved ? "active" : "saved"
                        )
                      }
                    >
                      {isSaved ? (
                        <BookmarkCheck
                          className="h-4 w-4 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                      ) : (
                        <Bookmark
                          className="h-4 w-4 text-[var(--text-secondary)]"
                          aria-hidden="true"
                        />
                      )}
                    </Button>

                    {isDismissed ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        aria-label={`Reopen ${job.title}`}
                        onClick={() => void handleChangeJobState(job.id, "active")}
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Reopen</span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isBusy}
                        aria-label={`Dismiss ${job.title}`}
                        title="Dismiss job"
                        onClick={() =>
                          void handleChangeJobState(job.id, "dismissed")
                        }
                      >
                        <XCircle
                          className="h-4 w-4 text-[var(--text-secondary)]"
                          aria-hidden="true"
                        />
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Desktop >=1280px right-side detail drawer */}
      <Drawer open={drawerOpen && isDesktopDrawer} onOpenChange={handleDrawerOpenChange}>
        <DrawerContent
          side="right"
          className="max-w-[490px]"
          onCloseAutoFocus={(e) => {
            const targetId = invokingRowIdRef.current ?? selectedJobId;
            if (targetId) {
              const targetEl = rowButtonRefs.current.get(targetId);
              if (targetEl) {
                e.preventDefault();
                targetEl.focus();
              }
            }
          }}
        >
          <DrawerHeader>
            <DrawerTitle>
              {drawerJob?.title ?? "Job posting detail"}
            </DrawerTitle>
            <DrawerDescription>
              {drawerJob
                ? `${drawerJob.companyName} · ${drawerJob.locationText || "Location unknown"}`
                : "Inspect source lineage, freshness provenance, and full job description."}
            </DrawerDescription>
          </DrawerHeader>

          <DrawerBody>
            {drawerLoading && !drawerJob ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : drawerError ? (
              <div
                role="alert"
                className="space-y-3 rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] p-4 text-[13px]"
              >
                <p className="text-[var(--danger)]">{drawerError}</p>
                {selectedJobId ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadDrawerJob(selectedJobId)}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : drawerJob ? (
              <JobDetailView
                job={drawerJob}
                variant="drawer"
                pendingAction={Boolean(pendingStateIds[drawerJob.id])}
                onChangeState={(nextState) =>
                  void handleChangeJobState(drawerJob.id, nextState)
                }
                onReviewDuplicates={() => setDuplicateDialogOpen(true)}
              />
            ) : null}
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Manual Import Dialog */}
      <ManualImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImported={handleImportedJob}
      />

      {/* Duplicate Review Dialog */}
      <DuplicateReviewDialog
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        onResolved={() => {
          void fetchJobs(true);
          if (drawerOpen && selectedJobId) {
            void loadDrawerJob(selectedJobId, true);
          }
        }}
      />
    </div>
  );
}
