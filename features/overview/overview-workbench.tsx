"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Circle,
  RefreshCw,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useSse } from "@/components/shell/sse-provider";
import { useWorkspace } from "@/components/shell/workspace-context";
import { updateJobDiscoveryState } from "@/features/job-discovery/api";
import {
  computeFreshness,
  formatDateTime,
  formatShortDate,
  formatWorkplaceLabel,
  isSafeExternalHttpUrl,
} from "@/features/job-discovery/types";
import { analyzeTopCandidates, getOverview } from "./api";
import {
  getOverviewSalaryDisplay,
  type NeedsAttentionItem,
  type OverviewPayload,
  type OverviewRecommendationItem,
} from "./types";

const SETUP_STEPS = [
  {
    step: "01",
    title: "Build your verified career profile",
    description:
      "Import a baseline resume or add work experience, projects, achievements, and skills. Only verified facts count toward Documented Fit.",
    href: "/profile",
    actionLabel: "Open career profile",
  },
  {
    step: "02",
    title: "Create a search profile",
    description:
      "Define target job titles, hard filters, job-centric target skills, and ranking weights for a search strategy.",
    href: "/search-profiles",
    actionLabel: "Configure search profile",
  },
  {
    step: "03",
    title: "Verify local AI CLI & sources",
    description:
      "Configure job sources and choose a local AI CLI preset (or keep No-AI deterministic mode).",
    href: "/settings",
    actionLabel: "Open settings",
  },
  {
    step: "04",
    title: "Discover and inspect postings",
    description:
      "Import job URLs or run source scans to inspect evidence-backed rankings and start tailored applications.",
    href: "/discover",
    actionLabel: "Go to discover jobs",
  },
];

function attentionTone(severity: NeedsAttentionItem["severity"]): BadgeTone {
  switch (severity) {
    case "danger":
      return "danger";
    case "warning":
      return "warning";
    case "neutral":
      return "neutral";
  }
}

function HorizontalEvidenceBar({
  item,
}: {
  item: OverviewRecommendationItem;
}) {
  const counts = item.requirementCounts;
  if (counts && counts.total > 0) {
    const denom =
      counts.supported + counts.partiallySupported + counts.notFoundInProfile;
    if (denom === 0) {
      return (
        <span className="text-[11px] text-[var(--text-tertiary)]">
          All {counts.ambiguous} requirements ambiguous
        </span>
      );
    }
    return (
      <div className="space-y-1">
        <div
          role="img"
          aria-label={`Evidence: ${counts.supported} supported, ${counts.partiallySupported} partial, ${counts.notFoundInProfile} not found`}
          className="flex h-1.5 w-32 overflow-hidden rounded-[2px] border border-[var(--border)] bg-[var(--surface-muted)]"
        >
          <div
            className="h-full bg-[var(--accent)]"
            style={{ width: `${(counts.supported / denom) * 100}%` }}
          />
          <div
            className="h-full bg-[var(--warning)]"
            style={{ width: `${(counts.partiallySupported / denom) * 100}%` }}
          />
          <div
            className="h-full bg-[#D1CFC7]"
            style={{ width: `${(counts.notFoundInProfile / denom) * 100}%` }}
          />
        </div>
        <div className="font-data text-[11px] text-[var(--text-tertiary)]">
          {counts.supported}/{denom} supported
          {counts.partiallySupported > 0
            ? ` · ${counts.partiallySupported} partial`
            : ""}
        </div>
      </div>
    );
  }

  if (typeof item.documentedFitScore === "number") {
    const pct = Math.max(0, Math.min(100, Math.round(item.documentedFitScore)));
    return (
      <div
        role="img"
        aria-label={`Documented fit ${pct}%`}
        className="h-1.5 w-32 overflow-hidden rounded-[2px] border border-[var(--border)] bg-[var(--surface-muted)]"
      >
        <div
          className="h-full bg-[var(--accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }

  return null;
}

function buildFactorNote(item: OverviewRecommendationItem): string | null {
  const match = item.latestMatch;
  if (match && match.includedFactors.length > 0) {
    const includedParts = match.includedFactors
      .filter((f) => f.included)
      .map((f) => {
        const w = f.effectiveWeight ?? f.configuredWeight;
        return w !== null ? `${f.label} ${Math.round(w)}%` : f.label;
      });

    if (includedParts.length > 0) {
      if (match.renormalized && match.omittedFactors.length > 0) {
        return `Included: ${includedParts.join(" · ")} (renormalized; omitted: ${match.omittedFactors.join(", ")})`;
      }
      return `Factors: ${includedParts.join(" · ")}`;
    }
  }

  if (item.includedFactorNames.length > 0) {
    return item.weightsRenormalized
      ? `Included: ${item.includedFactorNames.join(" · ")} (weights renormalized)`
      : `Factors: ${item.includedFactorNames.join(" · ")}`;
  }

  if (item.rankingMode === "basic_relevance") {
    return "Ordered by basic relevance (AI/deterministic requirement analysis not run).";
  }
  return null;
}

/**
 * Action-oriented Overview workspace showing the active search profile,
 * up to 10 ranked open recommendations with distinct Documented Fit / Skill Alignment /
 * Priority scores, Needs Attention links, and scan status.
 */
export function OverviewWorkbench() {
  const { toast } = useToast();
  const { subscribe } = useSse();
  const { searchProfiles, activeProfileId, setActiveProfileId } =
    useWorkspace();
  const shouldReduceMotion = useReducedMotion();

  const [overview, setOverview] = React.useState<OverviewPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [analyzingBatch, setAnalyzingBatch] = React.useState(false);
  const [pendingStateIds, setPendingStateIds] = React.useState<
    Record<string, boolean>
  >({});

  const fetchOverview = React.useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const data = await getOverview(activeProfileId);
        setOverview(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load overview."
        );
      } finally {
        setLoading(false);
      }
    },
    [activeProfileId]
  );

  React.useEffect(() => {
    let active = true;
    getOverview(activeProfileId)
      .then((data) => {
        if (!active) return;
        setOverview(data);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Could not load overview."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeProfileId]);

  React.useEffect(() => {
    return subscribe((msg) => {
      if (msg.kind === "reset" || msg.kind === "poll") {
        void fetchOverview(true);
        return;
      }
      const ev = msg.event;
      if (
        ev.resourceType === "job" ||
        ev.resourceType === "source" ||
        ev.resourceType === "resume" ||
        ev.resourceType === "application" ||
        ev.taskType.includes("job") ||
        ev.taskType.includes("source")
      ) {
        if (
          ev.eventType === "task.succeeded" ||
          ev.eventType === "resource.updated"
        ) {
          if (ev.taskType === "job.analyze" || ev.taskType === "job.match") {
            setAnalyzingBatch(false);
          }
          void fetchOverview(true);
        } else if (
          ev.eventType === "task.failed" &&
          (ev.taskType === "job.analyze" || ev.taskType === "job.match")
        ) {
          setAnalyzingBatch(false);
        }
      }
    });
  }, [fetchOverview, subscribe]);

  const handleAnalyzeTopCandidates = async () => {
    if (!overview) return;
    const unanalyzedIds = overview.recommendations
      .filter((r) => r.analysisStatus === "pending")
      .map((r) => r.jobId);
    const targetIds =
      unanalyzedIds.length > 0
        ? unanalyzedIds
        : overview.recommendations.map((r) => r.jobId);

    if (targetIds.length === 0) {
      toast({
        title: "No open candidate jobs to analyze",
        tone: "neutral",
      });
      return;
    }

    setAnalyzingBatch(true);
    try {
      const cap = Math.min(overview.actionAnalysisCap || 10, 10);
      const res = await analyzeTopCandidates({
        searchProfileId: activeProfileId ?? overview.activeProfileId,
        candidateJobIds: targetIds,
        cap,
      });
      toast({
        title: `Analysis queued for ${res.queuedCount} candidate${res.queuedCount === 1 ? "" : "s"}`,
        description: `Capped at ${cap} jobs per action. Scores update live as tasks finish.`,
        tone: "accent",
      });
      if (res.taskIds.length === 0) {
        setAnalyzingBatch(false);
        await fetchOverview(true);
      }
    } catch (err) {
      setAnalyzingBatch(false);
      toast({
        title: "Could not queue candidate analysis",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    }
  };

  const handleRowState = async (
    item: OverviewRecommendationItem,
    nextState: "saved" | "dismissed" | "active"
  ) => {
    const previous = overview;
    setPendingStateIds((prev) => ({ ...prev, [item.jobId]: true }));

    setOverview((prev) => {
      if (!prev) return prev;
      const nextRecs =
        nextState === "dismissed"
          ? prev.recommendations.filter((r) => r.jobId !== item.jobId)
          : prev.recommendations.map((r) =>
              r.jobId === item.jobId
                ? { ...r, userState: nextState === "active" ? null : nextState }
                : r
            );
      return { ...prev, recommendations: nextRecs };
    });

    if (nextState === "dismissed") {
      toast({
        title: "Job dismissed",
        description: item.title,
        tone: "neutral",
        actionLabel: "Undo",
        onAction: () => {
          void updateJobDiscoveryState(item.jobId, item.userState ?? "active", {
            searchProfileId: activeProfileId ?? overview?.activeProfileId,
          })
            .then(() => fetchOverview(true))
            .catch(() => undefined);
        },
      });
    }

    try {
      await updateJobDiscoveryState(item.jobId, nextState, {
        searchProfileId: activeProfileId ?? overview?.activeProfileId,
      });
    } catch (err) {
      setOverview(previous);
      toast({
        title: "Could not update job state",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setPendingStateIds((prev) => {
        const copy = { ...prev };
        delete copy[item.jobId];
        return copy;
      });
    }
  };

  const showSetupChecklist =
    overview !== null && (!overview.hasSearchProfiles || !overview.hasAnyJobs);

  const selectedProfileValue =
    activeProfileId ?? overview?.activeProfileId ?? "__none";

  const capLimit = Math.min(overview?.actionAnalysisCap ?? 10, 10);

  return (
    <div className="space-y-6">
      {/* Header with active profile selector and scan status */}
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Overview
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Up to 10 ranked open postings for your active search strategy, plus items awaiting your review.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {searchProfiles.length > 0 ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor="overview-profile-select"
                className="text-[12px] font-medium text-[var(--text-secondary)]"
              >
                Strategy:
              </label>
              <Select
                value={selectedProfileValue}
                onValueChange={(val) => {
                  if (val !== "__none") {
                    setActiveProfileId(val);
                  }
                }}
              >
                <SelectTrigger
                  id="overview-profile-select"
                  className="h-8 w-[210px] text-[13px]"
                >
                  <SelectValue placeholder="Select search profile" />
                </SelectTrigger>
                <SelectContent>
                  {searchProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Link
              href="/search-profiles"
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
            >
              Create search profile
            </Link>
          )}

          <div className="flex flex-wrap items-center gap-2 font-data text-[12px] text-[var(--text-tertiary)]">
            <span>
              Last scan:{" "}
              {overview?.scanStatus.lastSuccessfulScanAt
                ? formatDateTime(overview.scanStatus.lastSuccessfulScanAt)
                : "Not run"}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Next scheduled:{" "}
              {overview?.scanStatus.nextScheduledScanAt
                ? formatDateTime(overview.scanStatus.nextScheduledScanAt)
                : "Manual"}
            </span>
          </div>
        </div>
      </div>

      {/* Main Actionable Grid */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left: Ranked Recommendations */}
        <section aria-labelledby="recommended-jobs-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id="recommended-jobs-heading"
                className="text-[14px] font-semibold text-[var(--text-primary)]"
              >
                Recommended open jobs
              </h3>
              {overview ? (
                overview.rankingMode === "basic_relevance" ? (
                  <Badge tone="neutral">
                    Basic relevance (AI analysis unavailable/not run)
                  </Badge>
                ) : (
                  <Badge tone="accent" className="font-data">
                    Top {overview.recommendations.length} of{" "}
                    {overview.totalEligible} eligible
                  </Badge>
                )
              ) : null}
              {overview && overview.withheldPendingSkillFilterCount > 0 ? (
                <Badge tone="warning" className="font-data">
                  {overview.withheldPendingSkillFilterCount} pending hard-skill analysis
                </Badge>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {overview && overview.recommendations.length > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={analyzingBatch}
                  onClick={() => void handleAnalyzeTopCandidates()}
                  title={`Queue requirement analysis for up to ${capLimit} top open postings`}
                >
                  <SlidersHorizontal
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                  <span>
                    Analyze top candidates (cap {capLimit})
                  </span>
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh overview"
                onClick={() => void fetchOverview(false)}
              >
                <RefreshCw
                  className={cn("h-4 w-4", loading && "animate-spin")}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>

          {loading && !overview ? (
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
              <div className="p-4">
                <Skeleton className="h-14 w-full" />
              </div>
              <div className="p-4">
                <Skeleton className="h-14 w-full" />
              </div>
              <div className="p-4">
                <Skeleton className="h-14 w-full" />
              </div>
            </div>
          ) : error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-[8px] border border-[#E4B8B4] bg-[#F8EAE8] px-4 py-3 text-[13px]"
            >
              <div className="flex items-center gap-2 text-[var(--text-primary)]">
                <AlertTriangle
                  className="h-4 w-4 shrink-0 text-[var(--danger)]"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchOverview(false)}
              >
                Retry
              </Button>
            </div>
          ) : !overview || overview.recommendations.length === 0 ? (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center">
              <p className="text-[14px] font-medium text-[var(--text-primary)]">
                No ranked open jobs yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
                Import a posting or run a source scan in Discover jobs, then use your active search profile to rank open roles here.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link
                  href="/discover"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--accent)] bg-[var(--accent)] px-3 text-[13px] font-medium text-[var(--on-accent)] hover:bg-[#365545]"
                >
                  Open Discover jobs
                </Link>
                <Link
                  href="/search-profiles"
                  className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
                >
                  Edit search profiles
                </Link>
              </div>
            </div>
          ) : (
            <motion.div
              key={selectedProfileValue}
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
              className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]"
            >
              {overview.recommendations.map((item, idx) => {
                const freshness = computeFreshness(item.employerPostedAt);
                const salaryInfo = getOverviewSalaryDisplay(item);
                const safeUrl =
                  isSafeExternalHttpUrl(item.applyUrl) ??
                  isSafeExternalHttpUrl(item.canonicalUrl);
                const isSaved = item.userState === "saved";
                const isBusy = Boolean(pendingStateIds[item.jobId]);
                const factorNote = buildFactorNote(item);

                return (
                  <div
                    key={item.jobId}
                    className="flex flex-col justify-between gap-3 px-4 py-3.5 hover:bg-[var(--surface-raised)] sm:flex-row sm:items-start"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 w-6 shrink-0 font-data text-[12px] font-semibold text-[var(--text-tertiary)]">
                        #{String(idx + 1).padStart(2, "0")}
                      </span>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <Link
                            href={`/jobs/${encodeURIComponent(item.jobId)}`}
                            className="text-[14px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline"
                          >
                            {item.title}
                          </Link>
                          <span className="text-[13px] font-medium text-[var(--text-secondary)]">
                            {item.companyName}
                          </span>
                          {isSaved ? <Badge tone="accent">Saved</Badge> : null}
                        </div>

                        {/* Metadata line: location, work mode, source, posted vs discovered, salary */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--text-secondary)]">
                          <span>{item.locationText || "Location unknown"}</span>
                          <span>{formatWorkplaceLabel(item.workplaceType)}</span>
                          {item.primarySourceName ? (
                            <span className="font-data text-[var(--text-tertiary)]">
                              {item.primarySourceName}
                            </span>
                          ) : null}
                          <span className="font-data text-[var(--text-tertiary)]">
                            {item.employerPostedAt
                              ? `Posted ${formatShortDate(item.employerPostedAt)} (${freshness.label})`
                              : "Posted date unknown"}
                          </span>
                          <span className="font-data text-[var(--text-tertiary)]">
                            Discovered {formatShortDate(item.firstSeenAt)}
                          </span>
                          {salaryInfo ? (
                            <span className="font-data font-medium text-[var(--text-primary)]">
                              {salaryInfo.text} ({salaryInfo.provenanceLabel})
                            </span>
                          ) : null}
                        </div>

                        {item.matchReason ? (
                          <p className="text-[12px] text-[var(--text-secondary)]">
                            {item.matchReason}
                          </p>
                        ) : null}

                        {factorNote ? (
                          <p className="font-data text-[11px] text-[var(--text-tertiary)]">
                            {factorNote}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {/* Distinct scores + horizontal evidence bar + actions */}
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <div className="flex flex-wrap items-center gap-1.5 font-data text-[12px]">
                        <span
                          title="Documented candidate evidence fit (not an ATS score)"
                          className="rounded-[4px] border border-[var(--border)] bg-[var(--canvas)] px-2 py-0.5 text-[var(--text-primary)]"
                        >
                          Fit{" "}
                          {typeof item.documentedFitScore === "number"
                            ? `${Math.round(item.documentedFitScore)}%`
                            : item.analysisStatus === "pending"
                              ? "Not analyzed"
                              : "N/A"}
                        </span>

                        <span
                          title="Search-profile skill alignment"
                          className="rounded-[4px] border border-[var(--border)] bg-[var(--canvas)] px-2 py-0.5 text-[var(--text-secondary)]"
                        >
                          Skill{" "}
                          {typeof item.searchSkillAlignmentScore === "number"
                            ? `${Math.round(item.searchSkillAlignmentScore)}%`
                            : "Omitted"}
                        </span>

                        {item.rankingMode === "priority" &&
                        typeof item.priorityScore === "number" ? (
                          <span
                            title="Combined weighted priority score"
                            className="rounded-[4px] border border-[#C4D6CA] bg-[var(--accent-soft)] px-2 py-0.5 font-semibold text-[var(--accent)]"
                          >
                            Priority {Math.round(item.priorityScore)}
                          </span>
                        ) : (
                          <Badge tone="neutral">Basic relevance</Badge>
                        )}
                      </div>

                      <HorizontalEvidenceBar item={item} />

                      <div className="flex items-center gap-1">
                        {safeUrl ? (
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open original posting for ${item.title}`}
                            title="Open original posting"
                            className="inline-flex h-8 items-center gap-1 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
                          >
                            <span>Posting</span>
                            <ArrowUpRight
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          </a>
                        ) : null}

                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isBusy}
                          aria-label={
                            isSaved
                              ? `Unsave ${item.title}`
                              : `Save ${item.title}`
                          }
                          aria-pressed={isSaved}
                          onClick={() =>
                            void handleRowState(
                              item,
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

                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isBusy}
                          aria-label={`Dismiss ${item.title}`}
                          onClick={() => void handleRowState(item, "dismissed")}
                        >
                          <XCircle
                            className="h-4 w-4 text-[var(--text-secondary)]"
                            aria-hidden="true"
                          />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}
        </section>

        {/* Right: Needs Attention */}
        <aside aria-labelledby="needs-attention-heading" className="space-y-3">
          <h3
            id="needs-attention-heading"
            className="text-[14px] font-semibold text-[var(--text-primary)]"
          >
            Needs attention
          </h3>

          {!overview || overview.needsAttention.length === 0 ? (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-start gap-2.5 text-[13px] text-[var(--text-secondary)]">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium text-[var(--text-primary)]">
                    Nothing awaiting action
                  </p>
                  <p className="mt-0.5">
                    Drafts needing review, ready applications, duplicate candidates, and source failures will appear here.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
              {overview.needsAttention.map((att) => (
                <Link
                  key={att.id}
                  href={att.href}
                  className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-raised)]"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">
                        {att.title}
                      </span>
                      <Badge tone={attentionTone(att.severity)}>Action</Badge>
                    </div>
                    {att.detail ? (
                      <p className="text-[12px] text-[var(--text-secondary)]">
                        {att.detail}
                      </p>
                    ) : null}
                  </div>
                  <ArrowRight
                    className="mt-1 h-4 w-4 shrink-0 text-[var(--text-tertiary)]"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          )}

          {/* Compact Source Summary */}
          {overview ? (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                  Source health
                </span>
                <Link
                  href="/settings?tab=sources"
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  Manage sources
                </Link>
              </div>
              <dl className="mt-2 space-y-1 text-[var(--text-secondary)]">
                <div className="flex items-center justify-between">
                  <dt>Active sources</dt>
                  <dd className="font-data text-[var(--text-primary)]">
                    {overview.scanStatus.activeSourcesCount}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt>Failing sources</dt>
                  <dd
                    className={cn(
                      "font-data",
                      overview.scanStatus.failingSourcesCount > 0
                        ? "font-semibold text-[var(--danger)]"
                        : "text-[var(--text-primary)]"
                    )}
                  >
                    {overview.scanStatus.failingSourcesCount}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
        </aside>
      </div>

      {/* First-run setup checklist shown only when workspace is not yet populated */}
      {showSetupChecklist ? (
        <section
          aria-labelledby="setup-checklist-heading"
          className="space-y-3 border-t border-[var(--border)] pt-6"
        >
          <div className="flex items-center justify-between gap-2">
            <h3
              id="setup-checklist-heading"
              className="text-[14px] font-semibold text-[var(--text-primary)]"
            >
              Setup checklist
            </h3>
            <Badge tone="neutral">4 steps</Badge>
          </div>

          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
            {SETUP_STEPS.map((item) => (
              <div
                key={item.step}
                className="flex flex-col justify-between gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Circle
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--control-border)]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                        {item.step}
                      </span>
                      <span className="text-[14px] font-medium text-[var(--text-primary)]">
                        {item.title}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                      {item.description}
                    </p>
                  </div>
                </div>

                <Link
                  href={item.href}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] sm:self-center"
                >
                  <span>{item.actionLabel}</span>
                  <ArrowRight
                    className="h-3.5 w-3.5 text-[var(--text-secondary)]"
                    aria-hidden="true"
                  />
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
