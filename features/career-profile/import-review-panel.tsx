"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Highlighter,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import {
  createProfileEntity,
  deleteSourceDocument,
  getSourceDocument,
  importResumeFile,
  saveProfileHeader,
  setEntityVerification,
  updateProfileEntity,
} from "./api";
import {
  formatBytes,
  formatDateRange,
  formatShortDate,
  type AchievementRecord,
  type CareerProfilePayload,
  type CertificationRecord,
  type EducationRecord,
  type EvidenceLinkRecord,
  type EvidenceTargetType,
  type ExperienceRecord,
  type ImportResumeResponse,
  type LanguageRecord,
  type ProfileEntityRoute,
  type ProjectRecord,
  type SkillRecord,
  type VerificationStatus,
} from "./types";
import {
  OriginTag,
  VerificationActionBar,
  VerificationBadge,
} from "./verification-badge";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];

function isAllowedResumeFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractCreatedId(res: Record<string, unknown>): string | null {
  if (typeof res.id === "string" && res.id) return res.id;
  for (const key of [
    "item",
    "record",
    "data",
    "experience",
    "project",
    "achievement",
    "skill",
    "education",
    "certification",
    "language",
  ]) {
    const nested = asRecord(res[key]);
    if (nested && typeof nested.id === "string" && nested.id) {
      return nested.id;
    }
  }
  return null;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespaceForSearch(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findHighlightRanges(
  text: string,
  query: string
): Array<{ start: number; end: number }> {
  const trimmed = query.trim();
  if (!trimmed || !text) return [];

  // Direct case-insensitive substring matches first
  const exactRanges: Array<{ start: number; end: number }> = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  let index = 0;
  while (index < lowerText.length) {
    const found = lowerText.indexOf(lowerQuery, index);
    if (found === -1) break;
    exactRanges.push({ start: found, end: found + lowerQuery.length });
    index = found + Math.max(1, lowerQuery.length);
    if (exactRanges.length >= 200) break;
  }
  if (exactRanges.length > 0) return exactRanges;

  // Fallback: whitespace-flexible regex for multi-line PDF excerpts
  const tokens = normalizeWhitespaceForSearch(trimmed)
    .split(" ")
    .filter(Boolean)
    .slice(0, 24);
  if (tokens.length === 0) return [];
  try {
    const pattern = new RegExp(tokens.map(escapeRegExp).join("\\s+"), "gi");
    const match = pattern.exec(text);
    if (match && match[0]) {
      return [{ start: match.index, end: match.index + match[0].length }];
    }
  } catch {
    return [];
  }
  return [];
}

interface HighlightedTextViewProps {
  text: string;
  excerptHighlight: string;
  searchQuery: string;
  activeMatchIndex: number;
  viewMode: "mono" | "prose";
  onCaptureSelection: (selected: string) => void;
}

function HighlightedTextView({
  text,
  excerptHighlight,
  searchQuery,
  activeMatchIndex,
  viewMode,
  onCaptureSelection,
}: HighlightedTextViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const activeQuery = excerptHighlight.trim() || searchQuery.trim();
  const isExcerptMode = Boolean(excerptHighlight.trim());

  const ranges = React.useMemo(
    () => findHighlightRanges(text, activeQuery),
    [text, activeQuery]
  );

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || ranges.length === 0) return;
    const targetMark = container.querySelector<HTMLElement>(
      `mark[data-match-idx="${isExcerptMode ? 0 : activeMatchIndex}"]`
    );
    if (targetMark) {
      targetMark.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeMatchIndex, isExcerptMode, ranges]);

  const handleMouseUp = React.useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const selectedText = selection.toString().trim();
    if (!selectedText) return;
    if (
      containerRef.current &&
      selection.anchorNode &&
      containerRef.current.contains(selection.anchorNode)
    ) {
      onCaptureSelection(selectedText.slice(0, 1200));
    }
  }, [onCaptureSelection]);

  const segments = React.useMemo(() => {
    if (ranges.length === 0) {
      return [{ text, highlighted: false, matchIdx: -1 }];
    }
    const out: Array<{ text: string; highlighted: boolean; matchIdx: number }> = [];
    let cursor = 0;
    ranges.forEach((range, idx) => {
      if (range.start > cursor) {
        out.push({
          text: text.slice(cursor, range.start),
          highlighted: false,
          matchIdx: -1,
        });
      }
      out.push({
        text: text.slice(range.start, range.end),
        highlighted: true,
        matchIdx: idx,
      });
      cursor = range.end;
    });
    if (cursor < text.length) {
      out.push({
        text: text.slice(cursor),
        highlighted: false,
        matchIdx: -1,
      });
    }
    return out;
  }, [ranges, text]);

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      className={cn(
        "h-[460px] overflow-y-auto rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-4 text-[var(--text-primary)] whitespace-pre-wrap break-words select-text",
        viewMode === "mono"
          ? "font-data text-[12px] leading-relaxed"
          : "text-[14px] leading-relaxed"
      )}
    >
      {segments.map((seg, idx) =>
        seg.highlighted ? (
          <mark
            key={`${seg.matchIdx}-${idx}`}
            data-match-idx={seg.matchIdx}
            className={cn(
              "rounded-[2px] px-0.5 text-[var(--text-primary)]",
              isExcerptMode
                ? "bg-[var(--accent-soft)] ring-1 ring-[#9BB8A6]"
                : seg.matchIdx === activeMatchIndex
                  ? "bg-[#DFC99B] ring-1 ring-[var(--warning)]"
                  : "bg-[#F5EFE2]"
            )}
          >
            {seg.text}
          </mark>
        ) : (
          <React.Fragment key={idx}>{seg.text}</React.Fragment>
        )
      )}
    </div>
  );
}

type ManualFactType =
  | "experiences"
  | "projects"
  | "achievements"
  | "skills"
  | "education"
  | "certifications"
  | "languages";

const MANUAL_FACT_TARGET_TYPE: Record<ManualFactType, EvidenceTargetType> = {
  experiences: "experience",
  projects: "project",
  achievements: "achievement",
  skills: "skill",
  education: "education",
  certifications: "certification",
  languages: "language",
};

interface PendingFactItem {
  id: string;
  entity: ProfileEntityRoute | "profile";
  targetType: EvidenceTargetType;
  sectionLabel: string;
  title: string;
  subtitle?: string;
  detail?: string;
  verificationStatus: VerificationStatus;
  origin: "manual" | "resume_import" | "document_import";
  evidence: EvidenceLinkRecord[];
  raw:
    | ExperienceRecord
    | ProjectRecord
    | AchievementRecord
    | SkillRecord
    | EducationRecord
    | CertificationRecord
    | LanguageRecord
    | CareerProfilePayload["profile"];
}

export interface ImportReviewPanelProps {
  data: CareerProfilePayload;
  selectedDocId: string;
  onSelectDocId: (id: string) => void;
  excerptHighlight: string;
  onChangeExcerptHighlight: (excerpt: string) => void;
  onRefresh: () => Promise<void>;
  onClose?: () => void;
}

/**
 * Side-by-side resume import, raw text inspection, AI-assisted review queue,
 * and manual document fact entry workbench.
 */
export function ImportReviewPanel({
  data,
  selectedDocId: requestedDocId,
  onSelectDocId: setSelectedDocId,
  excerptHighlight,
  onChangeExcerptHighlight: setExcerptHighlight,
  onRefresh,
  onClose,
}: ImportReviewPanelProps) {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [useAiStructuring, setUseAiStructuring] = React.useState(true);
  const [dragActive, setDragActive] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [lastImportResult, setLastImportResult] =
    React.useState<ImportResumeResponse | null>(null);

  const [fetchedDocState, setFetchedDocState] = React.useState<{
    docId: string;
    text: string;
    error: string | null;
  } | null>(null);
  const [deletingDoc, setDeletingDoc] = React.useState(false);

  const [textViewMode, setTextViewMode] = React.useState<"mono" | "prose">("mono");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [rawMatchIndex, setActiveMatchIndex] = React.useState(0);
  const [capturedSelection, setCapturedSelection] = React.useState("");

  const [scopeToSelectedDoc, setScopeToSelectedDoc] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [editDraft, setEditDraft] = React.useState<Record<string, string>>({});

  // Manual fact creation from document
  const [manualFormOpen, setManualFormOpen] = React.useState(false);
  const [manualType, setManualType] = React.useState<ManualFactType>("experiences");
  const [manualFields, setManualFields] = React.useState<Record<string, string>>({
    primary: "",
    secondary: "",
    startDate: "",
    endDate: "",
    details: "",
    metricValue: "",
    metricUnit: "",
    metricContext: "",
    excerpt: "",
  });
  const [manualMarkVerified, setManualMarkVerified] = React.useState(true);
  const [savingManual, setSavingManual] = React.useState(false);

  const selectedDocId = React.useMemo(() => {
    if (
      requestedDocId &&
      data.sourceDocuments.some((doc) => doc.id === requestedDocId)
    ) {
      return requestedDocId;
    }
    return data.sourceDocuments[0]?.id ?? "";
  }, [data.sourceDocuments, requestedDocId]);

  const selectedDocument = React.useMemo(
    () => data.sourceDocuments.find((doc) => doc.id === selectedDocId) ?? null,
    [data.sourceDocuments, selectedDocId]
  );

  const freshImportText = React.useMemo(() => {
    if (
      lastImportResult &&
      lastImportResult.sourceDocument.id === selectedDocId &&
      typeof lastImportResult.extractedText === "string"
    ) {
      return lastImportResult.extractedText;
    }
    return null;
  }, [lastImportResult, selectedDocId]);

  // Load extracted text whenever selectedDocId changes
  React.useEffect(() => {
    if (!selectedDocId || freshImportText !== null) {
      return;
    }

    let cancelled = false;
    getSourceDocument(selectedDocId)
      .then((res) => {
        if (cancelled) return;
        setFetchedDocState({
          docId: selectedDocId,
          text: res.extractedText,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetchedDocState({
          docId: selectedDocId,
          text: "",
          error:
            err instanceof Error
              ? err.message
              : "Unable to load source document text.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [freshImportText, selectedDocId]);

  const docText = !selectedDocId
    ? ""
    : freshImportText !== null
      ? freshImportText
      : fetchedDocState?.docId === selectedDocId
        ? fetchedDocState.text
        : "";

  const docLoadError =
    selectedDocId &&
    freshImportText === null &&
    fetchedDocState?.docId === selectedDocId
      ? fetchedDocState.error
      : null;

  const docLoading = Boolean(
    selectedDocId &&
      freshImportText === null &&
      fetchedDocState?.docId !== selectedDocId
  );

  const searchMatchesCount = React.useMemo(() => {
    if (excerptHighlight.trim() || !searchQuery.trim() || !docText) return 0;
    return findHighlightRanges(docText, searchQuery).length;
  }, [docText, excerptHighlight, searchQuery]);

  const activeMatchIndex =
    searchMatchesCount > 0 ? rawMatchIndex % searchMatchesCount : 0;

  const handleFileUpload = React.useCallback(
    async (file: File) => {
      setImportError(null);

      if (!isAllowedResumeFile(file)) {
        setImportError(
          "Unsupported file format. Please upload a PDF, DOCX, TXT, or Markdown (.md) file."
        );
        return;
      }

      if (file.size > MAX_FILE_BYTES) {
        setImportError(
          `File is ${formatBytes(file.size)}. Maximum allowed file size is 15 MiB.`
        );
        return;
      }

      setImporting(true);
      try {
        const result = await importResumeFile(file, useAiStructuring);
        setLastImportResult(result);
        setSelectedDocId(result.sourceDocument.id);
        setFetchedDocState({
          docId: result.sourceDocument.id,
          text: result.extractedText,
          error: null,
        });
        setExcerptHighlight("");

        await onRefresh();

        if (result.extractionStatus === "scanned_pdf") {
          toast({
            title: "Scanned PDF detected",
            description: "Provide a text-based PDF or DOCX.",
            tone: "warning",
          });
        } else if (result.extractionStatus === "failed") {
          toast({
            title: "Extraction failed",
            description:
              result.sourceDocument.errorMessage ||
              "Could not extract text from this document.",
            tone: "danger",
          });
        } else {
          const totalCreated = Object.values(result.createdCounts).reduce(
            (sum, n) => sum + n,
            0
          );
          if (!useAiStructuring || totalCreated === 0) {
            setManualFormOpen(true);
          }
          toast({
            title: "Document imported",
            description:
              totalCreated > 0
                ? `${totalCreated} item${totalCreated === 1 ? "" : "s"} queued under Needs review.`
                : "Raw text extracted and ready for manual fact entry.",
            tone: "accent",
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to import resume.";
        setImportError(message);
        toast({
          title: "Import failed",
          description: message,
          tone: "danger",
        });
      } finally {
        setImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [onRefresh, setExcerptHighlight, setSelectedDocId, toast, useAiStructuring]
  );

  const handleDeleteDocument = React.useCallback(async () => {
    if (!selectedDocument) return;
    setDeletingDoc(true);
    try {
      await deleteSourceDocument(selectedDocument.id);
      if (lastImportResult?.sourceDocument.id === selectedDocument.id) {
        setLastImportResult(null);
      }
      toast({
        title: "Source document removed",
        description: selectedDocument.displayFilename,
        tone: "neutral",
      });
      await onRefresh();
    } catch (err) {
      toast({
        title: "Could not delete document",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setDeletingDoc(false);
    }
  }, [lastImportResult, onRefresh, selectedDocument, toast]);

  // Index evidence links by `${targetType}:${targetId}`
  const evidenceByTarget = React.useMemo(() => {
    const map = new Map<string, EvidenceLinkRecord[]>();
    for (const link of data.evidenceLinks) {
      const key = `${link.targetType}:${link.targetId}`;
      const existing = map.get(key);
      if (existing) existing.push(link);
      else map.set(key, [link]);
    }
    return map;
  }, [data.evidenceLinks]);

  // Build grouped Needs review items
  const pendingItems = React.useMemo<PendingFactItem[]>(() => {
    const items: PendingFactItem[] = [];

    if (
      data.profile.verificationStatus === "needs_review" &&
      (data.profile.fullName ||
        data.profile.headline ||
        data.profile.email ||
        data.profile.summary)
    ) {
      items.push({
        id: String(data.profile.id),
        entity: "profile",
        targetType: "profile",
        sectionLabel: "Contact & Headline",
        title: data.profile.fullName || "Profile header",
        subtitle: [data.profile.headline, data.profile.email, data.profile.location]
          .filter(Boolean)
          .join(" · "),
        detail: data.profile.summary ?? undefined,
        verificationStatus: data.profile.verificationStatus,
        origin: data.profile.origin,
        evidence:
          evidenceByTarget.get(`profile:${data.profile.id}`) ??
          evidenceByTarget.get("profile:1") ??
          [],
        raw: data.profile,
      });
    }

    for (const exp of data.experiences) {
      if (exp.verificationStatus !== "needs_review") continue;
      items.push({
        id: exp.id,
        entity: "experiences",
        targetType: "experience",
        sectionLabel: "Work Experience",
        title: `${exp.title} — ${exp.employer}`,
        subtitle: [
          formatDateRange(exp.startDate, exp.endDate, exp.isCurrent),
          exp.location,
        ]
          .filter(Boolean)
          .join(" · "),
        detail: exp.description ?? undefined,
        verificationStatus: exp.verificationStatus,
        origin: exp.origin,
        evidence: evidenceByTarget.get(`experience:${exp.id}`) ?? [],
        raw: exp,
      });
    }

    for (const proj of data.projects) {
      if (proj.verificationStatus !== "needs_review") continue;
      items.push({
        id: proj.id,
        entity: "projects",
        targetType: "project",
        sectionLabel: "Projects",
        title: proj.name,
        subtitle: formatDateRange(proj.startDate, proj.endDate) || undefined,
        detail: proj.description || proj.problem || proj.outcomes || undefined,
        verificationStatus: proj.verificationStatus,
        origin: proj.origin,
        evidence: evidenceByTarget.get(`project:${proj.id}`) ?? [],
        raw: proj,
      });
    }

    for (const ach of data.achievements) {
      if (ach.verificationStatus !== "needs_review") continue;
      const metricSummary =
        ach.metricValue !== null
          ? `${ach.metricValue}${ach.metricUnit ? ` ${ach.metricUnit}` : ""}${
              ach.metricContext ? ` (${ach.metricContext})` : ""
            }`
          : undefined;
      items.push({
        id: ach.id,
        entity: "achievements",
        targetType: "achievement",
        sectionLabel: "Achievements",
        title: ach.text,
        subtitle: metricSummary,
        verificationStatus: ach.verificationStatus,
        origin: ach.origin,
        evidence: evidenceByTarget.get(`achievement:${ach.id}`) ?? [],
        raw: ach,
      });
    }

    for (const skill of data.skills) {
      if (skill.verificationStatus !== "needs_review") continue;
      items.push({
        id: skill.id,
        entity: "skills",
        targetType: "skill",
        sectionLabel: "Skills",
        title: skill.canonicalName,
        subtitle: skill.category || undefined,
        verificationStatus: skill.verificationStatus,
        origin: skill.origin,
        evidence: evidenceByTarget.get(`skill:${skill.id}`) ?? [],
        raw: skill,
      });
    }

    for (const edu of data.education) {
      if (edu.verificationStatus !== "needs_review") continue;
      items.push({
        id: edu.id,
        entity: "education",
        targetType: "education",
        sectionLabel: "Education",
        title: `${edu.qualification}${edu.fieldOfStudy ? `, ${edu.fieldOfStudy}` : ""}`,
        subtitle: [edu.institution, formatDateRange(edu.startDate, edu.endDate)]
          .filter(Boolean)
          .join(" · "),
        detail: edu.details ?? undefined,
        verificationStatus: edu.verificationStatus,
        origin: edu.origin,
        evidence: evidenceByTarget.get(`education:${edu.id}`) ?? [],
        raw: edu,
      });
    }

    for (const cert of data.certifications) {
      if (cert.verificationStatus !== "needs_review") continue;
      items.push({
        id: cert.id,
        entity: "certifications",
        targetType: "certification",
        sectionLabel: "Certifications",
        title: cert.name,
        subtitle: [cert.issuer, cert.issueDate].filter(Boolean).join(" · "),
        verificationStatus: cert.verificationStatus,
        origin: cert.origin,
        evidence: evidenceByTarget.get(`certification:${cert.id}`) ?? [],
        raw: cert,
      });
    }

    for (const lang of data.languages) {
      if (lang.verificationStatus !== "needs_review") continue;
      items.push({
        id: lang.id,
        entity: "languages",
        targetType: "language",
        sectionLabel: "Languages",
        title: lang.language,
        subtitle: lang.proficiency || undefined,
        verificationStatus: lang.verificationStatus,
        origin: lang.origin,
        evidence: evidenceByTarget.get(`language:${lang.id}`) ?? [],
        raw: lang,
      });
    }

    return items;
  }, [data, evidenceByTarget]);

  const visiblePendingItems = React.useMemo(() => {
    if (!scopeToSelectedDoc || !selectedDocId) return pendingItems;
    return pendingItems.filter((item) =>
      item.evidence.some((ev) => ev.sourceDocumentId === selectedDocId)
    );
  }, [pendingItems, scopeToSelectedDoc, selectedDocId]);

  const groupedPending = React.useMemo(() => {
    const groups = new Map<string, PendingFactItem[]>();
    for (const item of visiblePendingItems) {
      const list = groups.get(item.sectionLabel);
      if (list) list.push(item);
      else groups.set(item.sectionLabel, [item]);
    }
    return Array.from(groups.entries());
  }, [visiblePendingItems]);

  const handleSetStatus = React.useCallback(
    async (
      entity: ProfileEntityRoute | "profile",
      id: string,
      nextStatus: VerificationStatus
    ) => {
      const key = `${entity}:${id}`;
      setBusyKey(key);
      try {
        await setEntityVerification(entity, id, nextStatus);
        await onRefresh();
        toast({
          title:
            nextStatus === "verified"
              ? "Fact verified"
              : nextStatus === "rejected"
                ? "Fact rejected"
                : nextStatus === "archived"
                  ? "Fact archived"
                  : "Moved to Needs review",
          tone: nextStatus === "verified" ? "accent" : "neutral",
        });
      } catch (err) {
        toast({
          title: "Verification update failed",
          description: err instanceof Error ? err.message : "Unknown error.",
          tone: "danger",
        });
      } finally {
        setBusyKey(null);
      }
    },
    [onRefresh, toast]
  );

  const startInlineEdit = React.useCallback((item: PendingFactItem) => {
    const key = `${item.entity}:${item.id}`;
    setEditingKey(key);
    switch (item.entity) {
      case "profile": {
        const p = item.raw as CareerProfilePayload["profile"];
        setEditDraft({
          fullName: p.fullName,
          headline: p.headline ?? "",
          email: p.email ?? "",
          location: p.location ?? "",
          summary: p.summary ?? "",
        });
        break;
      }
      case "experiences": {
        const e = item.raw as ExperienceRecord;
        setEditDraft({
          title: e.title,
          employer: e.employer,
          startDate: e.startDate ?? "",
          endDate: e.endDate ?? "",
          description: e.description ?? "",
        });
        break;
      }
      case "projects": {
        const p = item.raw as ProjectRecord;
        setEditDraft({
          name: p.name,
          description: p.description ?? "",
          outcomes: p.outcomes ?? "",
        });
        break;
      }
      case "achievements": {
        const a = item.raw as AchievementRecord;
        setEditDraft({
          text: a.text,
          metricValue: a.metricValue !== null ? String(a.metricValue) : "",
          metricUnit: a.metricUnit ?? "",
          metricContext: a.metricContext ?? "",
        });
        break;
      }
      case "skills": {
        const s = item.raw as SkillRecord;
        setEditDraft({
          canonicalName: s.canonicalName,
          category: s.category ?? "",
        });
        break;
      }
      case "education": {
        const ed = item.raw as EducationRecord;
        setEditDraft({
          institution: ed.institution,
          qualification: ed.qualification,
          fieldOfStudy: ed.fieldOfStudy ?? "",
        });
        break;
      }
      case "certifications": {
        const c = item.raw as CertificationRecord;
        setEditDraft({
          name: c.name,
          issuer: c.issuer ?? "",
          issueDate: c.issueDate ?? "",
        });
        break;
      }
      case "languages": {
        const l = item.raw as LanguageRecord;
        setEditDraft({
          language: l.language,
          proficiency: l.proficiency ?? "",
        });
        break;
      }
    }
  }, []);

  const saveInlineEdit = React.useCallback(
    async (item: PendingFactItem, alsoVerify: boolean) => {
      const key = `${item.entity}:${item.id}`;
      setBusyKey(key);
      try {
        if (item.entity === "profile") {
          await saveProfileHeader({
            fullName: editDraft.fullName?.trim() ?? "",
            headline: editDraft.headline?.trim() || null,
            email: editDraft.email?.trim() || null,
            location: editDraft.location?.trim() || null,
            summary: editDraft.summary?.trim() || null,
          });
        } else if (item.entity === "experiences") {
          await updateProfileEntity("experiences", item.id, {
            title: editDraft.title?.trim() ?? "",
            employer: editDraft.employer?.trim() ?? "",
            startDate: editDraft.startDate?.trim() || null,
            endDate: editDraft.endDate?.trim() || null,
            description: editDraft.description?.trim() || null,
          });
        } else if (item.entity === "projects") {
          await updateProfileEntity("projects", item.id, {
            name: editDraft.name?.trim() ?? "",
            description: editDraft.description?.trim() || null,
            outcomes: editDraft.outcomes?.trim() || null,
          });
        } else if (item.entity === "achievements") {
          const parsedMetric = editDraft.metricValue?.trim()
            ? Number(editDraft.metricValue.trim())
            : null;
          await updateProfileEntity("achievements", item.id, {
            text: editDraft.text?.trim() ?? "",
            metricValue:
              parsedMetric !== null && Number.isFinite(parsedMetric)
                ? parsedMetric
                : null,
            metricUnit: editDraft.metricUnit?.trim() || null,
            metricContext: editDraft.metricContext?.trim() || null,
          });
        } else if (item.entity === "skills") {
          await updateProfileEntity("skills", item.id, {
            canonicalName: editDraft.canonicalName?.trim() ?? "",
            category: editDraft.category?.trim() || null,
          });
        } else if (item.entity === "education") {
          await updateProfileEntity("education", item.id, {
            institution: editDraft.institution?.trim() ?? "",
            qualification: editDraft.qualification?.trim() ?? "",
            fieldOfStudy: editDraft.fieldOfStudy?.trim() || null,
          });
        } else if (item.entity === "certifications") {
          await updateProfileEntity("certifications", item.id, {
            name: editDraft.name?.trim() ?? "",
            issuer: editDraft.issuer?.trim() || null,
            issueDate: editDraft.issueDate?.trim() || null,
          });
        } else if (item.entity === "languages") {
          await updateProfileEntity("languages", item.id, {
            language: editDraft.language?.trim() ?? "",
            proficiency: editDraft.proficiency?.trim() || null,
          });
        }

        if (alsoVerify) {
          await setEntityVerification(item.entity, item.id, "verified");
        }

        setEditingKey(null);
        await onRefresh();
        toast({
          title: alsoVerify ? "Fact updated & verified" : "Fact updated",
          tone: "accent",
        });
      } catch (err) {
        toast({
          title: "Save failed",
          description: err instanceof Error ? err.message : "Unknown error.",
          tone: "danger",
        });
      } finally {
        setBusyKey(null);
      }
    },
    [editDraft, onRefresh, toast]
  );

  const handleUseCapturedSelection = React.useCallback(() => {
    if (!capturedSelection) return;
    setManualFormOpen(true);
    setManualFields((prev) => ({
      ...prev,
      excerpt: capturedSelection,
      primary:
        prev.primary ||
        (manualType === "achievements"
          ? capturedSelection.split("\n")[0].slice(0, 200)
          : prev.primary),
    }));
  }, [capturedSelection, manualType]);

  const handleSaveManualFact = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const primary = manualFields.primary.trim();
      if (!primary) {
        toast({
          title: "Missing required field",
          description: "Enter the primary title or statement before saving.",
          tone: "warning",
        });
        return;
      }

      setSavingManual(true);
      try {
        const origin = selectedDocId ? "document_import" : "manual";
        const verificationStatus: VerificationStatus = manualMarkVerified
          ? "verified"
          : "needs_review";

        let payload: Record<string, unknown>;
        switch (manualType) {
          case "experiences":
            payload = {
              title: primary,
              employer: manualFields.secondary.trim() || "Unspecified employer",
              startDate: manualFields.startDate.trim() || null,
              endDate: manualFields.endDate.trim() || null,
              description: manualFields.details.trim() || null,
              origin,
              verificationStatus,
            };
            break;
          case "projects":
            payload = {
              name: primary,
              roleContribution: manualFields.secondary.trim() || null,
              startDate: manualFields.startDate.trim() || null,
              endDate: manualFields.endDate.trim() || null,
              description: manualFields.details.trim() || null,
              origin,
              verificationStatus,
            };
            break;
          case "achievements": {
            const metricNum = manualFields.metricValue.trim()
              ? Number(manualFields.metricValue.trim())
              : null;
            payload = {
              text: primary,
              metricValue:
                metricNum !== null && Number.isFinite(metricNum)
                  ? metricNum
                  : null,
              metricUnit: manualFields.metricUnit.trim() || null,
              metricContext: manualFields.metricContext.trim() || null,
              origin,
              verificationStatus,
            };
            break;
          }
          case "skills":
            payload = {
              canonicalName: primary,
              category: manualFields.secondary.trim() || null,
              origin,
              verificationStatus,
            };
            break;
          case "education":
            payload = {
              qualification: primary,
              institution: manualFields.secondary.trim() || "Unspecified institution",
              startDate: manualFields.startDate.trim() || null,
              endDate: manualFields.endDate.trim() || null,
              details: manualFields.details.trim() || null,
              origin,
              verificationStatus,
            };
            break;
          case "certifications":
            payload = {
              name: primary,
              issuer: manualFields.secondary.trim() || null,
              issueDate: manualFields.startDate.trim() || null,
              expiryDate: manualFields.endDate.trim() || null,
              origin,
              verificationStatus,
            };
            break;
          case "languages":
            payload = {
              language: primary,
              proficiency: manualFields.secondary.trim() || null,
              origin,
              verificationStatus,
            };
            break;
        }

        const created = await createProfileEntity(manualType, payload);
        const createdId = extractCreatedId(created);

        if (createdId && (selectedDocId || manualFields.excerpt.trim())) {
          try {
            await createProfileEntity("evidence-links", {
              sourceDocumentId: selectedDocId || null,
              targetType: MANUAL_FACT_TARGET_TYPE[manualType],
              targetId: createdId,
              excerpt: manualFields.excerpt.trim() || null,
              verificationStatus,
              origin,
            });
          } catch {
            // Do not fail the saved fact if linking the optional evidence excerpt fails
          }
        }

        setManualFields({
          primary: "",
          secondary: "",
          startDate: "",
          endDate: "",
          details: "",
          metricValue: "",
          metricUnit: "",
          metricContext: "",
          excerpt: "",
        });
        setCapturedSelection("");
        await onRefresh();
        toast({
          title: "Manual fact added",
          description: manualMarkVerified
            ? "Saved as Verified with document provenance."
            : "Saved to Needs review queue.",
          tone: "accent",
        });
      } catch (err) {
        toast({
          title: "Could not save fact",
          description: err instanceof Error ? err.message : "Unknown error.",
          tone: "danger",
        });
      } finally {
        setSavingManual(false);
      }
    },
    [manualFields, manualMarkVerified, manualType, onRefresh, selectedDocId, toast]
  );

  const isNoAiMode =
    !useAiStructuring ||
    lastImportResult?.aiStatus === "raw_text_only" ||
    lastImportResult?.aiStatus === "failed_raw_preserved" ||
    lastImportResult?.aiStatus === "skipped" ||
    lastImportResult?.aiStatus === "disabled" ||
    lastImportResult?.aiStatus === "unavailable";

  const [applyingSuggestions, setApplyingSuggestions] = React.useState(false);

  const handleApplySuggestions = React.useCallback(async () => {
    const suggestions = lastImportResult?.profileSuggestions;
    if (!suggestions) return;
    setApplyingSuggestions(true);
    try {
      const patch: Record<string, unknown> = {
        origin: "resume_import",
        verificationStatus: "needs_review",
      };
      if (suggestions.headline?.value) {
        patch.headline = suggestions.headline.value;
      }
      if (suggestions.summary?.value) {
        patch.summary = suggestions.summary.value;
      }
      if (suggestions.location?.value) {
        patch.location = suggestions.location.value;
      }
      await saveProfileHeader(patch);
      setLastImportResult((prev) =>
        prev ? { ...prev, profileSuggestions: null } : prev
      );
      await onRefresh();
      toast({
        title: "Header suggestions saved to Needs review",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not apply suggestions",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setApplyingSuggestions(false);
    }
  }, [lastImportResult, onRefresh, toast]);

  return (
    <section
      aria-label="Resume import and verification workbench"
      className="space-y-5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      {/* Panel header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <h3 className="text-[16px] font-semibold text-[var(--text-primary)]">
            Import &amp; side-by-side verification
          </h3>
          <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
            Upload a PDF, DOCX, TXT, or Markdown resume. Source text is always preserved locally; extracted facts stay in{" "}
            <span className="font-medium text-[var(--text-primary)]">Needs review</span>{" "}
            until you verify them.
          </p>
        </div>
        {onClose ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
            <span>Close import view</span>
          </Button>
        ) : null}
      </div>

      {/* Upload zone + explicit AI toggle */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void handleFileUpload(dropped);
          }}
          className={cn(
            "lg:col-span-7 flex flex-col justify-between gap-3 rounded-[6px] border border-dashed p-4 transition-colors",
            dragActive
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-[var(--control-border)] bg-[var(--surface-raised)]"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]">
                <Upload className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[14px] font-medium text-[var(--text-primary)]">
                  Drop a resume or career document here
                </p>
                <p className="mt-0.5 font-data text-[12px] text-[var(--text-tertiary)]">
                  PDF (text-based), DOCX, TXT, MD · Max 15 MiB
                </p>
              </div>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileUpload(file);
                }}
              />
              <Button
                variant="primary"
                size="sm"
                loading={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{importing ? "Importing..." : "Choose file"}</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Explicit structuring mode toggle */}
        <div className="lg:col-span-5 flex flex-col justify-between gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <SlidersHorizontal
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <div>
                <label
                  htmlFor="toggle-ai-structuring"
                  className="block cursor-pointer text-[13px] font-medium text-[var(--text-primary)]"
                >
                  {useAiStructuring
                    ? "Run AI structuring if configured"
                    : "Extract raw text only"}
                </label>
                <p className="mt-0.5 text-[12px] leading-4 text-[var(--text-secondary)]">
                  {useAiStructuring
                    ? "Uses your configured AI provider (with consent) to propose Needs review facts alongside verbatim source excerpts."
                    : "No-AI mode: stores the document and extracts raw text so you can add verified facts manually."}
                </p>
              </div>
            </div>
            <Switch
              id="toggle-ai-structuring"
              checked={useAiStructuring}
              onCheckedChange={setUseAiStructuring}
              aria-label="Run AI structuring if configured"
            />
          </div>
        </div>
      </div>

      {/* Actionable error / scanned PDF / AI status banners */}
      {importError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-3.5 py-2.5 text-[13px] text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">{importError}</div>
        </div>
      ) : null}

      {selectedDocument?.extractionStatus === "scanned_pdf" ||
      lastImportResult?.extractionStatus === "scanned_pdf" ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] px-3.5 py-3 text-[13px] text-[var(--text-primary)]"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium text-[var(--warning)]">
              Scanned or image-only PDF detected — no selectable text found
            </p>
            <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
              Provide a text-based PDF or DOCX (or TXT/MD export) so your experience can be extracted accurately. OCR for scanned images is not included in MVP.
            </p>
          </div>
        </div>
      ) : null}

      {selectedDocument?.extractionStatus === "failed" ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-3.5 py-2.5 text-[13px] text-[var(--danger)]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Document text extraction failed</p>
            <p className="mt-0.5 text-[12px]">
              {selectedDocument.errorMessage ||
                "The file could not be parsed. Try exporting as DOCX or text-based PDF."}
            </p>
          </div>
        </div>
      ) : null}

      {lastImportResult?.aiError ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] px-3.5 py-2.5 text-[13px] text-[var(--text-primary)]"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium text-[var(--warning)]">
              AI structuring did not run — raw text is preserved below
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              {lastImportResult.aiError}. You can add facts manually from the extracted document text on the right.
            </p>
          </div>
        </div>
      ) : null}

      {/* Side-by-side Document Text & Needs-Review / Manual Entry split */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* LEFT PANE: Source Document Selector & Extracted Text Viewer */}
        <div className="lg:col-span-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText
                className="h-4 w-4 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                Source document text
              </span>
            </div>
            {selectedDocument ? (
              <div className="flex items-center gap-2">
                <Badge
                  tone={
                    selectedDocument.extractionStatus === "extracted"
                      ? "accent"
                      : selectedDocument.extractionStatus === "scanned_pdf"
                        ? "warning"
                        : selectedDocument.extractionStatus === "failed"
                          ? "danger"
                          : "neutral"
                  }
                >
                  {selectedDocument.extractionStatus === "scanned_pdf"
                    ? "Scanned PDF"
                    : selectedDocument.extractionStatus}
                </Badge>
                <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                  {formatBytes(selectedDocument.fileSizeBytes)}
                </span>
              </div>
            ) : null}
          </div>

          {/* Document selector + delete */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={selectedDocId}
                onValueChange={(val) => {
                  setSelectedDocId(val);
                  setExcerptHighlight("");
                }}
                disabled={data.sourceDocuments.length === 0}
              >
                <SelectTrigger aria-label="Select source document">
                  <SelectValue placeholder="No source documents imported yet" />
                </SelectTrigger>
                <SelectContent>
                  {data.sourceDocuments.map((doc) => (
                    <SelectItem key={doc.id} value={doc.id}>
                      {doc.displayFilename} ({formatShortDate(doc.importedAt)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedDocument ? (
              <Button
                size="icon"
                variant="outline"
                loading={deletingDoc}
                onClick={handleDeleteDocument}
                title="Delete source document"
                aria-label="Delete selected source document"
                className="text-[var(--text-secondary)] hover:text-[var(--danger)]"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>

          {/* Search & view controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search
                className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-[var(--text-tertiary)]"
                aria-hidden="true"
              />
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setExcerptHighlight("");
                  setActiveMatchIndex(0);
                  setSearchQuery(e.target.value);
                }}
                placeholder="Search extracted text..."
                aria-label="Search extracted text"
                className="pl-8 pr-8"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setActiveMatchIndex(0);
                  }}
                  aria-label="Clear text search"
                  className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {searchQuery && !excerptHighlight ? (
              <div className="flex items-center gap-1 font-data text-[12px] text-[var(--text-secondary)]">
                <span>
                  {searchMatchesCount > 0
                    ? `${activeMatchIndex + 1}/${searchMatchesCount}`
                    : "0 matches"}
                </span>
                {searchMatchesCount > 1 ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Previous match"
                      onClick={() =>
                        setActiveMatchIndex(
                          (prev) =>
                            (prev - 1 + searchMatchesCount) % searchMatchesCount
                        )
                      }
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Next match"
                      onClick={() =>
                        setActiveMatchIndex(
                          (prev) => (prev + 1) % searchMatchesCount
                        )
                      }
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="inline-flex rounded-[6px] border border-[var(--control-border)] bg-[var(--surface-raised)] p-0.5">
              <button
                type="button"
                onClick={() => setTextViewMode("mono")}
                className={cn(
                  "rounded-[4px] px-2 py-1 text-[12px] font-medium transition-colors",
                  textViewMode === "mono"
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                Mono
              </button>
              <button
                type="button"
                onClick={() => setTextViewMode("prose")}
                className={cn(
                  "rounded-[4px] px-2 py-1 text-[12px] font-medium transition-colors",
                  textViewMode === "prose"
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                Prose
              </button>
            </div>
          </div>

          {excerptHighlight ? (
            <div className="flex items-center justify-between gap-2 rounded-[6px] border border-[#C4D6CA] bg-[var(--accent-soft)] px-3 py-1.5 text-[12px] text-[var(--accent)]">
              <span className="inline-flex items-center gap-1.5 truncate">
                <Highlighter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Highlighting excerpt: &ldquo;{excerptHighlight}&rdquo;
                </span>
              </span>
              <button
                type="button"
                onClick={() => setExcerptHighlight("")}
                className="shrink-0 font-medium underline-offset-2 hover:underline"
              >
                Clear
              </button>
            </div>
          ) : null}

          {capturedSelection ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-[12px]">
              <span className="truncate text-[var(--text-secondary)]">
                Text selected ({capturedSelection.length} chars)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleUseCapturedSelection}
                  className="h-7 px-2 text-[12px]"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  <span>Use in manual fact</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setCapturedSelection("")}
                  aria-label="Clear captured selection"
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}

          {/* Document content body */}
          {data.sourceDocuments.length === 0 ? (
            <div className="flex h-[460px] flex-col items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-6 text-center">
              <FileText
                className="h-7 w-7 text-[var(--text-tertiary)]"
                aria-hidden="true"
              />
              <p className="mt-2 text-[14px] font-medium text-[var(--text-primary)]">
                No source document selected
              </p>
              <p className="mt-1 max-w-xs text-[13px] text-[var(--text-secondary)]">
                Upload a PDF, DOCX, TXT, or Markdown file above to view extracted text alongside your career facts.
              </p>
            </div>
          ) : docLoading ? (
            <div className="flex h-[460px] items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-6 text-[13px] text-[var(--text-secondary)]">
              Loading extracted document text...
            </div>
          ) : docLoadError ? (
            <div className="flex h-[460px] flex-col items-center justify-center rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] p-6 text-center text-[13px] text-[var(--danger)]">
              <p className="font-medium">Could not load document text</p>
              <p className="mt-1">{docLoadError}</p>
            </div>
          ) : docText.trim().length === 0 ? (
            <div className="flex h-[460px] flex-col items-center justify-center rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-6 text-center">
              <p className="text-[14px] font-medium text-[var(--text-primary)]">
                No extracted text available
              </p>
              <p className="mt-1 max-w-sm text-[13px] text-[var(--text-secondary)]">
                {selectedDocument?.extractionStatus === "scanned_pdf"
                  ? "This PDF appears to be scanned or image-only. Provide a text-based PDF or DOCX."
                  : "This document has no extracted text."}
              </p>
            </div>
          ) : (
            <HighlightedTextView
              text={docText}
              excerptHighlight={excerptHighlight}
              searchQuery={searchQuery}
              activeMatchIndex={activeMatchIndex}
              viewMode={textViewMode}
              onCaptureSelection={setCapturedSelection}
            />
          )}
        </div>

        {/* RIGHT PANE: Needs-review queue + Add manual fact from document */}
        <div className="lg:col-span-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                Review queue &amp; manual entry
              </span>
              <Badge tone={visiblePendingItems.length > 0 ? "warning" : "neutral"}>
                <span className="font-data">{visiblePendingItems.length}</span>{" "}
                needs review
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {selectedDocId ? (
                <div className="inline-flex rounded-[6px] border border-[var(--control-border)] bg-[var(--surface-raised)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setScopeToSelectedDoc(false)}
                    className={cn(
                      "rounded-[4px] px-2 py-1 text-[12px] font-medium transition-colors",
                      !scopeToSelectedDoc
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    All pending
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeToSelectedDoc(true)}
                    className={cn(
                      "rounded-[4px] px-2 py-1 text-[12px] font-medium transition-colors",
                      scopeToSelectedDoc
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    This document
                  </button>
                </div>
              ) : null}

              <Button
                size="sm"
                variant={manualFormOpen ? "secondary" : "primary"}
                onClick={() => setManualFormOpen((prev) => !prev)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add manual fact from document</span>
              </Button>
            </div>
          </div>

          {/* AI profile header suggestions (headline / summary / location) */}
          {lastImportResult?.profileSuggestions &&
          (lastImportResult.profileSuggestions.headline ||
            lastImportResult.profileSuggestions.summary ||
            lastImportResult.profileSuggestions.location) ? (
            <div className="space-y-2 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-[var(--warning)]">
                  Suggested profile header fields from import
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={applyingSuggestions}
                    onClick={() => void handleApplySuggestions()}
                    className="h-7 px-2 text-[12px]"
                  >
                    <Check className="h-3 w-3" aria-hidden="true" />
                    <span>Stage as Needs review</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setLastImportResult((prev) =>
                        prev ? { ...prev, profileSuggestions: null } : prev
                      )
                    }
                    className="h-7 px-2 text-[12px]"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
              <div className="space-y-1 text-[12px] text-[var(--text-secondary)]">
                {lastImportResult.profileSuggestions.headline ? (
                  <p>
                    <span className="font-medium text-[var(--text-primary)]">
                      Headline:
                    </span>{" "}
                    {lastImportResult.profileSuggestions.headline.value}
                  </p>
                ) : null}
                {lastImportResult.profileSuggestions.location ? (
                  <p>
                    <span className="font-medium text-[var(--text-primary)]">
                      Location:
                    </span>{" "}
                    {lastImportResult.profileSuggestions.location.value}
                  </p>
                ) : null}
                {lastImportResult.profileSuggestions.summary ? (
                  <p>
                    <span className="font-medium text-[var(--text-primary)]">
                      Summary:
                    </span>{" "}
                    {lastImportResult.profileSuggestions.summary.value}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Manual fact creation form (especially surfaced in No-AI / raw text mode) */}
          {manualFormOpen ? (
            <form
              onSubmit={handleSaveManualFact}
              className="space-y-3 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2.5">
                <div>
                  <h4 className="text-[13px] font-semibold text-[var(--text-primary)]">
                    Add manual fact from document
                  </h4>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    {selectedDocument
                      ? `Linked to ${selectedDocument.displayFilename}`
                      : "Highlight text on the left or paste an excerpt below."}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setManualFormOpen(false)}
                  aria-label="Close manual fact form"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                    Section
                  </label>
                  <Select
                    value={manualType}
                    onValueChange={(v) => setManualType(v as ManualFactType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="experiences">Work Experience</SelectItem>
                      <SelectItem value="projects">Project</SelectItem>
                      <SelectItem value="achievements">Achievement</SelectItem>
                      <SelectItem value="skills">Skill</SelectItem>
                      <SelectItem value="education">Education</SelectItem>
                      <SelectItem value="certifications">Certification</SelectItem>
                      <SelectItem value="languages">Language</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                    {manualType === "experiences"
                      ? "Job title *"
                      : manualType === "projects"
                        ? "Project name *"
                        : manualType === "achievements"
                          ? "Achievement statement *"
                          : manualType === "skills"
                            ? "Skill name *"
                            : manualType === "education"
                              ? "Degree / qualification *"
                              : manualType === "certifications"
                                ? "Certification name *"
                                : "Language *"}
                  </label>
                  <Input
                    value={manualFields.primary}
                    onChange={(e) =>
                      setManualFields((p) => ({ ...p, primary: e.target.value }))
                    }
                    placeholder="Required"
                    required
                  />
                </div>
              </div>

              {manualType !== "achievements" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                      {manualType === "experiences"
                        ? "Employer"
                        : manualType === "projects"
                          ? "Role / contribution"
                          : manualType === "skills"
                            ? "Category"
                            : manualType === "education"
                              ? "Institution"
                              : manualType === "certifications"
                                ? "Issuer"
                                : "Proficiency"}
                    </label>
                    <Input
                      value={manualFields.secondary}
                      onChange={(e) =>
                        setManualFields((p) => ({ ...p, secondary: e.target.value }))
                      }
                      placeholder={
                        manualType === "skills"
                          ? "e.g. Backend, Cloud"
                          : manualType === "languages"
                            ? "e.g. Native, Fluent"
                            : "Optional"
                      }
                    />
                  </div>
                  {manualType !== "skills" && manualType !== "languages" ? (
                    <>
                      <div>
                        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                          {manualType === "certifications"
                            ? "Issue date"
                            : "Start date"}
                        </label>
                        <Input
                          value={manualFields.startDate}
                          onChange={(e) =>
                            setManualFields((p) => ({
                              ...p,
                              startDate: e.target.value,
                            }))
                          }
                          placeholder="e.g. 2022-03"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                          {manualType === "certifications"
                            ? "Expiry date"
                            : "End date"}
                        </label>
                        <Input
                          value={manualFields.endDate}
                          onChange={(e) =>
                            setManualFields((p) => ({ ...p, endDate: e.target.value }))
                          }
                          placeholder="e.g. Present"
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                      Metric value
                    </label>
                    <Input
                      type="number"
                      step="any"
                      value={manualFields.metricValue}
                      onChange={(e) =>
                        setManualFields((p) => ({
                          ...p,
                          metricValue: e.target.value,
                        }))
                      }
                      placeholder="e.g. 38"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                      Metric unit
                    </label>
                    <Input
                      value={manualFields.metricUnit}
                      onChange={(e) =>
                        setManualFields((p) => ({ ...p, metricUnit: e.target.value }))
                      }
                      placeholder="e.g. %, ms, USD"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                      Measurement context
                    </label>
                    <Input
                      value={manualFields.metricContext}
                      onChange={(e) =>
                        setManualFields((p) => ({
                          ...p,
                          metricContext: e.target.value,
                        }))
                      }
                      placeholder="e.g. p95 latency"
                    />
                  </div>
                </div>
              )}

              {manualType === "experiences" ||
              manualType === "projects" ||
              manualType === "education" ? (
                <div>
                  <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                    Details / summary
                  </label>
                  <Textarea
                    rows={2}
                    value={manualFields.details}
                    onChange={(e) =>
                      setManualFields((p) => ({ ...p, details: e.target.value }))
                    }
                    placeholder="Concise factual summary"
                  />
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
                  Source excerpt (optional)
                </label>
                <Textarea
                  rows={2}
                  value={manualFields.excerpt}
                  onChange={(e) =>
                    setManualFields((p) => ({ ...p, excerpt: e.target.value }))
                  }
                  placeholder="Select text in the left viewer or paste verbatim excerpt"
                  className="font-data text-[12px]"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={manualMarkVerified}
                    onChange={(e) => setManualMarkVerified(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--control-border)] accent-[var(--accent)]"
                  />
                  <span>Mark immediately as Verified</span>
                </label>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setManualFormOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    variant="primary"
                    loading={savingManual}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Save fact</span>
                  </Button>
                </div>
              </div>
            </form>
          ) : null}

          {/* Needs review queue */}
          <div className="max-h-[520px] space-y-4 overflow-y-auto pr-1">
            {groupedPending.length === 0 ? (
              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-5 text-center">
                <p className="text-[14px] font-medium text-[var(--text-primary)]">
                  {isNoAiMode
                    ? "Raw-text mode active — no pending AI extractions"
                    : "No items awaiting review"}
                </p>
                <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                  {isNoAiMode
                    ? "Select text in the document on the left and use “Add manual fact from document” to record verified profile facts."
                    : scopeToSelectedDoc
                      ? "No Needs review items are linked specifically to this document. Switch to “All pending” or add a manual fact."
                      : "Import a resume with AI structuring enabled or add facts manually from any uploaded document."}
                </p>
                {!manualFormOpen ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setManualFormOpen(true)}
                    className="mt-3"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Add manual fact from document</span>
                  </Button>
                ) : null}
              </div>
            ) : (
              groupedPending.map(([sectionLabel, items]) => (
                <div
                  key={sectionLabel}
                  className="overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)]"
                >
                  <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-3.5 py-2">
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      {sectionLabel}
                    </span>
                    <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                      {items.length}
                    </span>
                  </div>

                  <div className="divide-y divide-[var(--border)]">
                    {items.map((item) => {
                      const key = `${item.entity}:${item.id}`;
                      const isEditing = editingKey === key;
                      const isBusy = busyKey === key;
                      const primaryEvidence =
                        item.evidence.find(
                          (ev) => ev.sourceDocumentId === selectedDocId
                        ) ?? item.evidence[0];
                      const confidencePct =
                        typeof primaryEvidence?.extractionConfidence === "number"
                          ? Math.round(
                              primaryEvidence.extractionConfidence <= 1
                                ? primaryEvidence.extractionConfidence * 100
                                : primaryEvidence.extractionConfidence
                            )
                          : null;

                      return (
                        <div key={key} className="space-y-2 p-3.5">
                          {isEditing ? (
                            <div className="space-y-2.5">
                              {item.entity === "profile" ? (
                                <>
                                  <Input
                                    value={editDraft.fullName ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        fullName: e.target.value,
                                      }))
                                    }
                                    placeholder="Full name"
                                  />
                                  <Input
                                    value={editDraft.headline ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        headline: e.target.value,
                                      }))
                                    }
                                    placeholder="Professional headline"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      value={editDraft.email ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          email: e.target.value,
                                        }))
                                      }
                                      placeholder="Email"
                                    />
                                    <Input
                                      value={editDraft.location ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          location: e.target.value,
                                        }))
                                      }
                                      placeholder="Location"
                                    />
                                  </div>
                                  <Textarea
                                    rows={2}
                                    value={editDraft.summary ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        summary: e.target.value,
                                      }))
                                    }
                                    placeholder="Summary"
                                  />
                                </>
                              ) : item.entity === "experiences" ? (
                                <>
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      value={editDraft.title ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          title: e.target.value,
                                        }))
                                      }
                                      placeholder="Title"
                                    />
                                    <Input
                                      value={editDraft.employer ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          employer: e.target.value,
                                        }))
                                      }
                                      placeholder="Employer"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      value={editDraft.startDate ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          startDate: e.target.value,
                                        }))
                                      }
                                      placeholder="Start date"
                                    />
                                    <Input
                                      value={editDraft.endDate ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          endDate: e.target.value,
                                        }))
                                      }
                                      placeholder="End date"
                                    />
                                  </div>
                                  <Textarea
                                    rows={2}
                                    value={editDraft.description ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        description: e.target.value,
                                      }))
                                    }
                                    placeholder="Description"
                                  />
                                </>
                              ) : item.entity === "projects" ? (
                                <>
                                  <Input
                                    value={editDraft.name ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        name: e.target.value,
                                      }))
                                    }
                                    placeholder="Project name"
                                  />
                                  <Textarea
                                    rows={2}
                                    value={editDraft.description ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        description: e.target.value,
                                      }))
                                    }
                                    placeholder="Description"
                                  />
                                  <Textarea
                                    rows={2}
                                    value={editDraft.outcomes ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        outcomes: e.target.value,
                                      }))
                                    }
                                    placeholder="Outcomes"
                                  />
                                </>
                              ) : item.entity === "achievements" ? (
                                <>
                                  <Textarea
                                    rows={2}
                                    value={editDraft.text ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        text: e.target.value,
                                      }))
                                    }
                                    placeholder="Achievement statement"
                                  />
                                  <div className="grid grid-cols-3 gap-2">
                                    <Input
                                      value={editDraft.metricValue ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          metricValue: e.target.value,
                                        }))
                                      }
                                      placeholder="Metric value"
                                    />
                                    <Input
                                      value={editDraft.metricUnit ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          metricUnit: e.target.value,
                                        }))
                                      }
                                      placeholder="Unit"
                                    />
                                    <Input
                                      value={editDraft.metricContext ?? ""}
                                      onChange={(e) =>
                                        setEditDraft((d) => ({
                                          ...d,
                                          metricContext: e.target.value,
                                        }))
                                      }
                                      placeholder="Context"
                                    />
                                  </div>
                                </>
                              ) : item.entity === "skills" ? (
                                <div className="grid grid-cols-2 gap-2">
                                  <Input
                                    value={editDraft.canonicalName ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        canonicalName: e.target.value,
                                      }))
                                    }
                                    placeholder="Skill name"
                                  />
                                  <Input
                                    value={editDraft.category ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        category: e.target.value,
                                      }))
                                    }
                                    placeholder="Category"
                                  />
                                </div>
                              ) : item.entity === "education" ? (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                  <Input
                                    value={editDraft.qualification ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        qualification: e.target.value,
                                      }))
                                    }
                                    placeholder="Qualification"
                                  />
                                  <Input
                                    value={editDraft.fieldOfStudy ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        fieldOfStudy: e.target.value,
                                      }))
                                    }
                                    placeholder="Field of study"
                                  />
                                  <Input
                                    value={editDraft.institution ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        institution: e.target.value,
                                      }))
                                    }
                                    placeholder="Institution"
                                  />
                                </div>
                              ) : item.entity === "certifications" ? (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                  <Input
                                    value={editDraft.name ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        name: e.target.value,
                                      }))
                                    }
                                    placeholder="Certification"
                                  />
                                  <Input
                                    value={editDraft.issuer ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        issuer: e.target.value,
                                      }))
                                    }
                                    placeholder="Issuer"
                                  />
                                  <Input
                                    value={editDraft.issueDate ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        issueDate: e.target.value,
                                      }))
                                    }
                                    placeholder="Issue date"
                                  />
                                </div>
                              ) : (
                                <div className="grid grid-cols-2 gap-2">
                                  <Input
                                    value={editDraft.language ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        language: e.target.value,
                                      }))
                                    }
                                    placeholder="Language"
                                  />
                                  <Input
                                    value={editDraft.proficiency ?? ""}
                                    onChange={(e) =>
                                      setEditDraft((d) => ({
                                        ...d,
                                        proficiency: e.target.value,
                                      }))
                                    }
                                    placeholder="Proficiency"
                                  />
                                </div>
                              )}

                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isBusy}
                                  onClick={() => setEditingKey(null)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={isBusy}
                                  onClick={() => void saveInlineEdit(item, false)}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  loading={isBusy}
                                  onClick={() => void saveInlineEdit(item, true)}
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Save &amp; Verify</span>
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[14px] font-medium text-[var(--text-primary)]">
                                    {item.title}
                                  </p>
                                  {item.subtitle ? (
                                    <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                                      {item.subtitle}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <OriginTag origin={item.origin} />
                                  <VerificationBadge status={item.verificationStatus} />
                                </div>
                              </div>

                              {item.detail ? (
                                <p className="text-[13px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">
                                  {item.detail}
                                </p>
                              ) : null}

                              {primaryEvidence ? (
                                <div className="rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                                      {confidencePct !== null
                                        ? `Parser confidence ${confidencePct}%`
                                        : "Source excerpt"}
                                    </span>
                                    {primaryEvidence.excerpt ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (
                                            primaryEvidence.sourceDocumentId &&
                                            primaryEvidence.sourceDocumentId !==
                                              selectedDocId
                                          ) {
                                            setSelectedDocId(
                                              primaryEvidence.sourceDocumentId
                                            );
                                          }
                                          setExcerptHighlight(
                                            primaryEvidence.excerpt ?? ""
                                          );
                                        }}
                                        className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline"
                                      >
                                        <Highlighter
                                          className="h-3 w-3"
                                          aria-hidden="true"
                                        />
                                        <span>Locate in text</span>
                                      </button>
                                    ) : null}
                                  </div>
                                  {primaryEvidence.excerpt ? (
                                    <p className="mt-1 font-data text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
                                      {primaryEvidence.excerpt}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}

                              <VerificationActionBar
                                compact
                                status={item.verificationStatus}
                                busyStatus={isBusy ? "verified" : null}
                                onEdit={() => startInlineEdit(item)}
                                onSetStatus={(next) =>
                                  void handleSetStatus(item.entity, item.id, next)
                                }
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
