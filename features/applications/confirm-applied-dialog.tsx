"use client";

import * as React from "react";
import { AlertTriangle, ExternalLink, Lock, ShieldCheck } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  formatShortDate,
  isSafeExternalHttpUrl,
} from "@/features/job-discovery/types";
import { transitionApplicationStatus } from "./api";
import type { ApplicationRecord } from "./types";

export interface ConfirmAppliedDialogProps {
  application: ApplicationRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: (updated: ApplicationRecord) => void;
}

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ConfirmAppliedForm({
  application,
  onOpenChange,
  onConfirmed,
}: {
  application: ApplicationRecord;
  onOpenChange: (open: boolean) => void;
  onConfirmed: (updated: ApplicationRecord) => void;
}) {
  const { toast } = useToast();

  const [selectedResumeVersionId, setSelectedResumeVersionId] = React.useState(
    () =>
      application.resumeVersionId ??
      application.resumeVersions[0]?.id ??
      "__none__"
  );
  const [includeCoverLetter, setIncludeCoverLetter] = React.useState(() =>
    Boolean(application.coverLetter)
  );
  const [includeAnswers, setIncludeAnswers] = React.useState(
    () => application.answers.length > 0
  );
  const [appliedAtLocal, setAppliedAtLocal] = React.useState(() =>
    toLocalDateTimeInputValue(new Date())
  );
  const [note, setNote] = React.useState("");
  const [confirmedChecked, setConfirmedChecked] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const safeApplyUrl = isSafeExternalHttpUrl(application.originalApplyUrl);
  const chosenVersion = application.resumeVersions.find(
    (v) => v.id === selectedResumeVersionId
  );
  const answeredWithText = application.answers.filter(
    (a) => a.answerText.trim().length > 0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmedChecked) {
      toast({
        title: "Confirm manual submission first",
        description:
          "Check the confirmation box to freeze the submitted materials snapshot.",
        tone: "warning",
      });
      return;
    }

    const parsedDate = appliedAtLocal ? new Date(appliedAtLocal) : new Date();
    const appliedAtIso = Number.isNaN(parsedDate.getTime())
      ? new Date().toISOString()
      : parsedDate.toISOString();

    setSubmitting(true);
    try {
      const updated = await transitionApplicationStatus(application.id, {
        status: "applied",
        confirmSubmission: true,
        appliedAt: appliedAtIso,
        resumeVersionId:
          selectedResumeVersionId !== "__none__"
            ? selectedResumeVersionId
            : null,
        coverLetterId:
          includeCoverLetter && application.coverLetter
            ? application.coverLetter.id
            : null,
        answerIds: includeAnswers ? answeredWithText.map((a) => a.id) : [],
        note: note.trim() || null,
      });

      toast({
        title: "Application marked as applied",
        description: `Frozen submission snapshot recorded for ${application.jobTitle}.`,
        tone: "accent",
      });
      onConfirmed(updated);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not mark application as applied",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
      <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3 text-[13px]">
        <div className="font-semibold text-[var(--text-primary)]">
          {application.jobTitle}
        </div>
        <div className="mt-0.5 text-[var(--text-secondary)]">
          {application.companyName}
          {application.locationText ? ` · ${application.locationText}` : ""}
        </div>
        {safeApplyUrl ? (
          <div className="mt-2 flex items-center gap-1.5 text-[12px]">
            <span className="text-[var(--text-tertiary)]">Apply URL:</span>
            <a
              href={safeApplyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-[var(--accent)] hover:underline"
            >
              <span className="truncate">{safeApplyUrl}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
        ) : (
          <div className="mt-2 text-[12px] text-[var(--text-tertiary)]">
            No external apply URL recorded.
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-[var(--text-primary)]">
          Submitted immutable resume version
        </label>
        {application.resumeVersions.length > 0 ? (
          <Select
            value={selectedResumeVersionId}
            onValueChange={setSelectedResumeVersionId}
          >
            <SelectTrigger className="h-9 text-[13px]">
              <SelectValue placeholder="Select resume version..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                No tailored resume version attached
              </SelectItem>
              {application.resumeVersions.map((ver) => (
                <SelectItem key={ver.id} value={ver.id}>
                  v{ver.versionNumber} · {ver.contentHash.slice(0, 8)} ·{" "}
                  {formatShortDate(ver.createdAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex items-start gap-2 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] p-2.5 text-[12px] text-[var(--text-primary)]">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
              aria-hidden="true"
            />
            <span>
              No immutable resume version exists for this job yet. Export a
              draft in Resume Studio to snapshot a version, or proceed without
              linking a tailored version.
            </span>
          </div>
        )}
        {chosenVersion ? (
          <div className="flex items-center gap-1.5 font-data text-[11px] text-[var(--text-secondary)]">
            <Lock className="h-3 w-3 text-[var(--accent)]" aria-hidden="true" />
            <span>
              Immutable v{chosenVersion.versionNumber} (sha256:
              {chosenVersion.contentHash.slice(0, 12)})
            </span>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="text-[12px] font-medium text-[var(--text-primary)]">
          Attached materials to freeze in snapshot
        </div>

        {application.coverLetter ? (
          <label className="flex cursor-pointer items-start gap-2.5 text-[12px]">
            <input
              type="checkbox"
              checked={includeCoverLetter}
              onChange={(e) => setIncludeCoverLetter(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--control-border)] accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
                <span>Cover letter</span>
                <Badge tone="neutral" className="font-data text-[10px]">
                  {application.coverLetter.contentHash.slice(0, 8)}
                </Badge>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[var(--text-secondary)]">
                {application.coverLetter.text || "Empty cover letter"}
              </p>
            </div>
          </label>
        ) : (
          <p className="text-[12px] text-[var(--text-tertiary)]">
            No tailored cover letter drafted for this job.
          </p>
        )}

        {answeredWithText.length > 0 ? (
          <label className="flex cursor-pointer items-start gap-2.5 border-t border-[var(--border)] pt-2 text-[12px]">
            <input
              type="checkbox"
              checked={includeAnswers}
              onChange={(e) => setIncludeAnswers(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--control-border)] accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[var(--text-primary)]">
                Application answers ({answeredWithText.length})
              </div>
              <p className="mt-0.5 text-[var(--text-secondary)]">
                {answeredWithText.map((a) => a.promptText).join(" · ")}
              </p>
            </div>
          </label>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            htmlFor="confirm-applied-at"
            className="block text-[12px] font-medium text-[var(--text-primary)]"
          >
            Date &amp; time submitted
          </label>
          <Input
            id="confirm-applied-at"
            type="datetime-local"
            value={appliedAtLocal}
            onChange={(e) => setAppliedAtLocal(e.target.value)}
            className="font-data text-[12px]"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="confirm-applied-note"
            className="block text-[12px] font-medium text-[var(--text-primary)]"
          >
            Submission note (optional)
          </label>
          <Textarea
            id="confirm-applied-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g., Submitted via Greenhouse portal"
            rows={1}
            className="min-h-[36px] py-1.5 text-[13px]"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-[6px] border border-[var(--border)] bg-[var(--accent-soft)]/50 p-3 text-[12px]">
        <input
          type="checkbox"
          checked={confirmedChecked}
          onChange={(e) => setConfirmedChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-[var(--control-border)] accent-[var(--accent)]"
        />
        <span className="text-[var(--text-primary)]">
          I confirm that I personally completed and submitted this application
          on the employer&apos;s site, and I want to record the frozen
          submission snapshot above.
        </span>
      </label>

      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          disabled={!confirmedChecked}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Confirm &amp; mark applied
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ConfirmAppliedDialog({
  application,
  open,
  onOpenChange,
  onConfirmed,
}: ConfirmAppliedDialogProps) {
  if (!application) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm manual application submission</DialogTitle>
          <DialogDescription>
            This app never submits applications automatically. Confirm the exact
            materials you submitted directly on the employer portal to freeze an
            immutable audit snapshot.
          </DialogDescription>
        </DialogHeader>

        <ConfirmAppliedForm
          key={`${application.id}-${open ? "open" : "closed"}`}
          application={application}
          onOpenChange={onOpenChange}
          onConfirmed={onConfirmed}
        />
      </DialogContent>
    </Dialog>
  );
}
