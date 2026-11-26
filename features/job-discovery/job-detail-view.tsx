"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Building2,
  Clock,
  ExternalLink,
  GitMerge,
  MapPin,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  computeFreshness,
  formatDateTime,
  formatSalaryRange,
  formatShortDate,
  formatWorkplaceLabel,
  isSafeExternalHttpUrl,
  type JobDetailItem,
  type JobStatus,
  type UserJobDiscoveryState,
} from "./types";

const ALLOWED_HTML_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "code",
  "pre",
  "a",
  "div",
  "span",
  "hr",
]);

/**
 * Defense-in-depth client sanitization for already server-sanitized HTML descriptions.
 * Strips unsafe tags, event handlers, and non-http(s) links before rendering.
 */
function hardenSanitizedHtml(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const walk = (node: Element) => {
      const children = Array.from(node.children);
      for (const child of children) {
        const tag = child.tagName.toLowerCase();
        if (!ALLOWED_HTML_TAGS.has(tag)) {
          if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object" || tag === "embed") {
            child.remove();
            continue;
          }
          // Replace unknown wrapper tags with their children text/nodes
          const fragment = doc.createDocumentFragment();
          while (child.firstChild) {
            fragment.appendChild(child.firstChild);
          }
          child.replaceWith(fragment);
          continue;
        }

        // Strip all attributes except safe href on <a>
        for (const attr of Array.from(child.attributes)) {
          const attrName = attr.name.toLowerCase();
          if (tag === "a" && attrName === "href") {
            const safe = isSafeExternalHttpUrl(attr.value);
            if (safe) {
              child.setAttribute("href", safe);
              child.setAttribute("target", "_blank");
              child.setAttribute("rel", "noopener noreferrer");
            } else {
              child.removeAttribute("href");
            }
          } else {
            child.removeAttribute(attr.name);
          }
        }

        walk(child);
      }
    };

    walk(doc.body);
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

function jobStatusBadge(status: JobStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case "open":
      return { label: "Open", tone: "accent" };
    case "possibly_closed":
      return { label: "Possibly closed", tone: "warning" };
    case "closed":
      return { label: "Closed", tone: "danger" };
    case "unknown":
      return { label: "Status unknown", tone: "neutral" };
  }
}

export interface JobDetailViewProps {
  job: JobDetailItem;
  variant?: "drawer" | "page";
  pendingAction?: boolean;
  onChangeState: (nextState: UserJobDiscoveryState | "active") => void;
  onReviewDuplicates?: () => void;
}

/**
 * Shared canonical job detail view used inside both the desktop right-side drawer
 * and the responsive full-page /jobs/[id] route.
 */
export function JobDetailView({
  job,
  variant = "drawer",
  pendingAction = false,
  onChangeState,
  onReviewDuplicates,
}: JobDetailViewProps) {
  const safeApplyUrl =
    isSafeExternalHttpUrl(job.applyUrl) ??
    isSafeExternalHttpUrl(job.canonicalUrl);
  const freshness = computeFreshness(job.employerPostedAt);
  const statusMeta = jobStatusBadge(job.status);

  const disclosedSalary = formatSalaryRange(
    job.salaryMin,
    job.salaryMax,
    job.salaryCurrency,
    job.salaryPeriod
  );
  const overrideSalary = job.compensationOverride
    ? formatSalaryRange(
        job.compensationOverride.minAmount,
        job.compensationOverride.maxAmount,
        job.compensationOverride.currency,
        job.compensationOverride.period
      )
    : null;

  const isSaved = job.userState === "saved";
  const isDismissed = job.userState === "dismissed" || job.userState === "hidden";

  const proposedDuplicates = job.duplicateCandidates.filter(
    (d) => d.state === "proposed"
  );
  const duplicateCount = Math.max(
    proposedDuplicates.length,
    job.duplicateCandidateCount
  );

  const hardenedHtml = React.useMemo(() => {
    if (!job.descriptionHtmlSanitized) return null;
    return hardenSanitizedHtml(job.descriptionHtmlSanitized);
  }, [job.descriptionHtmlSanitized]);

  return (
    <div className={cn("space-y-6", variant === "page" && "pb-10")}>
      {/* Canonical header */}
      <div className="space-y-3 border-b border-[var(--border)] pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
          <Badge tone={freshness.tone}>{freshness.label}</Badge>
          {job.userState === "saved" ? (
            <Badge tone="accent">Saved</Badge>
          ) : job.userState === "dismissed" ? (
            <Badge tone="neutral">Dismissed</Badge>
          ) : null}
          {typeof job.documentedFitScore === "number" ? (
            <Badge tone="neutral" className="font-data">
              Fit {Math.round(job.documentedFitScore)}%
            </Badge>
          ) : null}
        </div>

        <div>
          <h2
            className={cn(
              "font-semibold tracking-tight text-[var(--text-primary)]",
              variant === "page" ? "text-[22px] leading-7" : "text-[18px] leading-6"
            )}
          >
            {job.title}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
              <Building2 className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
              {job.companyName}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
              {job.locationText || "Location unknown"}
            </span>
            <span>{formatWorkplaceLabel(job.workplaceType)}</span>
            {job.employmentType ? <span>{job.employmentType}</span> : null}
          </div>
        </div>

        {/* Primary & secondary actions (at most one primary action) */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {safeApplyUrl ? (
            <a
              href={safeApplyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--accent)] bg-[var(--accent)] px-3.5 text-[13px] font-medium text-[var(--on-accent)] transition-colors hover:bg-[#365545] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <span>Open original posting</span>
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : (
            <Button variant="secondary" size="md" disabled>
              No external apply URL
            </Button>
          )}

          {isSaved ? (
            <Button
              variant="secondary"
              size="md"
              disabled={pendingAction}
              onClick={() => onChangeState("active")}
            >
              <BookmarkCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
              Saved (Undo)
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="md"
              disabled={pendingAction}
              onClick={() => onChangeState("saved")}
            >
              <Bookmark className="h-4 w-4" aria-hidden="true" />
              Save job
            </Button>
          )}

          {isDismissed ? (
            <Button
              variant="ghost"
              size="md"
              disabled={pendingAction}
              onClick={() => onChangeState("active")}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reopen
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="md"
              disabled={pendingAction}
              onClick={() => onChangeState("dismissed")}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Dismiss
            </Button>
          )}

          {variant === "drawer" ? (
            <Link
              href={`/jobs/${encodeURIComponent(job.id)}`}
              className="ml-auto inline-flex h-8 items-center gap-1 rounded-[4px] px-2 text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <span>Full view</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      {/* Soft-merge redirect notice if ever viewed via alias */}
      {job.mergedIntoJobId ? (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] px-3.5 py-2.5 text-[13px]"
        >
          <span>This record was merged into a canonical job posting.</span>
          <Link
            href={`/jobs/${encodeURIComponent(job.mergedIntoJobId)}`}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            View canonical job
          </Link>
        </div>
      ) : null}

      {/* Needs duplicate review notice */}
      {duplicateCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] px-3.5 py-2.5 text-[13px] text-[var(--text-primary)]">
          <div className="flex items-center gap-2">
            <GitMerge
              className="h-4 w-4 shrink-0 text-[var(--warning)]"
              aria-hidden="true"
            />
            <span>
              Needs duplicate review ({duplicateCount} possible match
              {duplicateCount === 1 ? "" : "es"}).
            </span>
          </div>
          {onReviewDuplicates ? (
            <Button variant="secondary" size="sm" onClick={onReviewDuplicates}>
              Review duplicates
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Metadata grid: Compensation + Freshness provenance */}
      <div
        className={cn(
          "grid gap-4",
          variant === "page" ? "lg:grid-cols-2" : "grid-cols-1"
        )}
      >
        {/* Compensation & provenance */}
        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
            Compensation &amp; provenance
          </h3>
          <div className="mt-2.5 space-y-2.5 text-[13px]">
            {disclosedSalary ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-data text-[15px] font-semibold text-[var(--text-primary)]">
                  {disclosedSalary}
                </span>
                <Badge tone="accent">Employer/source disclosed</Badge>
              </div>
            ) : !overrideSalary ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--text-secondary)]">
                  Not disclosed by source
                </span>
                <Badge tone="neutral">Unknown</Badge>
              </div>
            ) : null}

            {overrideSalary ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--border)] pt-2">
                <div>
                  <span className="font-data text-[14px] font-semibold text-[var(--text-primary)]">
                    {overrideSalary}
                  </span>
                  {job.compensationOverride?.note ? (
                    <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                      {job.compensationOverride.note}
                    </p>
                  ) : null}
                </div>
                <Badge tone="neutral">User supplied</Badge>
              </div>
            ) : null}

            {job.seniorityLevel ||
            job.seniorityMinYears !== null ||
            job.seniorityMaxYears !== null ? (
              <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--text-secondary)]">
                <span>Experience / Seniority</span>
                <span className="font-data text-[var(--text-primary)]">
                  {[
                    job.seniorityLevel,
                    job.seniorityMinYears !== null || job.seniorityMaxYears !== null
                      ? `${job.seniorityMinYears ?? "?"}–${job.seniorityMaxYears ?? "?"} yrs`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ) : null}
          </div>
        </section>

        {/* Freshness provenance breakdown */}
        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
              Freshness provenance
            </h3>
            <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
          </div>

          {!job.employerPostedAt ? (
            <p className="mt-2 rounded-[4px] border border-[var(--border)] bg-[var(--canvas)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]">
              Posting date not provided; first discovered{" "}
              <span className="font-data text-[var(--text-primary)]">
                {formatShortDate(job.firstSeenAt)}
              </span>
              .
            </p>
          ) : null}

          {job.dateConflict ? (
            <div
              role="status"
              className="mt-2 space-y-1 rounded-[4px] border border-[#DFC99B] bg-[#F5EFE2] px-2.5 py-2 text-[12px] text-[var(--text-primary)]"
            >
              <div className="flex items-center gap-1.5 font-medium text-[var(--warning)]">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Posting date conflict across sources</span>
              </div>
              {job.dateConflict.summary ? (
                <p className="text-[var(--text-secondary)]">
                  {job.dateConflict.summary}
                </p>
              ) : null}
              {job.dateConflict.entries.length > 0 ? (
                <ul className="space-y-0.5 font-data text-[11px] text-[var(--text-secondary)]">
                  {job.dateConflict.entries.map((entry, idx) => (
                    <li key={`${entry.sourceId ?? "src"}-${idx}`}>
                      {entry.sourceName ?? entry.sourceId ?? "Source"}:{" "}
                      {formatShortDate(entry.postedAt)}
                      {entry.rawText ? ` (${entry.rawText})` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <dl className="mt-2.5 divide-y divide-[var(--border)] text-[12px]">
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--text-secondary)]">Employer posted</dt>
              <dd className="font-data text-[var(--text-primary)]">
                {job.employerPostedAt
                  ? formatDateTime(job.employerPostedAt)
                  : "Not provided"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--text-secondary)]">First discovered</dt>
              <dd className="font-data text-[var(--text-primary)]">
                {formatDateTime(job.firstSeenAt)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--text-secondary)]">Last seen</dt>
              <dd className="font-data text-[var(--text-primary)]">
                {formatDateTime(job.lastSeenAt)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5">
              <dt className="text-[var(--text-secondary)]">Last verified</dt>
              <dd className="font-data text-[var(--text-primary)]">
                {formatDateTime(job.lastVerifiedAt)}
              </dd>
            </div>
            {job.sourceUpdatedAt ? (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt
                  className="text-[var(--text-secondary)]"
                  title="Source update timestamp; not equivalent to original posting date"
                >
                  Source updated
                </dt>
                <dd className="font-data text-[var(--text-primary)]">
                  {formatDateTime(job.sourceUpdatedAt)}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      {/* Source lineage */}
      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
            Source lineage
          </h3>
          <span className="font-data text-[11px] text-[var(--text-tertiary)]">
            {job.sourceRecords.length > 0
              ? `${job.sourceRecords.length} source record${job.sourceRecords.length === 1 ? "" : "s"}`
              : `${job.sourceCount} linked`}
          </span>
        </div>

        {job.sourceRecords.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
            {job.primarySourceName
              ? `Primary source: ${job.primarySourceName}`
              : "Manual or primary source record."}
          </p>
        ) : (
          <div className="mt-2.5 divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {job.sourceRecords.map((rec) => {
              const safeSourceUrl = isSafeExternalHttpUrl(rec.sourceUrl);
              const safeRecApplyUrl = isSafeExternalHttpUrl(rec.applyUrl);
              return (
                <div
                  key={rec.id}
                  className="flex flex-col gap-1.5 py-2.5 text-[12px] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)]">
                        {rec.sourceName ?? rec.sourceType ?? "Source"}
                      </span>
                      <Badge
                        tone={
                          rec.recordStatus === "open"
                            ? "accent"
                            : rec.recordStatus === "possibly_closed"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {rec.recordStatus}
                      </Badge>
                      <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                        ext: {rec.externalId}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-data text-[11px] text-[var(--text-secondary)]">
                      <span>
                        Posted:{" "}
                        {rec.sourcePostedAt
                          ? formatShortDate(rec.sourcePostedAt)
                          : rec.sourcePostedAtText ?? "Not provided"}
                      </span>
                      <span>Last seen: {formatShortDate(rec.lastSeenAt)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {safeSourceUrl ? (
                      <a
                        href={safeSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
                      >
                        <span>Source URL</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : null}
                    {safeRecApplyUrl && safeRecApplyUrl !== safeSourceUrl ? (
                      <a
                        href={safeRecApplyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
                      >
                        <span>Apply URL</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Extracted requirements preview if present */}
      {job.requirements.length > 0 ? (
        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
              Extracted requirements
            </h3>
            <span className="font-data text-[11px] text-[var(--text-tertiary)]">
              {job.requirements.length} items
            </span>
          </div>
          <ul className="mt-2.5 divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {job.requirements.map((req) => (
              <li
                key={req.id}
                className="flex items-start justify-between gap-3 py-2 text-[13px]"
              >
                <span className="text-[var(--text-primary)]">
                  {req.requirementText}
                </span>
                <Badge tone="neutral" className="shrink-0">
                  {req.priority.replaceAll("_", " ")}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Job description (sanitized HTML container or plain text fallback) */}
      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
          Job description
        </h3>
        {hardenedHtml ? (
          <div
            className={cn(
              "mt-3 max-w-none text-[14px] leading-6 text-[var(--text-primary)]",
              "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-[17px] [&_h1]:font-semibold",
              "[&_h2]:mt-4 [&_h2]:mb-1.5 [&_h2]:text-[15px] [&_h2]:font-semibold",
              "[&_h3]:mt-3.5 [&_h3]:mb-1 [&_h3]:text-[14px] [&_h3]:font-semibold",
              "[&_p]:my-2.5 [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
              "[&_a]:text-[var(--accent)] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border-strong)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-secondary)]",
              "[&_pre]:overflow-x-auto [&_pre]:rounded-[4px] [&_pre]:bg-[var(--surface-muted)] [&_pre]:p-3 [&_code]:font-data [&_code]:text-[12px]"
            )}
            dangerouslySetInnerHTML={{ __html: hardenedHtml }}
          />
        ) : job.descriptionText ? (
          <div className="mt-3 text-[14px] leading-6 whitespace-pre-wrap text-[var(--text-primary)]">
            {job.descriptionText}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-[var(--text-secondary)]">
            No job description text was provided by the source.
          </p>
        )}
      </section>
    </div>
  );
}
