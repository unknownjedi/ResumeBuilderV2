"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  FlaskConical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useSse } from "@/components/shell/sse-provider";
import {
  createSource,
  deleteSource,
  getTaskProgress,
  listSourceRuns,
  listSources,
  runSourceScan,
  testSource,
  updateSource,
} from "./api";
import {
  SOURCE_TYPE_META,
  getMinIntervalMinutes,
  getSourceTypeLabel,
  type ConnectorSourceType,
  type JobSourceItem,
  type SourceFormInput,
  type SourceHealthState,
  type SourceRunItem,
  type SourceRunOutcome,
  type SourceTaskProgress,
  type SourceTestResult,
} from "./types";

const INTERVAL_PRESETS = [
  { label: "Every 1 hour (60 min)", value: 60 },
  { label: "Every 3 hours (180 min)", value: 180 },
  { label: "Every 6 hours (360 min — ATS default)", value: 360 },
  { label: "Every 12 hours (720 min — Career page default)", value: 720 },
  { label: "Every 24 hours (1440 min)", value: 1440 },
];

function healthTone(health: SourceHealthState, enabled: boolean): BadgeTone {
  if (!enabled || health === "paused") return "neutral";
  switch (health) {
    case "healthy":
      return "accent";
    case "degraded":
      return "warning";
    case "failing":
      return "danger";
    default:
      return "neutral";
  }
}

function healthLabel(health: SourceHealthState, enabled: boolean): string {
  if (!enabled) return "Paused";
  switch (health) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "failing":
      return "Failing";
    case "paused":
      return "Paused";
    case "untested":
      return "Untested";
  }
}

function runOutcomeTone(outcome: SourceRunOutcome): BadgeTone {
  switch (outcome) {
    case "succeeded":
    case "skipped_not_modified":
      return "accent";
    case "partial":
      return "warning";
    case "failed":
      return "danger";
    case "running":
      return "neutral";
  }
}

function formatShortTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatIntervalLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours}h (${minutes}m)`;
  }
  return `${minutes}m`;
}

function createEmptyForm(type: ConnectorSourceType = "greenhouse"): SourceFormInput {
  return {
    sourceType: type,
    displayName: "",
    sourceIdentifier: "",
    baseUrl: "",
    refreshIntervalMinutes: SOURCE_TYPE_META[type].defaultIntervalMinutes,
    enabled: false,
  };
}

function sourceToForm(source: JobSourceItem): SourceFormInput {
  const sourceType: ConnectorSourceType =
    source.sourceType === "greenhouse" ||
    source.sourceType === "lever" ||
    source.sourceType === "ashby" ||
    source.sourceType === "generic_career_page"
      ? source.sourceType
      : "generic_career_page";
  return {
    sourceType,
    displayName: source.displayName,
    sourceIdentifier: source.sourceIdentifier ?? "",
    baseUrl: source.baseUrl ?? "",
    refreshIntervalMinutes: source.refreshIntervalMinutes,
    enabled: source.enabled,
  };
}

/**
 * Controlled job sources registry manager rendered in Settings -> Job Sources.
 * Supports Greenhouse, Lever, Ashby, and structured Generic Career Pages,
 * plus test-before-enable, manual scans with live SSE progress, and run history.
 */
export function SourcesManager() {
  const { toast } = useToast();
  const { subscribe } = useSse();

  const [sources, setSources] = React.useState<JobSourceItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Add/Edit dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingSource, setEditingSource] = React.useState<JobSourceItem | null>(null);
  const [form, setForm] = React.useState<SourceFormInput>(() => createEmptyForm());
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submittingForm, setSubmittingForm] = React.useState(false);

  // Per-source interactive state
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testResults, setTestResults] = React.useState<Record<string, SourceTestResult>>(
    {}
  );
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [queueingRunId, setQueueingRunId] = React.useState<string | null>(null);

  // Active SSE task progress keyed by sourceId
  const [activeTasks, setActiveTasks] = React.useState<
    Record<string, SourceTaskProgress>
  >({});

  // Expandable source_runs history
  const [expandedRuns, setExpandedRuns] = React.useState<Record<string, boolean>>({});
  const [runsBySource, setRunsBySource] = React.useState<
    Record<string, SourceRunItem[]>
  >({});
  const [runsLoading, setRunsLoading] = React.useState<Record<string, boolean>>({});
  const [runsError, setRunsError] = React.useState<Record<string, string | null>>({});

  const expandedRunsRef = React.useRef(expandedRuns);
  const activeTasksRef = React.useRef(activeTasks);

  React.useEffect(() => {
    expandedRunsRef.current = expandedRuns;
    activeTasksRef.current = activeTasks;
  }, [activeTasks, expandedRuns]);

  const refreshSources = React.useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const list = await listSources();
      setSources(list);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load job sources."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRunsForSource = React.useCallback(async (sourceId: string) => {
    setRunsLoading((prev) => ({ ...prev, [sourceId]: true }));
    setRunsError((prev) => ({ ...prev, [sourceId]: null }));
    try {
      const runs = await listSourceRuns(sourceId);
      setRunsBySource((prev) => ({ ...prev, [sourceId]: runs }));
    } catch (error) {
      setRunsError((prev) => ({
        ...prev,
        [sourceId]:
          error instanceof Error ? error.message : "Could not load run history.",
      }));
    } finally {
      setRunsLoading((prev) => ({ ...prev, [sourceId]: false }));
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    listSources()
      .then((list) => {
        if (!active) return;
        setSources(list);
        setLoadError(null);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : "Could not load job sources."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Subscribe to SSE for live source scan progress, completion, and reset/poll recovery.
  React.useEffect(() => {
    const syncExpandedRuns = () => {
      for (const [sourceId, open] of Object.entries(expandedRunsRef.current)) {
        if (open) {
          void loadRunsForSource(sourceId);
        }
      }
    };

    const recoverTrackedTasks = () => {
      for (const [sourceId, tracked] of Object.entries(activeTasksRef.current)) {
        if (tracked.status === "queued" || tracked.status === "running") {
          void getTaskProgress(tracked.taskId, sourceId).then((latest) => {
            if (!latest) return;
            setActiveTasks((prev) => ({ ...prev, [sourceId]: latest }));
            if (
              latest.status === "succeeded" ||
              latest.status === "failed" ||
              latest.status === "cancelled"
            ) {
              void refreshSources(true);
              if (expandedRunsRef.current[sourceId]) {
                void loadRunsForSource(sourceId);
              }
            }
          });
        }
      }
    };

    return subscribe((msg) => {
      if (msg.kind === "reset" || msg.kind === "poll") {
        void refreshSources(true);
        syncExpandedRuns();
        recoverTrackedTasks();
        return;
      }

      const ev = msg.event;
      const isSourceEvent =
        ev.resourceType === "source" || ev.taskType.includes("source");
      if (!isSourceEvent) return;

      // Match against tracked taskId or resourceId
      const matchedEntry = Object.entries(activeTasksRef.current).find(
        ([sourceId, t]) => t.taskId === ev.taskId || sourceId === ev.resourceId
      );
      const targetSourceId = ev.resourceId ?? matchedEntry?.[0];

      if (targetSourceId && ev.eventType.startsWith("task.")) {
        setActiveTasks((prev) => ({
          ...prev,
          [targetSourceId]: {
            taskId: ev.taskId,
            sourceId: targetSourceId,
            status: ev.status,
            progressStage: ev.progressStage ?? prev[targetSourceId]?.progressStage ?? null,
            progressPercent:
              typeof ev.progressPercent === "number"
                ? ev.progressPercent
                : (prev[targetSourceId]?.progressPercent ?? null),
            errorMessage: null,
          },
        }));
      }

      if (
        ev.eventType === "resource.updated" ||
        ev.eventType === "task.succeeded" ||
        ev.eventType === "task.failed" ||
        ev.eventType === "task.cancelled"
      ) {
        void refreshSources(true);
        if (targetSourceId && expandedRunsRef.current[targetSourceId]) {
          void loadRunsForSource(targetSourceId);
        } else {
          syncExpandedRuns();
        }
      }
    });
  }, [loadRunsForSource, refreshSources, subscribe]);

  const openAddDialog = () => {
    setEditingSource(null);
    setForm(createEmptyForm("greenhouse"));
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (source: JobSourceItem) => {
    setEditingSource(source);
    setForm(sourceToForm(source));
    setFormError(null);
    setDialogOpen(true);
  };

  const minAllowedMinutes = Math.max(
    getMinIntervalMinutes(form.sourceType),
    editingSource?.minRefreshIntervalMinutes ?? 0
  );

  const handleSourceTypeChange = (nextType: ConnectorSourceType) => {
    const nextMeta = SOURCE_TYPE_META[nextType];
    setForm((prev) => ({
      ...prev,
      sourceType: nextType,
      refreshIntervalMinutes: editingSource
        ? Math.max(prev.refreshIntervalMinutes, nextMeta.minIntervalMinutes)
        : nextMeta.defaultIntervalMinutes,
    }));
  };

  const handleSaveSourceForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.displayName.trim()) {
      setFormError("Display name is required.");
      return;
    }

    const identifier = form.sourceIdentifier?.trim() || "";
    const baseUrl = form.baseUrl?.trim() || "";

    if (form.sourceType === "generic_career_page" && !baseUrl) {
      setFormError("A public career page or RSS/Atom feed URL is required.");
      return;
    }

    if (form.sourceType !== "generic_career_page" && !identifier && !baseUrl) {
      setFormError(
        `Provide either a ${SOURCE_TYPE_META[form.sourceType].identifierLabel.toLowerCase()} or a public board URL.`
      );
      return;
    }

    if (
      !Number.isFinite(form.refreshIntervalMinutes) ||
      form.refreshIntervalMinutes < minAllowedMinutes
    ) {
      setFormError(
        `Refresh interval must be at least ${minAllowedMinutes} minutes for ${getSourceTypeLabel(form.sourceType)}.`
      );
      return;
    }

    setSubmittingForm(true);
    try {
      if (editingSource) {
        const updated = await updateSource(editingSource.id, form);
        setSources((prev) =>
          prev.map((item) => (item.id === updated.id ? updated : item))
        );
        toast({
          title: "Source updated",
          description: updated.displayName,
          tone: "accent",
        });
      } else {
        const created = await createSource(form);
        setSources((prev) => [created, ...prev]);
        toast({
          title: "Source added",
          description: `${created.displayName} — run "Test source" to validate before enabling scheduled scans.`,
          tone: "accent",
        });
      }
      setDialogOpen(false);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not save job source."
      );
    } finally {
      setSubmittingForm(false);
    }
  };

  const handleToggleEnabled = async (source: JobSourceItem) => {
    setTogglingId(source.id);
    try {
      const updated = await updateSource(source.id, { enabled: !source.enabled });
      setSources((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
      toast({
        title: updated.enabled ? "Source resumed" : "Source paused",
        description: updated.displayName,
        tone: "neutral",
      });
    } catch (error) {
      toast({
        title: "Could not update source state",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleTestSource = async (source: JobSourceItem) => {
    setTestingId(source.id);
    try {
      const result = await testSource(source.id);
      setTestResults((prev) => ({ ...prev, [source.id]: result }));
      toast({
        title: result.ok ? "Source test passed" : "Source test failed",
        description: result.message,
        tone: result.ok ? "accent" : "warning",
      });
      void refreshSources(true);
    } catch (error) {
      toast({
        title: "Source test failed",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleRunScanNow = async (source: JobSourceItem) => {
    setQueueingRunId(source.id);
    try {
      const res = await runSourceScan(source.id);
      if (res.taskId) {
        setActiveTasks((prev) => ({
          ...prev,
          [source.id]: {
            taskId: res.taskId,
            sourceId: source.id,
            status: res.status,
            progressStage: "Queued for worker scan",
            progressPercent: null,
            errorMessage: null,
          },
        }));
      }
      toast({
        title: "Source scan queued",
        description: `${source.displayName} scan is running in the background.`,
        tone: "accent",
      });
      if (expandedRuns[source.id]) {
        void loadRunsForSource(source.id);
      }
    } catch (error) {
      toast({
        title: "Could not start source scan",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setQueueingRunId(null);
    }
  };

  const handleConfirmDelete = async (source: JobSourceItem) => {
    setDeletingId(source.id);
    try {
      await deleteSource(source.id);
      setSources((prev) => prev.filter((item) => item.id !== source.id));
      setConfirmDeleteId(null);
      toast({
        title: "Source removed",
        description: source.displayName,
        tone: "neutral",
      });
    } catch (error) {
      toast({
        title: "Could not remove source",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const toggleRunsExpanded = (sourceId: string) => {
    const nextOpen = !expandedRuns[sourceId];
    setExpandedRuns((prev) => ({ ...prev, [sourceId]: nextOpen }));
    if (nextOpen && !runsBySource[sourceId]) {
      void loadRunsForSource(sourceId);
    }
  };

  const activeFormMeta = SOURCE_TYPE_META[form.sourceType];

  return (
    <div className="space-y-6">
      {/* Header & policy notice */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="text-[16px] font-semibold text-[var(--text-primary)]">
            Job source registry
          </h3>
          <p className="mt-0.5 max-w-2xl text-[13px] text-[var(--text-secondary)]">
            Configure public Greenhouse, Lever, Ashby boards, and structured Generic Career Pages (Schema.org JobPosting JSON-LD or RSS/Atom). Test a source before enabling scheduled scans.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refreshSources(false)}
            loading={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={openAddDialog}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add source
          </Button>
        </div>
      </div>

      {/* Explicit LinkedIn / Naukri manual import policy callout */}
      <div className="flex flex-col justify-between gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] text-[var(--text-secondary)] sm:flex-row sm:items-center">
        <div className="space-y-0.5">
          <p className="font-medium text-[var(--text-primary)]">
            LinkedIn and Naukri use manual import only
          </p>
          <p>
            Restricted or login-gated portals are never scraped automatically. Paste the job description and store the reference URL using Manual Import in Discover Jobs.
          </p>
        </div>
        <Link
          href="/discover?import=1"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <span>Open manual import</span>
          <ExternalLink className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
        </Link>
      </div>

      {/* Source list */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-4 py-3 text-[13px] text-[var(--text-primary)]"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]"
              aria-hidden="true"
            />
            <span>{loadError}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void refreshSources(false)}>
            Retry
          </Button>
        </div>
      ) : sources.length === 0 ? (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
          <p className="text-[14px] font-medium text-[var(--text-primary)]">
            No job sources configured yet
          </p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
            Add a public Greenhouse, Lever, Ashby board, or structured career page to begin discovering jobs locally.
          </p>
          <div className="mt-4">
            <Button variant="primary" size="sm" onClick={openAddDialog}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add first source
            </Button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
          {sources.map((source) => {
            const isManualSynthetic = source.sourceType === "manual";
            const activeTask = activeTasks[source.id];
            const isTaskActive =
              activeTask?.status === "queued" || activeTask?.status === "running";
            const testResult = testResults[source.id];
            const runsOpen = Boolean(expandedRuns[source.id]);
            const runs = runsBySource[source.id] ?? [];
            const isRunsLoading = Boolean(runsLoading[source.id]);
            const runError = runsError[source.id];
            const confirmingDelete = confirmDeleteId === source.id;

            return (
              <div key={source.id} className="bg-[var(--surface)]">
                <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-start lg:justify-between">
                  {/* Left metadata */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                        {source.displayName}
                      </span>
                      <Badge tone="neutral">{getSourceTypeLabel(source.sourceType)}</Badge>
                      <Badge tone={healthTone(source.healthState, source.enabled)}>
                        {healthLabel(source.healthState, source.enabled)}
                      </Badge>
                      {source.consecutiveFailures > 0 ? (
                        <span className="font-data text-[11px] text-[var(--warning)]">
                          {source.consecutiveFailures} consecutive failure
                          {source.consecutiveFailures === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--text-secondary)]">
                      {source.sourceIdentifier ? (
                        <span className="font-data">
                          id: {source.sourceIdentifier}
                        </span>
                      ) : null}
                      {source.baseUrl &&
                      (source.baseUrl.startsWith("https://") ||
                        source.baseUrl.startsWith("http://")) ? (
                        <a
                          href={source.baseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-[320px] items-center gap-1 truncate font-data text-[var(--accent)] hover:underline"
                        >
                          <span className="truncate">{source.baseUrl}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </a>
                      ) : null}
                      <span className="font-data text-[var(--text-tertiary)]">
                        Interval: {formatIntervalLabel(source.refreshIntervalMinutes)}
                      </span>
                      <span className="font-data text-[var(--text-tertiary)]">
                        Last success: {formatShortTimestamp(source.lastSuccessAt)}
                      </span>
                    </div>

                    {/* Live SSE scan progress */}
                    {activeTask && isTaskActive ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className="mt-2 flex items-center gap-3 rounded-[6px] border border-[#C4D6CA] bg-[var(--accent-soft)] px-3 py-2 text-[12px]"
                      >
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                          {typeof activeTask.progressPercent === "number" ? (
                            <div
                              className="h-full bg-[var(--accent)] transition-[width] duration-150"
                              style={{
                                width: `${Math.max(
                                  0,
                                  Math.min(100, activeTask.progressPercent)
                                )}%`,
                              }}
                            />
                          ) : (
                            <div className="workbench-indeterminate h-full w-1/3 bg-[var(--accent)]" />
                          )}
                        </div>
                        <span className="font-medium text-[var(--text-primary)]">
                          {activeTask.progressStage ?? `Scan ${activeTask.status}`}
                        </span>
                        {typeof activeTask.progressPercent === "number" ? (
                          <span className="font-data text-[var(--text-secondary)]">
                            {activeTask.progressPercent}%
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Test source output */}
                    {testResult ? (
                      <div
                        role="status"
                        className={cn(
                          "mt-2 flex items-start gap-2 rounded-[6px] border px-3 py-2 text-[12px]",
                          testResult.ok
                            ? "border-[#C4D6CA] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                            : "border-[#DFC99B] bg-[#F5EFE2] text-[var(--text-primary)]"
                        )}
                      >
                        {testResult.ok ? (
                          <CheckCircle2
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                            aria-hidden="true"
                          />
                        ) : (
                          <XCircle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]"
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <span>{testResult.message}</span>
                          {testResult.sampleCount !== null || testResult.detectedFormat ? (
                            <span className="ml-2 font-data text-[11px] text-[var(--text-secondary)]">
                              {[
                                testResult.detectedFormat,
                                testResult.sampleCount !== null
                                  ? `${testResult.sampleCount} listing${testResult.sampleCount === 1 ? "" : "s"}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {/* Last error detail */}
                    {source.lastErrorCode || source.lastErrorDetail ? (
                      <div className="mt-2 flex items-start gap-2 rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-3 py-2 text-[12px] text-[var(--text-primary)]">
                        <AlertTriangle
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--danger)]"
                          aria-hidden="true"
                        />
                        <span className="break-words">
                          <span className="font-data font-medium text-[var(--danger)]">
                            {source.lastErrorCode ?? "SOURCE_ERROR"}
                          </span>
                          {source.lastErrorDetail ? `: ${source.lastErrorDetail}` : ""}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* Right action controls */}
                  <div className="flex flex-wrap items-center gap-1.5 lg:shrink-0">
                    {!isManualSynthetic ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={testingId === source.id}
                          onClick={() => void handleTestSource(source)}
                        >
                          <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                          Test source
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={queueingRunId === source.id}
                          disabled={isTaskActive}
                          onClick={() => void handleRunScanNow(source)}
                        >
                          <Play className="h-3.5 w-3.5" aria-hidden="true" />
                          {isTaskActive ? "Scanning…" : "Run scan now"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={togglingId === source.id}
                          onClick={() => void handleToggleEnabled(source)}
                          title={
                            source.enabled
                              ? "Pause scheduled scans"
                              : "Resume scheduled scans"
                          }
                        >
                          {source.enabled ? (
                            <>
                              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                              Pause
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5" aria-hidden="true" />
                              Enable
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(source)}
                        >
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          Edit
                        </Button>
                      </>
                    ) : null}

                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={runsOpen}
                      onClick={() => toggleRunsExpanded(source.id)}
                    >
                      {runsOpen ? (
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Runs
                    </Button>

                    {!isManualSynthetic ? (
                      confirmingDelete ? (
                        <div className="flex items-center gap-1 rounded-[4px] border border-[#E4B8B4] bg-[#F8EAE8] px-2 py-1">
                          <span className="text-[12px] text-[var(--text-primary)]">
                            Remove?
                          </span>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={deletingId === source.id}
                            onClick={() => void handleConfirmDelete(source)}
                            className="h-7 px-2 text-[12px]"
                          >
                            Yes
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={deletingId === source.id}
                            onClick={() => setConfirmDeleteId(null)}
                            className="h-7 px-2 text-[12px]"
                          >
                            No
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${source.displayName}`}
                          onClick={() => setConfirmDeleteId(source.id)}
                        >
                          <Trash2
                            className="h-3.5 w-3.5 text-[var(--text-secondary)]"
                            aria-hidden="true"
                          />
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>

                {/* Expandable source_runs history table */}
                {runsOpen ? (
                  <div className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                        Recent scan runs
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={isRunsLoading}
                        onClick={() => void loadRunsForSource(source.id)}
                        className="h-7 px-2 text-[12px]"
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden="true" />
                        Reload runs
                      </Button>
                    </div>

                    {isRunsLoading && runs.length === 0 ? (
                      <Skeleton className="h-16 w-full" />
                    ) : runError ? (
                      <p className="text-[12px] text-[var(--danger)]">{runError}</p>
                    ) : runs.length === 0 ? (
                      <p className="text-[12px] text-[var(--text-secondary)]">
                        No scan runs recorded yet for this source.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)]">
                        <table className="w-full border-collapse text-left text-[12px]">
                          <thead>
                            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[11px] font-medium text-[var(--text-secondary)]">
                              <th className="px-3 py-2">Started</th>
                              <th className="px-3 py-2">Outcome</th>
                              <th className="px-3 py-2">Snapshot</th>
                              <th className="px-3 py-2 text-right">Fetched</th>
                              <th className="px-3 py-2 text-right">New</th>
                              <th className="px-3 py-2 text-right">Updated</th>
                              <th className="px-3 py-2 text-right">Closed</th>
                              <th className="px-3 py-2">Error / Notes</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]">
                            {runs.map((run) => (
                              <tr key={run.id} className="align-top">
                                <td className="px-3 py-2 font-data whitespace-nowrap text-[var(--text-secondary)]">
                                  {formatShortTimestamp(run.startedAt)}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <Badge tone={runOutcomeTone(run.outcome)}>
                                    {run.outcome}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2 font-data whitespace-nowrap text-[var(--text-secondary)]">
                                  {run.isCompleteSnapshot ? "Complete" : "Partial"}
                                </td>
                                <td className="px-3 py-2 text-right font-data text-[var(--text-primary)]">
                                  {run.fetchedCount}
                                </td>
                                <td className="px-3 py-2 text-right font-data text-[var(--text-primary)]">
                                  {run.newCount}
                                </td>
                                <td className="px-3 py-2 text-right font-data text-[var(--text-primary)]">
                                  {run.updatedCount}
                                </td>
                                <td className="px-3 py-2 text-right font-data text-[var(--text-primary)]">
                                  {run.closedCount}
                                </td>
                                <td className="px-3 py-2 text-[var(--text-secondary)]">
                                  {run.errorCode || run.errorDetail ? (
                                    <span className="text-[var(--danger)]">
                                      {[run.errorCode, run.errorDetail]
                                        .filter(Boolean)
                                        .join(": ")}
                                    </span>
                                  ) : (
                                    <span className="text-[var(--text-tertiary)]">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Source Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingSource ? "Edit job source" : "Add job source"}
            </DialogTitle>
            <DialogDescription>
              Connect a public ATS board or structured career page. Restricted sites like LinkedIn and Naukri are never scraped — use Manual Import in Discover Jobs.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveSourceForm} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="source-type"
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                Connector type
              </label>
              <Select
                value={form.sourceType}
                disabled={Boolean(editingSource)}
                onValueChange={(val) =>
                  handleSourceTypeChange(val as ConnectorSourceType)
                }
              >
                <SelectTrigger id="source-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="greenhouse">Greenhouse</SelectItem>
                  <SelectItem value="lever">Lever</SelectItem>
                  <SelectItem value="ashby">Ashby</SelectItem>
                  <SelectItem value="generic_career_page">
                    Generic Career Page (JSON-LD / RSS / Atom)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[12px] text-[var(--text-tertiary)]">
                {activeFormMeta.helperText}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="source-display-name"
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                Display name
              </label>
              <Input
                id="source-display-name"
                value={form.displayName}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, displayName: e.target.value }))
                }
                placeholder="e.g. Acme Corp Engineering"
              />
            </div>

            {form.sourceType !== "generic_career_page" ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="source-identifier"
                  className="block text-[13px] font-medium text-[var(--text-primary)]"
                >
                  {activeFormMeta.identifierLabel}
                </label>
                <Input
                  id="source-identifier"
                  className="font-data"
                  value={form.sourceIdentifier ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      sourceIdentifier: e.target.value,
                    }))
                  }
                  placeholder={activeFormMeta.identifierPlaceholder}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label
                htmlFor="source-base-url"
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                {form.sourceType === "generic_career_page"
                  ? "Career page or feed URL"
                  : "Public board URL (optional if token provided)"}
              </label>
              <Input
                id="source-base-url"
                type="url"
                className="font-data"
                value={form.baseUrl ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                }
                placeholder={activeFormMeta.urlPlaceholder}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="source-interval-preset"
                  className="block text-[13px] font-medium text-[var(--text-primary)]"
                >
                  Refresh schedule
                </label>
                <Select
                  value={
                    INTERVAL_PRESETS.some(
                      (p) => p.value === form.refreshIntervalMinutes
                    )
                      ? String(form.refreshIntervalMinutes)
                      : "custom"
                  }
                  onValueChange={(val) => {
                    if (val !== "custom") {
                      setForm((prev) => ({
                        ...prev,
                        refreshIntervalMinutes: Number.parseInt(val, 10),
                      }));
                    }
                  }}
                >
                  <SelectTrigger id="source-interval-preset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_PRESETS.filter(
                      (p) => p.value >= minAllowedMinutes
                    ).map((preset) => (
                      <SelectItem key={preset.value} value={String(preset.value)}>
                        {preset.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Custom interval</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="source-interval-minutes"
                  className="block text-[13px] font-medium text-[var(--text-primary)]"
                >
                  Interval (minutes)
                </label>
                <Input
                  id="source-interval-minutes"
                  type="number"
                  min={minAllowedMinutes}
                  max={10080}
                  className="font-data"
                  value={form.refreshIntervalMinutes}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      refreshIntervalMinutes:
                        Number.parseInt(e.target.value, 10) || minAllowedMinutes,
                    }))
                  }
                />
                <p className="text-[11px] text-[var(--text-tertiary)]">
                  Minimum allowed: <span className="font-data">{minAllowedMinutes}m</span>
                </p>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
              <div>
                <label
                  htmlFor="source-enabled"
                  className="text-[13px] font-medium text-[var(--text-primary)]"
                >
                  Enable scheduled scans
                </label>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Leave off until you click “Test source” to verify public access.
                </p>
              </div>
              <Switch
                id="source-enabled"
                checked={form.enabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            {formError ? (
              <div
                role="alert"
                className="rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-3 py-2 text-[12px] text-[var(--danger)]"
              >
                {formError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={submittingForm}
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={submittingForm}>
                {editingSource ? "Save changes" : "Add source"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
