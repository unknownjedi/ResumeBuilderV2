"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useSse } from "@/components/shell/sse-provider";
import { useWorkspace } from "@/components/shell/workspace-context";
import { getJobDetail, updateJobDiscoveryState } from "./api";
import { DuplicateReviewDialog } from "./duplicate-review-dialog";
import { JobDetailView } from "./job-detail-view";
import type { JobDetailItem, UserJobDiscoveryState } from "./types";

export interface JobDetailPageClientProps {
  jobId: string;
}

/**
 * Full-page client controller for /jobs/[id] with Back to Discover navigation,
 * live SSE job updates, Save/Dismiss/Reopen actions, and duplicate review access.
 */
export function JobDetailPageClient({ jobId }: JobDetailPageClientProps) {
  const { toast } = useToast();
  const { subscribe } = useSse();
  const { activeProfileId } = useWorkspace();

  const [job, setJob] = React.useState<JobDetailItem | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingAction, setPendingAction] = React.useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = React.useState(false);

  const loadJob = React.useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        const detail = await getJobDetail(jobId, activeProfileId);
        setJob(detail);
        setError(null);
      } catch (err) {
        if (!quiet) {
          setError(
            err instanceof Error ? err.message : "Could not load job posting."
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [activeProfileId, jobId]
  );

  React.useEffect(() => {
    let active = true;
    getJobDetail(jobId, activeProfileId)
      .then((detail) => {
        if (!active) return;
        setJob(detail);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Could not load job posting."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeProfileId, jobId]);

  React.useEffect(() => {
    return subscribe((msg) => {
      if (msg.kind === "reset" || msg.kind === "poll") {
        void loadJob(true);
        return;
      }
      const ev = msg.event;
      if (
        ev.resourceType === "job" &&
        (!ev.resourceId || ev.resourceId === jobId)
      ) {
        void loadJob(true);
      }
    });
  }, [jobId, loadJob, subscribe]);

  const handleChangeState = async (
    nextState: UserJobDiscoveryState | "active"
  ) => {
    if (!job) return;
    const prevJob = job;
    const nextNormalized: UserJobDiscoveryState | null =
      nextState === "active" ? null : nextState;

    setPendingAction(true);
    setJob({ ...job, userState: nextNormalized });

    try {
      await updateJobDiscoveryState(job.id, nextState, {
        searchProfileId: activeProfileId,
      });
      toast({
        title:
          nextNormalized === "saved"
            ? "Job saved"
            : nextNormalized === "dismissed"
              ? "Job dismissed"
              : "Job reopened",
        description: job.title,
        tone: nextNormalized === "saved" ? "accent" : "neutral",
      });
    } catch (err) {
      setJob(prevJob);
      toast({
        title: "Could not update job state",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setPendingAction(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Clear Back to Discover navigation */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <Link
          href="/discover"
          className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to Discover</span>
        </Link>

        <Button
          variant="ghost"
          size="sm"
          loading={loading}
          onClick={() => void loadJob(false)}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {loading && !job ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-3 rounded-[8px] border border-[#E4B8B4] bg-[#F8EAE8] p-5 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-[14px] font-medium text-[var(--text-primary)]">
                Unable to load job posting
              </p>
              <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                {error}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadJob(false)}
            >
              Retry
            </Button>
            <Link
              href="/discover"
              className="inline-flex h-8 items-center rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
            >
              Return to Discover
            </Link>
          </div>
        </div>
      ) : job ? (
        <JobDetailView
          job={job}
          variant="page"
          pendingAction={pendingAction}
          onChangeState={(nextState) => void handleChangeState(nextState)}
          onReviewDuplicates={() => setDuplicateDialogOpen(true)}
        />
      ) : null}

      <DuplicateReviewDialog
        open={duplicateDialogOpen}
        onOpenChange={setDuplicateDialogOpen}
        onResolved={() => void loadJob(true)}
      />
    </div>
  );
}
