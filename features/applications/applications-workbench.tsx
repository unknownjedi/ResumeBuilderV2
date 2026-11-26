"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Lock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useSse } from "@/components/shell/sse-provider";
import {
  formatDateTime,
  formatShortDate,
  isSafeExternalHttpUrl,
} from "@/features/job-discovery/types";
import {
  listApplications,
  transitionApplicationStatus,
  updateApplication,
} from "./api";
import { ConfirmAppliedDialog } from "./confirm-applied-dialog";
import { CoverLetterAnswersPanel } from "./cover-letter-answers-panel";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_META,
  type ApplicationRecord,
  type ApplicationStatus,
} from "./types";

type PipelineFilter = "all" | ApplicationStatus;

export function ApplicationsWorkbench({
  initialApplicationId = null,
}: {
  initialApplicationId?: string | null;
}) {
  const { toast } = useToast();
  const { subscribe } = useSse();
  const shouldReduceMotion = useReducedMotion();

  const [applications, setApplications] = React.useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<PipelineFilter>("all");
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialApplicationId
  );

  const [notesEdit, setNotesEdit] = React.useState<{
    id: string;
    text: string;
  } | null>(null);
  const [savingMeta, setSavingMeta] = React.useState(false);
  const [transitioningStatus, setTransitioningStatus] = React.useState(false);
  const [confirmAppliedOpen, setConfirmAppliedOpen] = React.useState(false);

  const loadApplications = React.useCallback(async () => {
    try {
      const list = await listApplications();
      setError(null);
      setApplications(list);
      setSelectedId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        if (
          initialApplicationId &&
          list.some((a) => a.id === initialApplicationId)
        ) {
          return initialApplicationId;
        }
        return list[0]?.id ?? null;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load applications."
      );
    } finally {
      setLoading(false);
    }
  }, [initialApplicationId]);

  React.useEffect(() => {
    let active = true;
    void listApplications()
      .then((list) => {
        if (!active) return;
        setError(null);
        setApplications(list);
        setSelectedId((prev) => {
          if (prev && list.some((a) => a.id === prev)) return prev;
          if (
            initialApplicationId &&
            list.some((a) => a.id === initialApplicationId)
          ) {
            return initialApplicationId;
          }
          return list[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load applications."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [initialApplicationId]);

  React.useEffect(() => {
    return subscribe((msg) => {
      if (msg.kind === "reset") {
        void loadApplications();
        return;
      }
      if (
        msg.kind === "event" &&
        (msg.event.resourceType === "application" ||
          msg.event.eventType === "resource.updated")
      ) {
        void loadApplications();
      }
    });
  }, [loadApplications, subscribe]);

  const countsByStatus = React.useMemo(() => {
    const counts: Record<PipelineFilter, number> = {
      all: applications.length,
      preparing: 0,
      ready_to_apply: 0,
      applied: 0,
      response_received: 0,
      rejected: 0,
      withdrawn: 0,
      archived: 0,
    };
    for (const app of applications) {
      counts[app.status] = (counts[app.status] ?? 0) + 1;
    }
    return counts;
  }, [applications]);

  const filteredApplications = React.useMemo(() => {
    if (statusFilter === "all") return applications;
    return applications.filter((a) => a.status === statusFilter);
  }, [applications, statusFilter]);

  const selectedApplication = React.useMemo(() => {
    if (!selectedId) return filteredApplications[0] ?? null;
    return (
      applications.find((a) => a.id === selectedId) ??
      filteredApplications[0] ??
      null
    );
  }, [applications, filteredApplications, selectedId]);

  const notesDraft =
    selectedApplication && notesEdit?.id === selectedApplication.id
      ? notesEdit.text
      : (selectedApplication?.notes ?? "");
  const notesDirty = Boolean(
    selectedApplication &&
      notesEdit?.id === selectedApplication.id &&
      notesEdit.text !== (selectedApplication.notes ?? "")
  );

  const upsertApplicationInState = React.useCallback(
    (updated: ApplicationRecord) => {
      setApplications((prev) => {
        const exists = prev.some((a) => a.id === updated.id);
        if (!exists) return [updated, ...prev];
        return prev.map((a) => (a.id === updated.id ? updated : a));
      });
      setSelectedId(updated.id);
    },
    []
  );

  const handleStatusSelect = async (nextStatus: ApplicationStatus) => {
    if (!selectedApplication || nextStatus === selectedApplication.status) {
      return;
    }
    if (nextStatus === "applied") {
      setConfirmAppliedOpen(true);
      return;
    }

    setTransitioningStatus(true);
    try {
      const updated = await transitionApplicationStatus(selectedApplication.id, {
        status: nextStatus,
      });
      upsertApplicationInState(updated);
      toast({
        title: `Moved to ${APPLICATION_STATUS_META[nextStatus].label}`,
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not change status",
        description: err instanceof Error ? err.message : "Update failed.",
        tone: "danger",
      });
    } finally {
      setTransitioningStatus(false);
    }
  };

  const handleAttachResumeVersion = async (versionId: string) => {
    if (!selectedApplication) return;
    setSavingMeta(true);
    try {
      const updated = await updateApplication(selectedApplication.id, {
        resumeVersionId: versionId === "__none__" ? null : versionId,
      });
      upsertApplicationInState(updated);
      toast({
        title: "Attached resume version updated",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not update attached resume version",
        description: err instanceof Error ? err.message : "Update failed.",
        tone: "danger",
      });
    } finally {
      setSavingMeta(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedApplication) return;
    setSavingMeta(true);
    try {
      const updated = await updateApplication(selectedApplication.id, {
        notes: notesDraft.trim() || null,
      });
      upsertApplicationInState(updated);
      setNotesEdit(null);
      toast({
        title: "Application notes saved",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not save notes",
        description: err instanceof Error ? err.message : "Save failed.",
        tone: "danger",
      });
    } finally {
      setSavingMeta(false);
    }
  };

  const safeApplyUrl = selectedApplication
    ? isSafeExternalHttpUrl(selectedApplication.originalApplyUrl)
    : null;

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Applications
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Manual application pipeline with immutable resume snapshots, cover
            letters, and submission audit trails.{" "}
            <strong className="font-medium text-[var(--text-primary)]">
              Saved jobs stay separate in Discover
            </strong>{" "}
            until you begin preparation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/discover?state=saved"
            className="inline-flex h-8 items-center gap-1 rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          >
            <span>Saved jobs in Discover</span>
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadApplications()}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Pipeline Filter Tabs */}
      <div
        role="tablist"
        aria-label="Application pipeline stages"
        className="flex flex-wrap items-center gap-1.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-[4px] border px-3 text-[12px] font-medium transition-colors",
            statusFilter === "all"
              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          )}
        >
          <span>All</span>
          <span className="font-data text-[11px] opacity-85">
            {countsByStatus.all}
          </span>
        </button>

        {APPLICATION_STATUSES.map((status) => {
          const meta = APPLICATION_STATUS_META[status];
          const active = statusFilter === status;
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[4px] border px-3 text-[12px] font-medium transition-colors",
                active
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              <span>{meta.label}</span>
              <span className="font-data text-[11px] opacity-85">
                {countsByStatus[status]}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-[8px] border border-[#E4B8B4] bg-[#F8EAE8] px-4 py-3 text-[13px] text-[var(--danger)]"
        >
          <span>{error}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadApplications()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-2 lg:col-span-5">
            <Skeleton className="h-20 w-full rounded-[8px]" />
            <Skeleton className="h-20 w-full rounded-[8px]" />
            <Skeleton className="h-20 w-full rounded-[8px]" />
          </div>
          <div className="lg:col-span-7">
            <Skeleton className="h-[520px] w-full rounded-[8px]" />
          </div>
        </div>
      ) : applications.length === 0 ? (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-12 text-center">
          <p className="text-[15px] font-medium text-[var(--text-primary)]">
            No active applications
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] text-[var(--text-secondary)]">
            Choose{" "}
            <strong className="font-medium text-[var(--text-primary)]">
              Prepare application
            </strong>{" "}
            on any discovered job posting to start tracking materials, cover
            letters, and status transitions here.
          </p>
          <div className="mt-5">
            <Link
              href="/discover"
              className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--accent)] bg-[var(--accent)] px-3.5 text-[13px] font-medium text-[var(--on-accent)] hover:bg-[#365545]"
            >
              <span>Discover jobs</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-12 lg:items-start">
          {/* Left Ledger / List */}
          <div className="lg:col-span-5">
            {filteredApplications.length === 0 ? (
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-[13px] text-[var(--text-secondary)]">
                No applications in{" "}
                <strong className="text-[var(--text-primary)]">
                  {statusFilter === "all"
                    ? "this view"
                    : APPLICATION_STATUS_META[statusFilter].label}
                </strong>
                .
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-raised)]">
                {filteredApplications.map((app, idx) => {
                  const meta = APPLICATION_STATUS_META[app.status];
                  const isSelected = selectedApplication?.id === app.id;
                  return (
                    <motion.button
                      key={app.id}
                      type="button"
                      initial={
                        shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 3 }
                      }
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: shouldReduceMotion ? 0.01 : 0.14,
                        delay: shouldReduceMotion ? 0 : Math.min(idx * 0.02, 0.12),
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      onClick={() => setSelectedId(app.id)}
                      className={cn(
                        "flex w-full flex-col gap-1.5 p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]",
                        isSelected
                          ? "border-l-[3px] border-l-[var(--accent)] bg-[var(--accent-soft)]/45"
                          : "hover:bg-[var(--surface)]"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-semibold text-[var(--text-primary)]">
                            {app.jobTitle}
                          </div>
                          <div className="truncate text-[12px] text-[var(--text-secondary)]">
                            {app.companyName}
                            {app.locationText ? ` · ${app.locationText}` : ""}
                          </div>
                        </div>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-[11px] text-[var(--text-tertiary)]">
                        {app.resumeVersionNumber ? (
                          <span>Resume v{app.resumeVersionNumber}</span>
                        ) : app.resumeVersionId ? (
                          <span>Resume attached</span>
                        ) : (
                          <span>No resume version</span>
                        )}
                        {app.submittedMaterialsSnapshot ? (
                          <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            Snapshot frozen
                          </span>
                        ) : null}
                        <span>
                          {app.appliedAt
                            ? `Applied ${formatShortDate(app.appliedAt)}`
                            : `Updated ${formatShortDate(app.updatedAt)}`}
                        </span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Application Inspector */}
          <div className="space-y-5 lg:col-span-7">
            {selectedApplication ? (
              <div className="space-y-5 rounded-[8px] border border-[var(--border)] bg-[var(--surface-raised)] p-5">
                {/* Inspector Header */}
                <div className="space-y-3 border-b border-[var(--border)] pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            APPLICATION_STATUS_META[selectedApplication.status]
                              .tone
                          }
                        >
                          {
                            APPLICATION_STATUS_META[selectedApplication.status]
                              .label
                          }
                        </Badge>
                        {selectedApplication.searchProfileName ? (
                          <Badge tone="neutral">
                            {selectedApplication.searchProfileName}
                          </Badge>
                        ) : null}
                        {selectedApplication.submittedMaterialsSnapshot ? (
                          <Badge tone="accent" className="font-data">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            Submitted snapshot frozen
                          </Badge>
                        ) : null}
                      </div>

                      <h3 className="text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">
                        {selectedApplication.jobTitle}
                      </h3>
                      <p className="text-[13px] text-[var(--text-secondary)]">
                        {selectedApplication.companyName}
                        {selectedApplication.locationText
                          ? ` · ${selectedApplication.locationText}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/jobs/${encodeURIComponent(selectedApplication.jobId)}`}
                        className="inline-flex h-8 items-center gap-1 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
                      >
                        <span>Job detail</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </Link>
                      {safeApplyUrl ? (
                        <a
                          href={safeApplyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center gap-1 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface)] px-2.5 text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--surface-muted)]"
                        >
                          <span>Apply URL</span>
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {/* Status transition bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                        Stage:
                      </span>
                      <Select
                        value={selectedApplication.status}
                        onValueChange={(val) =>
                          void handleStatusSelect(val as ApplicationStatus)
                        }
                        disabled={transitioningStatus}
                      >
                        <SelectTrigger className="h-8 w-[180px] text-[12px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APPLICATION_STATUSES.map((st) => (
                            <SelectItem key={st} value={st}>
                              {APPLICATION_STATUS_META[st].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {selectedApplication.status === "preparing" ||
                    selectedApplication.status === "ready_to_apply" ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setConfirmAppliedOpen(true)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Mark as applied
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* Frozen Submission Snapshot Banner (once applied) */}
                {selectedApplication.submittedMaterialsSnapshot ? (
                  <section className="space-y-2 rounded-[8px] border border-[#C4D6CA] bg-[var(--accent-soft)]/50 p-3.5 text-[12px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-[var(--accent)]">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        <span>Frozen submitted materials snapshot</span>
                      </div>
                      <span className="font-data text-[11px] text-[var(--text-secondary)]">
                        {selectedApplication.appliedAt
                          ? `Applied ${formatDateTime(selectedApplication.appliedAt)}`
                          : null}
                        {selectedApplication.submittedMaterialsHash
                          ? ` · sha256:${selectedApplication.submittedMaterialsHash.slice(0, 10)}`
                          : null}
                      </span>
                    </div>

                    <div className="grid gap-2 text-[12px] text-[var(--text-primary)] sm:grid-cols-3">
                      <div className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] p-2">
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          Resume snapshot
                        </div>
                        <div className="mt-0.5 font-data font-medium">
                          {selectedApplication.submittedMaterialsSnapshot
                            .resumeVersionNumber
                            ? `v${selectedApplication.submittedMaterialsSnapshot.resumeVersionNumber}`
                            : selectedApplication.submittedMaterialsSnapshot
                                  .resumeVersionId
                              ? "Attached"
                              : "None"}
                          {selectedApplication.submittedMaterialsSnapshot
                            .resumeContentHash
                            ? ` (${selectedApplication.submittedMaterialsSnapshot.resumeContentHash.slice(0, 8)})`
                            : ""}
                        </div>
                      </div>
                      <div className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] p-2">
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          Cover letter
                        </div>
                        <div className="mt-0.5 font-data font-medium">
                          {selectedApplication.submittedMaterialsSnapshot
                            .coverLetterId
                            ? `Frozen (${selectedApplication.submittedMaterialsSnapshot.coverLetterContentHash?.slice(0, 8) ?? "saved"})`
                            : "Not included"}
                        </div>
                      </div>
                      <div className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] p-2">
                        <div className="text-[11px] text-[var(--text-tertiary)]">
                          Answers frozen
                        </div>
                        <div className="mt-0.5 font-data font-medium">
                          {
                            selectedApplication.submittedMaterialsSnapshot
                              .answers.length
                          }{" "}
                          responses
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {/* Immutable Resume Version Selector & Notes */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-[12px] font-medium text-[var(--text-primary)]">
                      Attached immutable ResumeVersion
                    </label>
                    {selectedApplication.resumeVersions.length > 0 ? (
                      <Select
                        value={
                          selectedApplication.resumeVersionId ?? "__none__"
                        }
                        onValueChange={(v) => void handleAttachResumeVersion(v)}
                        disabled={savingMeta}
                      >
                        <SelectTrigger className="h-9 text-[12px]">
                          <SelectValue placeholder="Select resume version..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            None attached
                          </SelectItem>
                          {selectedApplication.resumeVersions.map((ver) => (
                            <SelectItem key={ver.id} value={ver.id}>
                              v{ver.versionNumber} · {ver.contentHash.slice(0, 8)}{" "}
                              · {formatShortDate(ver.createdAt)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex items-center justify-between gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                        <span>No exported resume versions yet.</span>
                        <Link
                          href="/resumes"
                          className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          Resumes
                        </Link>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[12px] font-medium text-[var(--text-primary)]">
                      Application notes
                    </label>
                    <div className="flex gap-2">
                      <Textarea
                        value={notesDraft}
                        onChange={(e) => {
                          setNotesEdit({
                            id: selectedApplication.id,
                            text: e.target.value,
                          });
                        }}
                        placeholder="Recruiter contact, interview dates, portal reference..."
                        rows={2}
                        className="min-h-[60px] flex-1 text-[12px]"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!notesDirty || savingMeta}
                        loading={savingMeta}
                        onClick={() => void handleSaveNotes()}
                        className="self-end"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Cover Letter & Application Answers Panel */}
                <CoverLetterAnswersPanel
                  jobId={selectedApplication.jobId}
                  searchProfileId={selectedApplication.searchProfileId}
                  applicationId={selectedApplication.id}
                  coverLetter={selectedApplication.coverLetter}
                  answers={selectedApplication.answers}
                  onCoverLetterUpdated={(nextLetter) =>
                    upsertApplicationInState({
                      ...selectedApplication,
                      coverLetter: nextLetter,
                    })
                  }
                  onAnswersUpdated={(nextAnswers) =>
                    upsertApplicationInState({
                      ...selectedApplication,
                      answers: nextAnswers,
                    })
                  }
                />

                {/* Status Event Timeline */}
                <section className="space-y-2.5 border-t border-[var(--border)] pt-4">
                  <h4 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                    Status timeline ({selectedApplication.events.length})
                  </h4>

                  {selectedApplication.events.length === 0 ? (
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      Created on {formatDateTime(selectedApplication.createdAt)}.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedApplication.events.map((ev) => (
                        <div
                          key={ev.id}
                          className="flex flex-col justify-between gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] sm:flex-row sm:items-center"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Clock
                              className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
                              aria-hidden="true"
                            />
                            {ev.priorStatus ? (
                              <span className="text-[var(--text-secondary)]">
                                {APPLICATION_STATUS_META[ev.priorStatus]?.label ??
                                  ev.priorStatus}{" "}
                                →
                              </span>
                            ) : null}
                            <Badge
                              tone={
                                APPLICATION_STATUS_META[ev.newStatus]?.tone ??
                                "neutral"
                              }
                            >
                              {APPLICATION_STATUS_META[ev.newStatus]?.label ??
                                ev.newStatus}
                            </Badge>
                            {ev.note ? (
                              <span className="text-[var(--text-secondary)]">
                                {ev.note}
                              </span>
                            ) : null}
                          </div>
                          <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                            {formatDateTime(ev.occurredAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmAppliedDialog
        application={selectedApplication}
        open={confirmAppliedOpen}
        onOpenChange={setConfirmAppliedOpen}
        onConfirmed={(updated) => upsertApplicationInState(updated)}
      />
    </div>
  );
}
