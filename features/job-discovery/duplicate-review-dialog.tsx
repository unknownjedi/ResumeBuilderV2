"use client";

import * as React from "react";
import {
  AlertTriangle,
  ExternalLink,
  GitMerge,
  RefreshCw,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  dismissDuplicateCandidate,
  listDuplicateCandidates,
  mergeDuplicateCandidate,
} from "./api";
import {
  formatShortDate,
  formatWorkplaceLabel,
  isSafeExternalHttpUrl,
  type DuplicateCandidateItem,
  type DuplicateJobSummary,
} from "./types";

export interface DuplicateReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}

function JobSideCard({
  label,
  job,
  fallbackId,
  selected,
  onSelectKeep,
}: {
  label: string;
  job: DuplicateJobSummary | null;
  fallbackId: string;
  selected: boolean;
  onSelectKeep: () => void;
}) {
  const safeUrl = isSafeExternalHttpUrl(job?.applyUrl ?? job?.canonicalUrl);

  return (
    <div
      className={
        selected
          ? "flex flex-col justify-between rounded-[6px] border border-[var(--accent)] bg-[var(--accent-soft)] p-3"
          : "flex flex-col justify-between rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3"
      }
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-data text-[11px] font-medium text-[var(--text-tertiary)] uppercase">
            {label}
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-[var(--text-primary)]">
            <input
              type="radio"
              checked={selected}
              onChange={onSelectKeep}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span>Keep canonical</span>
          </label>
        </div>

        <p className="text-[14px] font-semibold text-[var(--text-primary)]">
          {job?.title ?? "Job record"}
        </p>
        <p className="text-[12px] text-[var(--text-secondary)]">
          {job?.companyName ?? "Unknown company"} ·{" "}
          {job?.locationText || "Location unknown"} ·{" "}
          {job ? formatWorkplaceLabel(job.workplaceType) : "Unspecified"}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-[11px] text-[var(--text-tertiary)]">
          <span>ID: {fallbackId.slice(0, 8)}</span>
          <span>
            {job?.employerPostedAt
              ? `Posted ${formatShortDate(job.employerPostedAt)}`
              : `Discovered ${formatShortDate(job?.firstSeenAt ?? null)}`}
          </span>
          {job && job.sourceNames.length > 0 ? (
            <span>Sources: {job.sourceNames.join(", ")}</span>
          ) : null}
        </div>
      </div>

      {safeUrl ? (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline"
          >
            <span>View original URL</span>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </div>
  );
}

function formatEvidenceEntries(evidence: Record<string, unknown>): Array<{
  key: string;
  value: string;
}> {
  return Object.entries(evidence)
    .filter(([, val]) => val !== null && val !== undefined && val !== "")
    .map(([key, val]) => ({
      key: key.replaceAll("_", " "),
      value:
        typeof val === "string" || typeof val === "number" || typeof val === "boolean"
          ? String(val)
          : JSON.stringify(val),
    }));
}

/**
 * Comparison dialog for reviewing proposed duplicate job candidates.
 * Favors precision: companies may have distinct requisitions with identical titles.
 */
export function DuplicateReviewDialog({
  open,
  onOpenChange,
  onResolved,
}: DuplicateReviewDialogProps) {
  const { toast } = useToast();
  const [candidates, setCandidates] = React.useState<DuplicateCandidateItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [keepChoice, setKeepChoice] = React.useState<Record<string, string>>({});
  const [actionId, setActionId] = React.useState<string | null>(null);
  const [candidateErrors, setCandidateErrors] = React.useState<
    Record<string, string>
  >({});

  const loadCandidates = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listDuplicateCandidates("proposed");
      setCandidates(list);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load duplicate suggestions."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    listDuplicateCandidates("proposed")
      .then((list) => {
        if (!active) return;
        setCandidates(list);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Could not load duplicate suggestions."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setLoading(true);
      setCandidateErrors({});
    }
    onOpenChange(nextOpen);
  };

  const handleMerge = async (candidate: DuplicateCandidateItem) => {
    const keepJobId = keepChoice[candidate.id] ?? candidate.jobAId;
    setActionId(candidate.id);
    setCandidateErrors((prev) => ({ ...prev, [candidate.id]: "" }));
    try {
      await mergeDuplicateCandidate(candidate.id, keepJobId);
      setCandidates((prev) => prev.filter((item) => item.id !== candidate.id));
      toast({
        title: "Duplicate jobs merged",
        description:
          "All source URLs and historical lineage were preserved on the canonical job.",
        tone: "accent",
      });
      onResolved();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not merge duplicate jobs.";
      setCandidateErrors((prev) => ({ ...prev, [candidate.id]: msg }));
    } finally {
      setActionId(null);
    }
  };

  const handleDismiss = async (candidate: DuplicateCandidateItem) => {
    setActionId(candidate.id);
    setCandidateErrors((prev) => ({ ...prev, [candidate.id]: "" }));
    try {
      await dismissDuplicateCandidate(candidate.id);
      setCandidates((prev) => prev.filter((item) => item.id !== candidate.id));
      toast({
        title: "Duplicate suggestion dismissed",
        description: "These postings will remain separate.",
        tone: "neutral",
      });
      onResolved();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not dismiss suggestion.";
      setCandidateErrors((prev) => ({ ...prev, [candidate.id]: msg }));
    } finally {
      setActionId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review duplicate job candidates</DialogTitle>
          <DialogDescription>
            Companies sometimes open multiple distinct requisitions with identical titles. Only merge postings if you are confident they represent the same role; merging preserves all source URLs and lineage.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-36 w-full" />
              <Skeleton className="h-36 w-full" />
            </div>
          ) : error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-3.5 py-3 text-[13px]"
            >
              <span className="text-[var(--danger)]">{error}</span>
              <Button variant="secondary" size="sm" onClick={() => void loadCandidates()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry
              </Button>
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-8 text-center">
              <p className="text-[14px] font-medium text-[var(--text-primary)]">
                No duplicate suggestions pending review
              </p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                Potential cross-source matches will appear here when detected.
              </p>
            </div>
          ) : (
            candidates.map((candidate) => {
              const selectedKeep = keepChoice[candidate.id] ?? candidate.jobAId;
              const evidenceList = formatEvidenceEntries(candidate.evidence);
              const pairError = candidateErrors[candidate.id];
              const isBusy = actionId === candidate.id;

              return (
                <div
                  key={candidate.id}
                  className="space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--canvas)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="warning">
                        {candidate.matchMethod.replaceAll("_", " ")}
                      </Badge>
                      <span className="font-data text-[12px] text-[var(--text-secondary)]">
                        Similarity:{" "}
                        {candidate.similarityScore <= 1
                          ? `${Math.round(candidate.similarityScore * 100)}%`
                          : `${Math.round(candidate.similarityScore)}%`}
                      </span>
                    </div>
                    <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                      Detected {formatShortDate(candidate.createdAt)}
                    </span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <JobSideCard
                      label="Posting A"
                      job={candidate.jobA}
                      fallbackId={candidate.jobAId}
                      selected={selectedKeep === candidate.jobAId}
                      onSelectKeep={() =>
                        setKeepChoice((prev) => ({
                          ...prev,
                          [candidate.id]: candidate.jobAId,
                        }))
                      }
                    />
                    <JobSideCard
                      label="Posting B"
                      job={candidate.jobB}
                      fallbackId={candidate.jobBId}
                      selected={selectedKeep === candidate.jobBId}
                      onSelectKeep={() =>
                        setKeepChoice((prev) => ({
                          ...prev,
                          [candidate.id]: candidate.jobBId,
                        }))
                      }
                    />
                  </div>

                  {evidenceList.length > 0 ? (
                    <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px]">
                      <span className="font-medium text-[var(--text-secondary)]">
                        Match evidence:{" "}
                      </span>
                      <span className="font-data text-[var(--text-primary)]">
                        {evidenceList
                          .map((entry) => `${entry.key}: ${entry.value}`)
                          .join(" · ")}
                      </span>
                    </div>
                  ) : null}

                  {pairError ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-3 py-2 text-[12px] text-[var(--danger)]"
                    >
                      <AlertTriangle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{pairError}</span>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void handleDismiss(candidate)}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Dismiss suggestion
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={isBusy}
                      onClick={() => void handleMerge(candidate)}
                    >
                      <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
                      Keep &amp; merge
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
