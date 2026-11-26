"use client";

import * as React from "react";
import {
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  Eye,
  FileText,
  Pencil,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type {
  EvidenceLinkRecord,
  FactOrigin,
  SourceDocumentRecord,
  VerificationStatus,
} from "./types";

const STATUS_META: Record<
  VerificationStatus,
  {
    label: string;
    tone: BadgeTone;
    Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  }
> = {
  verified: {
    label: "Verified",
    tone: "accent",
    Icon: CheckCircle2,
  },
  needs_review: {
    label: "Needs review",
    tone: "warning",
    Icon: AlertCircle,
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    Icon: XCircle,
  },
  archived: {
    label: "Archived",
    tone: "neutral",
    Icon: Archive,
  },
};

const ORIGIN_LABELS: Record<FactOrigin, string> = {
  manual: "Manual",
  resume_import: "Resume import",
  document_import: "Document import",
};

export interface VerificationBadgeProps {
  status: VerificationStatus;
  className?: string;
}

/**
 * Quiet-workbench verification status pill reserving semantic color strictly for state.
 */
export function VerificationBadge({ status, className }: VerificationBadgeProps) {
  const meta = STATUS_META[status] ?? STATUS_META.needs_review;
  const Icon = meta.Icon;
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden={true} />
      <span>{meta.label}</span>
    </Badge>
  );
}

export interface OriginTagProps {
  origin: FactOrigin;
  className?: string;
}

/**
 * Subtle provenance label showing whether a fact was entered manually or imported.
 */
export function OriginTag({ origin, className }: OriginTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-data text-[11px] leading-4 text-[var(--text-tertiary)] whitespace-nowrap",
        className
      )}
    >
      {ORIGIN_LABELS[origin] ?? "Manual"}
    </span>
  );
}

export interface VerificationActionBarProps {
  status: VerificationStatus;
  busyStatus?: VerificationStatus | "delete" | null;
  onSetStatus: (next: VerificationStatus) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  compact?: boolean;
}

/**
 * 1-click verification and editing action controls for profile facts.
 */
export function VerificationActionBar({
  status,
  busyStatus = null,
  onSetStatus,
  onEdit,
  onDelete,
  compact = false,
}: VerificationActionBarProps) {
  const isBusy = busyStatus !== null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status !== "verified" ? (
        <Button
          size="sm"
          variant="primary"
          loading={busyStatus === "verified"}
          disabled={isBusy}
          onClick={() => onSetStatus("verified")}
          className={compact ? "h-7 px-2 text-[12px]" : undefined}
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Verify</span>
        </Button>
      ) : null}

      {onEdit ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={isBusy}
          onClick={onEdit}
          className={compact ? "h-7 px-2 text-[12px]" : undefined}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Edit</span>
        </Button>
      ) : null}

      {status === "verified" || status === "rejected" || status === "archived" ? (
        <Button
          size="sm"
          variant="ghost"
          loading={busyStatus === "needs_review"}
          disabled={isBusy}
          onClick={() => onSetStatus("needs_review")}
          title="Move back to Needs review"
          className={compact ? "h-7 px-2 text-[12px]" : undefined}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Review</span>
        </Button>
      ) : null}

      {status !== "rejected" ? (
        <Button
          size="sm"
          variant="ghost"
          loading={busyStatus === "rejected"}
          disabled={isBusy}
          onClick={() => onSetStatus("rejected")}
          className={cn(
            "text-[var(--text-secondary)] hover:text-[var(--danger)]",
            compact && "h-7 px-2 text-[12px]"
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Reject</span>
        </Button>
      ) : null}

      {status !== "archived" ? (
        <Button
          size="sm"
          variant="ghost"
          loading={busyStatus === "archived"}
          disabled={isBusy}
          onClick={() => onSetStatus("archived")}
          className={compact ? "h-7 px-2 text-[12px]" : undefined}
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Archive</span>
        </Button>
      ) : null}

      {onDelete ? (
        <Button
          size="sm"
          variant="ghost"
          loading={busyStatus === "delete"}
          disabled={isBusy}
          onClick={onDelete}
          aria-label="Delete entry"
          title="Delete entry"
          className={cn(
            "text-[var(--text-tertiary)] hover:text-[var(--danger)]",
            compact && "h-7 px-2 text-[12px]"
          )}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

export interface EvidenceAccordionProps {
  links: EvidenceLinkRecord[];
  documentsById: Map<string, SourceDocumentRecord>;
  onInspectInSource?: (sourceDocumentId: string, excerpt?: string | null) => void;
}

/**
 * Inline accordion displaying source document provenance, verbatim excerpts,
 * and parser confidence (explicitly framed as parser confidence, not truth).
 */
export function EvidenceAccordion({
  links,
  documentsById,
  onInspectInSource,
}: EvidenceAccordionProps) {
  if (links.length === 0) return null;

  return (
    <Accordion type="single" collapsible className="mt-2.5 border-t border-[var(--border)]">
      <AccordionItem value="evidence" className="border-b-0">
        <AccordionTrigger className="py-2 text-[12px] font-medium text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
            <span>
              Evidence &amp; source excerpts{" "}
              <span className="font-data text-[var(--text-tertiary)]">
                ({links.length})
              </span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pt-0.5">
          <div className="divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)]">
            {links.map((link) => {
              const doc = link.sourceDocumentId
                ? documentsById.get(link.sourceDocumentId)
                : undefined;
              const confidencePct =
                typeof link.extractionConfidence === "number"
                  ? Math.round(
                      link.extractionConfidence <= 1
                        ? link.extractionConfidence * 100
                        : link.extractionConfidence
                    )
                  : null;

              return (
                <div key={link.id} className="space-y-1.5 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium text-[var(--text-primary)]">
                        {doc ? doc.displayFilename : "Manual / unlinked excerpt"}
                      </span>
                      <OriginTag origin={link.origin} />
                      {confidencePct !== null ? (
                        <span
                          className="font-data text-[12px] text-[var(--text-tertiary)]"
                          title="Automated extraction confidence score; requires user verification"
                        >
                          Parser confidence {confidencePct}%
                        </span>
                      ) : null}
                    </div>
                    {doc && onInspectInSource ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onInspectInSource(doc.id, link.excerpt)}
                        className="h-6 px-2 text-[12px] text-[var(--accent)]"
                      >
                        <Eye className="h-3 w-3" aria-hidden="true" />
                        <span>View in document</span>
                      </Button>
                    ) : null}
                  </div>
                  {link.excerpt ? (
                    <blockquote className="border-l-2 border-[var(--border-strong)] pl-2.5 font-data text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
                      {link.excerpt}
                    </blockquote>
                  ) : (
                    <p className="text-[12px] text-[var(--text-tertiary)]">
                      No excerpt captured for this reference.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
