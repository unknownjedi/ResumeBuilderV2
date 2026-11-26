"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Layers,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
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
import { useSse } from "@/components/shell/sse-provider";
import { formatShortDate } from "@/features/job-discovery/types";
import { deleteResumeDraft, listResumes } from "./api";
import type { ResumeDraftState, ResumeDraftSummary } from "./types";

function draftStateMeta(state: ResumeDraftState): {
  label: string;
  tone: BadgeTone;
} {
  switch (state) {
    case "exported":
      return { label: "Exported", tone: "accent" };
    case "reviewed":
      return { label: "Reviewed", tone: "accent" };
    case "archived":
      return { label: "Archived", tone: "neutral" };
    case "draft":
    default:
      return { label: "Working draft", tone: "warning" };
  }
}

export function ResumesListView() {
  const { toast } = useToast();
  const { subscribe } = useSse();
  const shouldReduceMotion = useReducedMotion();

  const [drafts, setDrafts] = React.useState<ResumeDraftSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<ResumeDraftSummary | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const loadDrafts = React.useCallback(async () => {
    try {
      const items = await listResumes();
      setError(null);
      setDrafts(items);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load resume drafts."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    void listResumes()
      .then((items) => {
        if (!active) return;
        setError(null);
        setDrafts(items);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load resume drafts."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    return subscribe((msg) => {
      if (msg.kind === "reset") {
        void loadDrafts();
        return;
      }
      if (
        msg.kind === "event" &&
        (msg.event.resourceType === "resume" ||
          msg.event.eventType === "resource.updated")
      ) {
        void loadDrafts();
      }
    });
  }, [loadDrafts, subscribe]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteResumeDraft(deleteTarget.id);
      setDrafts((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      toast({
        title: "Resume draft deleted",
        description: `${deleteTarget.jobTitle} at ${deleteTarget.companyName}`,
        tone: "neutral",
      });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Could not delete resume draft",
        description: err instanceof Error ? err.message : "Delete failed.",
        tone: "danger",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Resumes
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Job-tailored, ATS-safe one-column resume drafts with claim-level evidence links and immutable DOCX/PDF versions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">A4 &amp; US Letter</Badge>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadDrafts()}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-col justify-between gap-3 rounded-[8px] border border-[#E4B8B4] bg-[#F8EAE8] px-4 py-3 text-[13px] text-[var(--danger)] sm:flex-row sm:items-center"
        >
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void loadDrafts()}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-[8px]" />
          <Skeleton className="h-24 w-full rounded-[8px]" />
          <Skeleton className="h-24 w-full rounded-[8px]" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-12 text-center">
          <FileText
            className="mx-auto h-7 w-7 text-[var(--text-tertiary)]"
            aria-hidden="true"
          />
          <p className="mt-3 text-[15px] font-medium text-[var(--text-primary)]">
            No tailored resume drafts yet
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] text-[var(--text-secondary)]">
            Open any discovered job posting and click{" "}
            <strong className="font-medium text-[var(--text-primary)]">
              Tailor resume
            </strong>{" "}
            to generate an editable draft grounded in your verified career profile.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <Link
              href="/discover"
              className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--accent)] bg-[var(--accent)] px-3.5 text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-[#365545] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <span>Discover jobs</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <Link
              href="/settings"
              className="inline-flex h-9 items-center rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Default paper size
            </Link>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-raised)]">
          {drafts.map((draft, idx) => {
            const stateMeta = draftStateMeta(draft.state);
            const allVerified =
              draft.claimCount > 0 &&
              draft.verifiedClaimCount >= draft.claimCount;
            return (
              <motion.div
                key={draft.id}
                initial={
                  shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }
                }
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: shouldReduceMotion ? 0.01 : 0.16,
                  delay: shouldReduceMotion ? 0 : Math.min(idx * 0.03, 0.15),
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="flex flex-col justify-between gap-4 p-4 transition-colors hover:bg-[var(--surface)] sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/resumes/${encodeURIComponent(draft.id)}`}
                      className="truncate text-[15px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      {draft.jobTitle}
                    </Link>
                    <Badge tone={stateMeta.tone}>{stateMeta.label}</Badge>
                    {draft.searchProfileName ? (
                      <Badge tone="neutral">{draft.searchProfileName}</Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">
                      {draft.companyName}
                    </span>
                    <span className="inline-flex items-center gap-1 font-data text-[12px]">
                      <CheckCircle2
                        className={
                          allVerified
                            ? "h-3.5 w-3.5 text-[var(--accent)]"
                            : "h-3.5 w-3.5 text-[var(--text-tertiary)]"
                        }
                        aria-hidden="true"
                      />
                      {draft.verifiedClaimCount}/{draft.claimCount} verified claims
                    </span>
                    <span className="inline-flex items-center gap-1 font-data text-[12px]">
                      <Layers
                        className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
                        aria-hidden="true"
                      />
                      {draft.versionCount}{" "}
                      {draft.versionCount === 1 ? "version" : "versions"}
                    </span>
                    <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                      Updated {formatShortDate(draft.updatedAt)}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {draft.jobId ? (
                    <Link
                      href={`/jobs/${encodeURIComponent(draft.jobId)}`}
                      className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      View job
                    </Link>
                  ) : null}
                  <Link
                    href={`/resumes/${encodeURIComponent(draft.id)}`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--accent)] bg-[var(--accent)] px-3 text-[12px] font-medium text-[var(--on-accent)] transition-colors hover:bg-[#365545] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    <span>Open studio</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete draft for ${draft.jobTitle}`}
                    onClick={() => setDeleteTarget(draft)}
                  >
                    <Trash2
                      className="h-4 w-4 text-[var(--text-tertiary)] hover:text-[var(--danger)]"
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete working resume draft?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `This removes the editable working draft for ${deleteTarget.jobTitle} at ${deleteTarget.companyName}. Exported immutable versions already linked to applications are preserved.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
