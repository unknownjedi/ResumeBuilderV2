"use client";

import * as React from "react";
import { AlertTriangle, Link2 } from "lucide-react";
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
import { importManualJob } from "./api";
import type {
  DuplicateCandidateItem,
  JobDetailItem,
  WorkplaceType,
} from "./types";

export interface ManualImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (
    job: JobDetailItem,
    duplicateCandidates: DuplicateCandidateItem[]
  ) => void;
}

function isRestrictedPortalUrl(rawUrl: string): boolean {
  const lower = rawUrl.trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("linkedin.com") ||
    lower.includes("naukri.com") ||
    lower.includes("lnkd.in")
  );
}

/**
 * Modal dialog for manually importing a job from a public URL and/or pasted description.
 * Explicitly supports LinkedIn and Naukri URLs as stored references alongside pasted JD text.
 */
export function ManualImportDialog({
  open,
  onOpenChange,
  onImported,
}: ManualImportDialogProps) {
  const [url, setUrl] = React.useState("");
  const [descriptionText, setDescriptionText] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [companyName, setCompanyName] = React.useState("");
  const [locationText, setLocationText] = React.useState("");
  const [workplaceType, setWorkplaceType] =
    React.useState<WorkplaceType>("unspecified");
  const [employmentType, setEmploymentType] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const resetForm = React.useCallback(() => {
    setUrl("");
    setDescriptionText("");
    setTitle("");
    setCompanyName("");
    setLocationText("");
    setWorkplaceType("unspecified");
    setEmploymentType("");
    setError(null);
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const restrictedUrlDetected = isRestrictedPortalUrl(url);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUrl = url.trim();
    const trimmedJd = descriptionText.trim();

    if (!trimmedUrl && !trimmedJd) {
      setError("Paste a job description or provide a public job URL.");
      return;
    }

    if (restrictedUrlDetected && !trimmedJd) {
      setError(
        "LinkedIn and Naukri URLs are stored as references only and are not scraped. Please paste the job description text below."
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await importManualJob({
        url: trimmedUrl || undefined,
        descriptionText: trimmedJd || undefined,
        title: title.trim() || undefined,
        companyName: companyName.trim() || undefined,
        locationText: locationText.trim() || undefined,
        workplaceType,
        employmentType: employmentType.trim() || undefined,
      });

      resetForm();
      onOpenChange(false);
      onImported(result.job, result.duplicateCandidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import job.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import job posting</DialogTitle>
          <DialogDescription>
            Paste a job description and/or a public job URL. For LinkedIn or Naukri, paste the job description text and store the URL as a reference — restricted sites are never fetched automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="import-job-url"
              className="block text-[13px] font-medium text-[var(--text-primary)]"
            >
              Job URL or LinkedIn / Naukri reference URL
            </label>
            <div className="relative">
              <Link2
                className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--text-tertiary)]"
                aria-hidden="true"
              />
              <Input
                id="import-job-url"
                type="url"
                className="pl-9 font-data"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://boards.greenhouse.io/... or https://www.linkedin.com/jobs/view/..."
              />
            </div>
            {restrictedUrlDetected ? (
              <div className="flex items-start gap-2 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] px-3 py-2 text-[12px] text-[var(--text-primary)]">
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]"
                  aria-hidden="true"
                />
                <span>
                  LinkedIn/Naukri URL detected. It will be saved as the apply reference URL; paste the job description text below so it can be analyzed locally.
                </span>
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="import-job-description"
              className="block text-[13px] font-medium text-[var(--text-primary)]"
            >
              Pasted job description
              {restrictedUrlDetected ? " (required for LinkedIn / Naukri)" : ""}
            </label>
            <Textarea
              id="import-job-description"
              rows={7}
              value={descriptionText}
              onChange={(e) => setDescriptionText(e.target.value)}
              placeholder="Paste the full role responsibilities, qualifications, and compensation details if listed..."
            />
          </div>

          <div className="grid gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="import-job-title"
                className="block text-[12px] font-medium text-[var(--text-secondary)]"
              >
                Job title (optional override)
              </label>
              <Input
                id="import-job-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Backend Engineer"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="import-job-company"
                className="block text-[12px] font-medium text-[var(--text-secondary)]"
              >
                Company (optional override)
              </label>
              <Input
                id="import-job-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Acme Corp"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="import-job-location"
                className="block text-[12px] font-medium text-[var(--text-secondary)]"
              >
                Location (optional)
              </label>
              <Input
                id="import-job-location"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder="e.g. Bengaluru / Remote"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="import-job-workplace"
                className="block text-[12px] font-medium text-[var(--text-secondary)]"
              >
                Workplace type
              </label>
              <Select
                value={workplaceType}
                onValueChange={(val) => setWorkplaceType(val as WorkplaceType)}
              >
                <SelectTrigger id="import-job-workplace">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unspecified">Unspecified</SelectItem>
                  <SelectItem value="remote">Remote</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="onsite">Onsite</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-3 py-2 text-[12px] text-[var(--danger)]"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              Import job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
