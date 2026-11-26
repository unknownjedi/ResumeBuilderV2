"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  GitMerge,
  HelpCircle,
  Link2,
  MapPin,
  MinusCircle,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useSse } from "@/components/shell/sse-provider";
import { useWorkspace } from "@/components/shell/workspace-context";
import {
  createProfileEntity,
  getCareerProfile,
} from "@/features/career-profile/api";
import { createOrEnsureApplication } from "@/features/applications/api";
import { ConfirmAppliedDialog } from "@/features/applications/confirm-applied-dialog";
import type { ApplicationRecord } from "@/features/applications/types";
import { tailorResumeForJob } from "@/features/resume-builder/api";
import {
  analyzeJob,
  deleteCompensationOverride,
  getJobDetail,
  recomputeJobMatch,
  updateJobRequirement,
  upsertCompensationOverride,
} from "./api";
import {
  computeFreshness,
  formatDateTime,
  formatSalaryRange,
  formatShortDate,
  formatWorkplaceLabel,
  isSafeExternalHttpUrl,
  type CandidateResponse,
  type JobDetailItem,
  type JobRequirementSummary,
  type JobStatus,
  type MachineSupportState,
  type RequirementPriority,
  type SalaryPeriod,
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
          if (
            tag === "script" ||
            tag === "style" ||
            tag === "iframe" ||
            tag === "object" ||
            tag === "embed"
          ) {
            child.remove();
            continue;
          }
          const fragment = doc.createDocumentFragment();
          while (child.firstChild) {
            fragment.appendChild(child.firstChild);
          }
          child.replaceWith(fragment);
          continue;
        }

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

function supportStateMeta(state: MachineSupportState): {
  label: string;
  tone: BadgeTone;
} {
  switch (state) {
    case "supported":
      return { label: "Supported", tone: "accent" };
    case "partially_supported":
      return { label: "Partially demonstrated", tone: "warning" };
    case "not_found_in_profile":
      return { label: "Not found in profile", tone: "neutral" };
    case "ambiguous":
      return { label: "Ambiguous", tone: "neutral" };
  }
}

function priorityLabel(priority: RequirementPriority): string {
  switch (priority) {
    case "must_have":
      return "Must have";
    case "responsibility":
      return "Responsibility";
    case "preferred":
      return "Preferred";
    case "unspecified":
      return "Unspecified";
  }
}

function candidateResponseLabel(response: CandidateResponse): string {
  switch (response) {
    case "not_reviewed":
      return "Not reviewed";
    case "candidate_confirms_has":
      return "Candidate confirms has";
    case "candidate_confirms_does_not_have":
      return "Candidate confirms does not have";
  }
}

interface VerifiedFactOption {
  value: string;
  factType: "experience" | "project" | "achievement" | "skill" | "education" | "certification";
  factId: string;
  label: string;
  existingEvidenceLinkId: string | null;
}

type RequirementFilter =
  | "all"
  | "not_found_in_profile"
  | "partially_supported"
  | "supported"
  | "ambiguous"
  | "orphaned";

const PRIORITY_RANK: Record<RequirementPriority, number> = {
  must_have: 0,
  responsibility: 1,
  preferred: 2,
  unspecified: 3,
};

export interface JobDetailViewProps {
  job: JobDetailItem;
  variant?: "drawer" | "page";
  pendingAction?: boolean;
  onChangeState: (nextState: UserJobDiscoveryState | "active") => void;
  onReviewDuplicates?: () => void;
  onJobUpdated?: (updated?: JobDetailItem) => void;
}

/**
 * Shared canonical job detail view used inside both the desktop right-side drawer
 * and the responsive full-page /jobs/[id] route.
 */
export function JobDetailView({
  job: initialJob,
  variant = "drawer",
  pendingAction = false,
  onChangeState,
  onReviewDuplicates,
  onJobUpdated,
}: JobDetailViewProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { subscribe } = useSse();
  const { activeProfileId, searchProfiles } = useWorkspace();

  const [localUpdated, setLocalUpdated] = React.useState<{
    base: JobDetailItem;
    data: JobDetailItem;
  } | null>(null);
  const job =
    localUpdated && localUpdated.base === initialJob
      ? localUpdated.data
      : initialJob;
  const setJob = React.useCallback(
    (next: JobDetailItem) => {
      setLocalUpdated({ base: initialJob, data: next });
    },
    [initialJob]
  );

  const activeProfile = React.useMemo(
    () => searchProfiles.find((p) => p.id === activeProfileId) ?? null,
    [activeProfileId, searchProfiles]
  );

  // Analysis & Match state
  const [analyzing, setAnalyzing] = React.useState(false);
  const [matching, setMatching] = React.useState(false);
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);

  // Resume & Application workflow actions
  const [tailoringResume, setTailoringResume] = React.useState(false);
  const [preparingApplication, setPreparingApplication] = React.useState(false);
  const [openingAppliedModal, setOpeningAppliedModal] = React.useState(false);
  const [activeApplication, setActiveApplication] =
    React.useState<ApplicationRecord | null>(null);
  const [confirmAppliedOpen, setConfirmAppliedOpen] = React.useState(false);

  // Compensation Override editor state
  const [compEditing, setCompEditing] = React.useState(false);
  const [compSaving, setCompSaving] = React.useState(false);
  const [compMin, setCompMin] = React.useState("");
  const [compMax, setCompMax] = React.useState("");
  const [compCurrency, setCompCurrency] = React.useState("USD");
  const [compPeriod, setCompPeriod] = React.useState<SalaryPeriod>("year");
  const [compNote, setCompNote] = React.useState("");

  // Requirements & Candidate Response state
  const [reqFilter, setReqFilter] = React.useState<RequirementFilter>("all");
  const [busyReqIds, setBusyReqIds] = React.useState<Record<string, boolean>>({});
  const [linkingReqId, setLinkingReqId] = React.useState<string | null>(null);
  const [verifiedFacts, setVerifiedFacts] = React.useState<VerifiedFactOption[]>([]);
  const [loadingFacts, setLoadingFacts] = React.useState(false);
  const [selectedFactValue, setSelectedFactValue] = React.useState("");

  const refreshJob = React.useCallback(async () => {
    try {
      const fresh = await getJobDetail(job.id, activeProfileId);
      setJob(fresh);
      onJobUpdated?.(fresh);
    } catch {
      // Non-fatal silent refresh failure
    }
  }, [activeProfileId, job.id, onJobUpdated, setJob]);

  // Listen for SSE task completion for this job
  React.useEffect(() => {
    return subscribe((msg) => {
      if (msg.kind === "reset" || msg.kind === "poll") {
        if (activeTaskId) {
          void refreshJob();
        }
        return;
      }
      const ev = msg.event;
      const matchesTask = activeTaskId && ev.taskId === activeTaskId;
      const matchesJob =
        ev.resourceType === "job" &&
        (!ev.resourceId || ev.resourceId === job.id);

      if (matchesTask || matchesJob) {
        if (ev.eventType === "task.succeeded" || ev.eventType === "resource.updated") {
          setAnalyzing(false);
          setMatching(false);
          setActiveTaskId(null);
          void refreshJob();
        } else if (ev.eventType === "task.failed" || ev.eventType === "task.cancelled") {
          setAnalyzing(false);
          setMatching(false);
          setActiveTaskId(null);
          toast({
            title: "Job analysis task did not complete",
            description: `Status: ${ev.status}`,
            tone: "danger",
          });
        }
      }
    });
  }, [activeTaskId, job.id, refreshJob, subscribe, toast]);

  const handleAnalyzeJob = async () => {
    setAnalyzing(true);
    try {
      const res = await analyzeJob(job.id, {
        searchProfileId: activeProfileId,
      });
      if (res.taskId && res.status !== "succeeded") {
        setActiveTaskId(res.taskId);
        toast({
          title: res.deduplicated
            ? "Analysis already queued"
            : "Job analysis queued",
          description: "Requirement extraction and fit scoring will update automatically.",
          tone: "neutral",
        });
      } else {
        setAnalyzing(false);
        await refreshJob();
        toast({
          title: "Job analysis updated",
          tone: "accent",
        });
      }
    } catch (err) {
      setAnalyzing(false);
      toast({
        title: "Could not analyze job",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    }
  };

  const handleRecomputeMatch = async () => {
    if (!activeProfileId) {
      toast({
        title: "No active search profile",
        description: "Select or create a search profile first.",
        tone: "warning",
      });
      return;
    }
    setMatching(true);
    try {
      await recomputeJobMatch(job.id, activeProfileId);
      await refreshJob();
      toast({
        title: "Match scores recomputed",
        description: activeProfile ? `Profile: ${activeProfile.name}` : undefined,
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not recompute match",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setMatching(false);
    }
  };

  const openCompEditor = () => {
    setCompMin(
      job.compensationOverride?.minAmount !== null &&
        job.compensationOverride?.minAmount !== undefined
        ? String(job.compensationOverride.minAmount)
        : ""
    );
    setCompMax(
      job.compensationOverride?.maxAmount !== null &&
        job.compensationOverride?.maxAmount !== undefined
        ? String(job.compensationOverride.maxAmount)
        : ""
    );
    setCompCurrency(job.compensationOverride?.currency ?? "USD");
    setCompPeriod(job.compensationOverride?.period ?? "year");
    setCompNote(job.compensationOverride?.note ?? "");
    setCompEditing(true);
  };

  const handleSaveCompOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    const minAmount = compMin.trim() ? Number(compMin.trim()) : null;
    const maxAmount = compMax.trim() ? Number(compMax.trim()) : null;
    if (
      (minAmount !== null && !Number.isFinite(minAmount)) ||
      (maxAmount !== null && !Number.isFinite(maxAmount))
    ) {
      toast({
        title: "Invalid compensation numbers",
        tone: "warning",
      });
      return;
    }
    if (minAmount !== null && maxAmount !== null && maxAmount < minAmount) {
      toast({
        title: "Maximum cannot be below minimum",
        tone: "warning",
      });
      return;
    }
    if (minAmount === null && maxAmount === null) {
      toast({
        title: "Enter at least a minimum or maximum amount",
        tone: "warning",
      });
      return;
    }

    setCompSaving(true);
    try {
      await upsertCompensationOverride(job.id, {
        minAmount,
        maxAmount,
        currency: compCurrency.trim().toUpperCase() || "USD",
        period: compPeriod,
        note: compNote.trim() || null,
      });
      setCompEditing(false);
      await refreshJob();
      toast({
        title: "User compensation override saved",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not save compensation override",
        description: err instanceof Error ? err.message : "Save failed.",
        tone: "danger",
      });
    } finally {
      setCompSaving(false);
    }
  };

  const handleDeleteCompOverride = async () => {
    setCompSaving(true);
    try {
      await deleteCompensationOverride(job.id);
      setCompEditing(false);
      await refreshJob();
      toast({
        title: "User compensation override removed",
        tone: "neutral",
      });
    } catch (err) {
      toast({
        title: "Could not remove override",
        description: err instanceof Error ? err.message : "Delete failed.",
        tone: "danger",
      });
    } finally {
      setCompSaving(false);
    }
  };

  const ensureVerifiedFactsLoaded = async () => {
    if (verifiedFacts.length > 0 || loadingFacts) return;
    setLoadingFacts(true);
    try {
      const payload = await getCareerProfile();
      const evidenceByTarget = new Map<string, string>();
      for (const link of payload.evidenceLinks) {
        if (link.verificationStatus !== "rejected") {
          const key = `${link.targetType}:${link.targetId}`;
          if (!evidenceByTarget.has(key)) {
            evidenceByTarget.set(key, link.id);
          }
        }
      }

      const opts: VerifiedFactOption[] = [];
      for (const exp of payload.experiences) {
        if (exp.verificationStatus === "verified") {
          const key = `experience:${exp.id}`;
          opts.push({
            value: key,
            factType: "experience",
            factId: exp.id,
            label: `Experience · ${exp.title} at ${exp.employer}`,
            existingEvidenceLinkId: evidenceByTarget.get(key) ?? null,
          });
        }
      }
      for (const proj of payload.projects) {
        if (proj.verificationStatus === "verified") {
          const key = `project:${proj.id}`;
          opts.push({
            value: key,
            factType: "project",
            factId: proj.id,
            label: `Project · ${proj.name}`,
            existingEvidenceLinkId: evidenceByTarget.get(key) ?? null,
          });
        }
      }
      for (const ach of payload.achievements) {
        if (ach.verificationStatus === "verified") {
          const key = `achievement:${ach.id}`;
          opts.push({
            value: key,
            factType: "achievement",
            factId: ach.id,
            label: `Achievement · ${ach.text.slice(0, 72)}`,
            existingEvidenceLinkId: evidenceByTarget.get(key) ?? null,
          });
        }
      }
      for (const sk of payload.skills) {
        if (sk.verificationStatus === "verified") {
          const key = `skill:${sk.id}`;
          opts.push({
            value: key,
            factType: "skill",
            factId: sk.id,
            label: `Skill · ${sk.canonicalName}`,
            existingEvidenceLinkId: evidenceByTarget.get(key) ?? null,
          });
        }
      }
      for (const cert of payload.certifications) {
        if (cert.verificationStatus === "verified") {
          const key = `certification:${cert.id}`;
          opts.push({
            value: key,
            factType: "certification",
            factId: cert.id,
            label: `Certification · ${cert.name}`,
            existingEvidenceLinkId: evidenceByTarget.get(key) ?? null,
          });
        }
      }
      for (const edu of payload.education) {
        if (edu.verificationStatus === "verified") {
          const key = `education:${edu.id}`;
          opts.push({
            value: key,
            factType: "education",
            factId: edu.id,
            label: `Education · ${edu.qualification} (${edu.institution})`,
            existingEvidenceLinkId: evidenceByTarget.get(key) ?? null,
          });
        }
      }
      setVerifiedFacts(opts);
      if (opts.length > 0 && !selectedFactValue) {
        setSelectedFactValue(opts[0].value);
      }
    } catch (err) {
      toast({
        title: "Could not load verified career facts",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setLoadingFacts(false);
    }
  };

  const handleOpenFactLinker = (reqId: string) => {
    setLinkingReqId(reqId);
    void ensureVerifiedFactsLoaded();
  };

  const handlePatchRequirement = async (
    req: JobRequirementSummary,
    patch: {
      candidateResponse?: CandidateResponse;
      userPriorityOverride?: RequirementPriority | null;
      evidenceLinkIds?: string[];
    }
  ) => {
    setBusyReqIds((prev) => ({ ...prev, [req.id]: true }));
    try {
      await updateJobRequirement(job.id, req.id, patch);
      setLinkingReqId(null);
      await refreshJob();
      toast({
        title: "Requirement updated",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not update requirement",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setBusyReqIds((prev) => {
        const copy = { ...prev };
        delete copy[req.id];
        return copy;
      });
    }
  };

  const handleConfirmHasWithFact = async (req: JobRequirementSummary) => {
    const chosen = verifiedFacts.find((f) => f.value === selectedFactValue);
    if (!chosen) {
      toast({
        title: "Select a verified career fact",
        description: "Confirming possession requires linking a verified fact.",
        tone: "warning",
      });
      return;
    }

    setBusyReqIds((prev) => ({ ...prev, [req.id]: true }));
    try {
      let evidenceLinkId = chosen.existingEvidenceLinkId;
      if (!evidenceLinkId) {
        const created = await createProfileEntity("evidence-links", {
          sourceDocumentId: null,
          excerpt: chosen.label,
          targetType: chosen.factType,
          targetId: chosen.factId,
          verificationStatus: "verified",
          origin: "manual",
        });
        const linkObj =
          created.evidenceLink && typeof created.evidenceLink === "object"
            ? (created.evidenceLink as Record<string, unknown>)
            : created;
        if (typeof linkObj.id === "string" && linkObj.id) {
          evidenceLinkId = linkObj.id;
          setVerifiedFacts((prev) =>
            prev.map((f) =>
              f.value === chosen.value
                ? { ...f, existingEvidenceLinkId: evidenceLinkId }
                : f
            )
          );
        }
      }

      if (!evidenceLinkId) {
        throw new Error("Could not create evidence link for verified fact.");
      }

      await updateJobRequirement(job.id, req.id, {
        candidateResponse: "candidate_confirms_has",
        evidenceLinkIds: [evidenceLinkId],
      });
      setLinkingReqId(null);
      await refreshJob();
      toast({
        title: "Requirement confirmed with verified evidence",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not confirm requirement",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setBusyReqIds((prev) => {
        const copy = { ...prev };
        delete copy[req.id];
        return copy;
      });
    }
  };

  const safeApplyUrl =
    isSafeExternalHttpUrl(job.applyUrl) ??
    isSafeExternalHttpUrl(job.canonicalUrl);

  const handleTailorResume = async () => {
    setTailoringResume(true);
    try {
      const draft = await tailorResumeForJob(job.id, {
        searchProfileId: activeProfileId ?? undefined,
      });
      toast({
        title: "Tailored resume draft ready",
        description: "Opening Resume Tailoring Studio.",
        tone: "accent",
      });
      router.push(`/resumes/${encodeURIComponent(draft.id)}`);
    } catch (err) {
      toast({
        title: "Could not tailor resume",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setTailoringResume(false);
    }
  };

  const handlePrepareApplication = async () => {
    setPreparingApplication(true);
    try {
      const app = await createOrEnsureApplication({
        jobId: job.id,
        searchProfileId: activeProfileId ?? undefined,
        originalApplyUrl: safeApplyUrl ?? null,
      });
      setActiveApplication(app);
      toast({
        title: "Application workspace ready",
        description: `${job.title} at ${job.companyName}`,
        tone: "accent",
      });
      router.push(`/applications?applicationId=${encodeURIComponent(app.id)}`);
    } catch (err) {
      toast({
        title: "Could not prepare application",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setPreparingApplication(false);
    }
  };

  const handleOpenMarkApplied = async () => {
    setOpeningAppliedModal(true);
    try {
      const app = await createOrEnsureApplication({
        jobId: job.id,
        searchProfileId: activeProfileId ?? undefined,
        originalApplyUrl: safeApplyUrl ?? null,
      });
      setActiveApplication(app);
      setConfirmAppliedOpen(true);
    } catch (err) {
      toast({
        title: "Could not open submission confirmation",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setOpeningAppliedModal(false);
    }
  };
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
  const isDismissed =
    job.userState === "dismissed" || job.userState === "hidden";

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

  const evidenceCounts = React.useMemo(() => {
    let supported = 0;
    let partial = 0;
    let notFound = 0;
    let ambiguous = 0;
    let orphaned = 0;
    for (const req of job.requirements) {
      if (req.overrideState === "orphaned") orphaned += 1;
      switch (req.machineSupportState) {
        case "supported":
          supported += 1;
          break;
        case "partially_supported":
          partial += 1;
          break;
        case "not_found_in_profile":
          notFound += 1;
          break;
        case "ambiguous":
          ambiguous += 1;
          break;
      }
    }
    const assessable = supported + partial + notFound;
    return {
      supported,
      partial,
      notFound,
      ambiguous,
      orphaned,
      assessable,
      total: job.requirements.length,
    };
  }, [job.requirements]);

  const filteredRequirements = React.useMemo(() => {
    const sorted = [...job.requirements].sort(
      (a, b) =>
        PRIORITY_RANK[a.effectivePriority] - PRIORITY_RANK[b.effectivePriority]
    );
    if (reqFilter === "all") return sorted;
    if (reqFilter === "orphaned") {
      return sorted.filter((r) => r.overrideState === "orphaned");
    }
    return sorted.filter((r) => r.machineSupportState === reqFilter);
  }, [job.requirements, reqFilter]);

  const hasAnalyzed =
    job.analysisStatus !== "pending" || job.requirements.length > 0;

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
          {job.hardFilterStatus === "excluded" ? (
            <Badge tone="neutral">Filtered out by profile</Badge>
          ) : job.hardFilterStatus === "pending_analysis" ? (
            <Badge tone="warning">Pending skill filter</Badge>
          ) : null}
        </div>

        <div>
          <h2
            className={cn(
              "font-semibold tracking-tight text-[var(--text-primary)]",
              variant === "page"
                ? "text-[22px] leading-7"
                : "text-[18px] leading-6"
            )}
          >
            {job.title}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
              <Building2
                className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
                aria-hidden="true"
              />
              {job.companyName}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin
                className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
                aria-hidden="true"
              />
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
              <BookmarkCheck
                className="h-4 w-4 text-[var(--accent)]"
                aria-hidden="true"
              />
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

          <Button
            variant="secondary"
            size="md"
            loading={tailoringResume}
            disabled={pendingAction || tailoringResume}
            onClick={() => void handleTailorResume()}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Tailor resume
          </Button>

          <Button
            variant="secondary"
            size="md"
            loading={preparingApplication}
            disabled={pendingAction || preparingApplication}
            onClick={() => void handlePrepareApplication()}
          >
            <Briefcase className="h-4 w-4" aria-hidden="true" />
            Prepare application
          </Button>

          <Button
            variant="outline"
            size="md"
            loading={openingAppliedModal}
            disabled={pendingAction || openingAppliedModal}
            onClick={() => void handleOpenMarkApplied()}
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Mark as applied
          </Button>

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

      {/* Score Breakdown & Analysis Controls */}
      <section
        aria-labelledby="score-breakdown-heading"
        className="space-y-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3
              id="score-breakdown-heading"
              className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase"
            >
              Match &amp; evidence breakdown
            </h3>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              {activeProfile
                ? `Evaluated for search profile: ${activeProfile.name}`
                : "Select a search profile to compute profile-specific priority and skill alignment."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={analyzing}
              onClick={() => void handleAnalyzeJob()}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              {hasAnalyzed ? "Re-analyze job" : "Analyze job"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={matching}
              disabled={!activeProfileId}
              onClick={() => void handleRecomputeMatch()}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Recompute match
            </Button>
          </div>
        </div>

        {/* Distinct Dimensions (no radial rings) */}
        <div className="grid divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-3">
            <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase">
              Documented fit
            </div>
            <div className="mt-1 font-data text-[20px] font-semibold text-[var(--text-primary)]">
              {typeof job.documentedFitScore === "number"
                ? `${Math.round(job.documentedFitScore)}%`
                : hasAnalyzed
                  ? "Not enough info"
                  : "Not analyzed"}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
              Verified profile facts vs. JD requirements. Not an ATS score.
            </p>
          </div>

          <div className="p-3">
            <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase">
              Skill alignment
            </div>
            <div className="mt-1 font-data text-[20px] font-semibold text-[var(--text-primary)]">
              {typeof job.searchSkillAlignmentScore === "number"
                ? `${Math.round(job.searchSkillAlignmentScore)}%`
                : hasAnalyzed
                  ? "Omitted"
                  : "Not analyzed"}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
              Job posting terms vs. active search-profile skills.
            </p>
          </div>

          <div className="p-3">
            <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase">
              Priority score
            </div>
            <div className="mt-1 font-data text-[20px] font-semibold text-[var(--accent)]">
              {typeof job.priorityScore === "number"
                ? Math.round(job.priorityScore)
                : "Basic relevance"}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
              {job.latestMatch?.renormalized
                ? `Renormalized (${job.latestMatch.omittedFactors.join(", ")} omitted)`
                : "Weighted across available ranking factors."}
            </p>
          </div>
        </div>

        {/* Horizontal Evidence Bar */}
        {evidenceCounts.total > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-[var(--text-primary)]">
                Requirement evidence coverage
              </span>
              <span className="font-data text-[var(--text-tertiary)]">
                {evidenceCounts.supported} supported · {evidenceCounts.partial} partial ·{" "}
                {evidenceCounts.notFound} not found
                {evidenceCounts.ambiguous > 0
                  ? ` · ${evidenceCounts.ambiguous} ambiguous`
                  : ""}
              </span>
            </div>
            <div
              role="img"
              aria-label={`${evidenceCounts.supported} supported, ${evidenceCounts.partial} partially demonstrated, ${evidenceCounts.notFound} not found in profile`}
              className="flex h-2.5 w-full overflow-hidden rounded-[4px] border border-[var(--border)] bg-[var(--surface-muted)]"
            >
              {evidenceCounts.assessable > 0 ? (
                <>
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{
                      width: `${(evidenceCounts.supported / evidenceCounts.assessable) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-[var(--warning)]"
                    style={{
                      width: `${(evidenceCounts.partial / evidenceCounts.assessable) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-[#D1CFC7]"
                    style={{
                      width: `${(evidenceCounts.notFound / evidenceCounts.assessable) * 100}%`,
                    }}
                  />
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Factor Breakdown */}
        {job.latestMatch && job.latestMatch.includedFactors.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="font-medium text-[var(--text-primary)]">
                Ranking factor breakdown
              </span>
              {job.latestMatch.renormalized ? (
                <Badge tone="warning">Weights renormalized</Badge>
              ) : null}
            </div>
            <div className="divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] text-[12px]">
              {job.latestMatch.includedFactors.map((f) => (
                <div
                  key={f.key}
                  className="flex items-center justify-between gap-3 px-3 py-1.5"
                >
                  <div className="min-w-0">
                    <span className="text-[var(--text-primary)]">{f.label}</span>
                    {!f.included && f.reason ? (
                      <span className="ml-2 text-[11px] text-[var(--text-tertiary)]">
                        ({f.reason})
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 font-data">
                    <span className="text-[var(--text-tertiary)]">
                      {f.included
                        ? f.effectiveWeight !== null
                          ? `${Math.round(f.effectiveWeight)}% eff.`
                          : f.configuredWeight !== null
                            ? `${Math.round(f.configuredWeight)}%`
                            : "Included"
                        : "Omitted"}
                    </span>
                    <span className="w-10 text-right font-medium text-[var(--text-primary)]">
                      {f.included && f.score !== null
                        ? Math.round(f.score)
                        : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Analysis metadata & versions */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border)] pt-2.5 font-data text-[11px] text-[var(--text-tertiary)]">
          <span>Method: {job.analysisStatus}</span>
          {job.analyzedAt ? (
            <span>Analyzed: {formatDateTime(job.analyzedAt)}</span>
          ) : null}
          {job.analysisVersion ? (
            <span>Analysis v{job.analysisVersion}</span>
          ) : null}
          {job.latestMatch?.calculationVersion ? (
            <span>Calc {job.latestMatch.calculationVersion}</span>
          ) : null}
          {job.latestMatch?.weightVersion ? (
            <span>Weights {job.latestMatch.weightVersion}</span>
          ) : null}
        </div>
      </section>

      {/* Metadata grid: Compensation + Freshness provenance */}
      <div
        className={cn(
          "grid gap-4",
          variant === "page" ? "lg:grid-cols-2" : "grid-cols-1"
        )}
      >
        {/* Compensation & provenance + User Override Editor */}
        <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
              Compensation &amp; provenance
            </h3>
            {!compEditing ? (
              <Button variant="ghost" size="sm" onClick={openCompEditor}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                {job.compensationOverride ? "Edit override" : "Add override"}
              </Button>
            ) : null}
          </div>

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

            {overrideSalary && !compEditing ? (
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

            {compEditing ? (
              <form
                onSubmit={(e) => void handleSaveCompOverride(e)}
                className="space-y-2.5 border-t border-[var(--border)] pt-3"
              >
                <p className="text-[12px] text-[var(--text-secondary)]">
                  Stored separately as <strong>User supplied</strong> without altering employer-disclosed data.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label
                      htmlFor={`comp-min-${job.id}`}
                      className="block text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      Min amount
                    </label>
                    <Input
                      id={`comp-min-${job.id}`}
                      type="number"
                      min={0}
                      value={compMin}
                      onChange={(e) => setCompMin(e.target.value)}
                      placeholder="140000"
                      className="h-8 font-data text-[13px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={`comp-max-${job.id}`}
                      className="block text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      Max amount
                    </label>
                    <Input
                      id={`comp-max-${job.id}`}
                      type="number"
                      min={0}
                      value={compMax}
                      onChange={(e) => setCompMax(e.target.value)}
                      placeholder="180000"
                      className="h-8 font-data text-[13px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={`comp-curr-${job.id}`}
                      className="block text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      Currency
                    </label>
                    <Input
                      id={`comp-curr-${job.id}`}
                      maxLength={3}
                      value={compCurrency}
                      onChange={(e) =>
                        setCompCurrency(e.target.value.toUpperCase())
                      }
                      placeholder="USD"
                      className="h-8 font-data text-[13px] uppercase"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={`comp-period-${job.id}`}
                      className="block text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      Period
                    </label>
                    <Select
                      value={compPeriod}
                      onValueChange={(val) => setCompPeriod(val as SalaryPeriod)}
                    >
                      <SelectTrigger
                        id={`comp-period-${job.id}`}
                        className="h-8 text-[13px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="year">Year</SelectItem>
                        <SelectItem value="month">Month</SelectItem>
                        <SelectItem value="hour">Hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor={`comp-note-${job.id}`}
                    className="block text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    Note / provenance
                  </label>
                  <Input
                    id={`comp-note-${job.id}`}
                    value={compNote}
                    onChange={(e) => setCompNote(e.target.value)}
                    placeholder="e.g. Recruiter shared base band"
                    className="h-8 text-[13px]"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div>
                    {job.compensationOverride ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={compSaving}
                        onClick={() => void handleDeleteCompOverride()}
                        className="text-[var(--danger)] hover:bg-[#F8EAE8]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={compSaving}
                      onClick={() => setCompEditing(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={compSaving}
                    >
                      Save override
                    </Button>
                  </div>
                </div>
              </form>
            ) : null}

            {job.seniorityLevel ||
            job.seniorityMinYears !== null ||
            job.seniorityMaxYears !== null ? (
              <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--text-secondary)]">
                <span>Experience / Seniority</span>
                <span className="font-data text-[var(--text-primary)]">
                  {[
                    job.seniorityLevel,
                    job.seniorityMinYears !== null ||
                    job.seniorityMaxYears !== null
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
            <Clock
              className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
              aria-hidden="true"
            />
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
                <AlertTriangle
                  className="h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
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

      {/* Requirement-to-Evidence Accordions */}
      <section
        aria-labelledby="requirements-evidence-heading"
        className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3
              id="requirements-evidence-heading"
              className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase"
            >
              Requirements &amp; career evidence
            </h3>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              Inspect evidence links, override requirement priorities, or confirm whether you have missing skills.
            </p>
          </div>
          <span className="font-data text-[11px] text-[var(--text-tertiary)]">
            {job.requirements.length} extracted
          </span>
        </div>

        {job.requirements.length === 0 ? (
          <div className="mt-3 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-3.5 py-4 text-[13px] text-[var(--text-secondary)]">
            No requirements extracted yet. Use <strong>Analyze job</strong> above to parse requirements and map verified Career Profile evidence.
          </div>
        ) : (
          <>
            {/* Filter pills */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(
                [
                  { key: "all", label: `All (${evidenceCounts.total})` },
                  {
                    key: "not_found_in_profile",
                    label: `Not found (${evidenceCounts.notFound})`,
                  },
                  {
                    key: "partially_supported",
                    label: `Partial (${evidenceCounts.partial})`,
                  },
                  {
                    key: "supported",
                    label: `Supported (${evidenceCounts.supported})`,
                  },
                  {
                    key: "ambiguous",
                    label: `Ambiguous (${evidenceCounts.ambiguous})`,
                  },
                ] as Array<{ key: RequirementFilter; label: string }>
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={reqFilter === tab.key}
                  onClick={() => setReqFilter(tab.key)}
                  className={cn(
                    "h-7 rounded-[4px] border px-2.5 text-[12px] font-medium transition-colors",
                    reqFilter === tab.key
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                >
                  {tab.label}
                </button>
              ))}
              {evidenceCounts.orphaned > 0 ? (
                <button
                  type="button"
                  aria-pressed={reqFilter === "orphaned"}
                  onClick={() => setReqFilter("orphaned")}
                  className={cn(
                    "h-7 rounded-[4px] border px-2.5 text-[12px] font-medium transition-colors",
                    reqFilter === "orphaned"
                      ? "border-[#DFC99B] bg-[#F5EFE2] text-[var(--warning)]"
                      : "border-[var(--border)] bg-[var(--canvas)] text-[var(--warning)]"
                  )}
                >
                  Orphaned overrides ({evidenceCounts.orphaned})
                </button>
              ) : null}
            </div>

            <Accordion
              type="multiple"
              className="mt-3 border-t border-[var(--border)]"
            >
              {filteredRequirements.map((req) => {
                const stateMeta = supportStateMeta(req.machineSupportState);
                const isBusy = Boolean(busyReqIds[req.id]);
                const isLinking = linkingReqId === req.id;

                return (
                  <AccordionItem key={req.id} value={req.id}>
                    <AccordionTrigger className="py-2.5 text-[13px] hover:no-underline">
                      <div className="flex flex-col gap-1.5 pr-2">
                        <span className="font-medium text-[var(--text-primary)]">
                          {req.requirementText}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="neutral">
                            {priorityLabel(req.effectivePriority)}
                          </Badge>
                          {req.userPriorityOverride ? (
                            <Badge tone="neutral">Priority overridden</Badge>
                          ) : null}
                          <Badge tone={stateMeta.tone}>{stateMeta.label}</Badge>
                          {req.candidateResponse ===
                          "candidate_confirms_has" ? (
                            <Badge tone="accent">
                              {candidateResponseLabel(req.candidateResponse)}
                            </Badge>
                          ) : req.candidateResponse ===
                            "candidate_confirms_does_not_have" ? (
                            <Badge tone="danger">
                              {candidateResponseLabel(req.candidateResponse)}
                            </Badge>
                          ) : null}
                          {req.overrideState === "orphaned" ? (
                            <Badge tone="warning">Orphaned override</Badge>
                          ) : null}
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="space-y-3 bg-[var(--canvas)] px-3 py-3">
                      {/* Evidence Details */}
                      {req.evidence.length > 0 ? (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                            Linked Career Profile evidence
                          </div>
                          <ul className="space-y-1.5">
                            {req.evidence.map((ev) => (
                              <li
                                key={ev.id}
                                className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-[12px]"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <CheckCircle2
                                    className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                                    aria-hidden="true"
                                  />
                                  <span className="font-medium text-[var(--text-primary)]">
                                    {ev.linkedFactLabel ??
                                      (ev.linkedFactType && ev.linkedFactId
                                        ? `${ev.linkedFactType} (${ev.linkedFactId.slice(0, 8)})`
                                        : "Verified career evidence")}
                                  </span>
                                </div>
                                {ev.explanation ? (
                                  <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                                    {ev.explanation}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : req.machineSupportState === "not_found_in_profile" ? (
                        <div className="flex items-start gap-2 rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-[12px] text-[var(--text-secondary)]">
                          <HelpCircle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
                            aria-hidden="true"
                          />
                          <span>
                            Not found in your Career Profile yet — this does not assert that you lack this skill.
                          </span>
                        </div>
                      ) : (
                        <p className="text-[12px] text-[var(--text-secondary)]">
                          No detailed evidence excerpt stored for this requirement.
                        </p>
                      )}

                      {/* Priority Override + Candidate Response Controls */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5">
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`priority-override-${req.id}`}
                            className="text-[12px] font-medium text-[var(--text-secondary)]"
                          >
                            Priority:
                          </label>
                          <Select
                            value={req.userPriorityOverride ?? "__extracted"}
                            disabled={isBusy}
                            onValueChange={(val) =>
                              void handlePatchRequirement(req, {
                                userPriorityOverride:
                                  val === "__extracted"
                                    ? null
                                    : (val as RequirementPriority),
                              })
                            }
                          >
                            <SelectTrigger
                              id={`priority-override-${req.id}`}
                              className="h-8 w-[170px] text-[12px]"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__extracted">
                                Extracted ({priorityLabel(req.priority)})
                              </SelectItem>
                              <SelectItem value="must_have">Must have</SelectItem>
                              <SelectItem value="responsibility">
                                Responsibility
                              </SelectItem>
                              <SelectItem value="preferred">Preferred</SelectItem>
                              <SelectItem value="unspecified">
                                Unspecified
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            variant={
                              req.candidateResponse === "candidate_confirms_has"
                                ? "primary"
                                : "secondary"
                            }
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleOpenFactLinker(req.id)}
                          >
                            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                            I have this
                          </Button>
                          <Button
                            variant={
                              req.candidateResponse ===
                              "candidate_confirms_does_not_have"
                                ? "danger"
                                : "secondary"
                            }
                            size="sm"
                            disabled={isBusy}
                            onClick={() =>
                              void handlePatchRequirement(req, {
                                candidateResponse:
                                  "candidate_confirms_does_not_have",
                              })
                            }
                          >
                            <MinusCircle
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                            I don&apos;t have this
                          </Button>
                          {req.candidateResponse !== "not_reviewed" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              onClick={() =>
                                void handlePatchRequirement(req, {
                                  candidateResponse: "not_reviewed",
                                })
                              }
                            >
                              Reset
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      {/* Inline Verified Fact Linker when confirming possession */}
                      {isLinking ? (
                        <div className="space-y-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12px] font-medium text-[var(--text-primary)]">
                              Link a verified Career Profile fact
                            </span>
                            <Link
                              href="/profile"
                              className="text-[12px] font-medium text-[var(--accent)] hover:underline"
                            >
                              Add / verify in Career Profile
                            </Link>
                          </div>

                          {loadingFacts ? (
                            <p className="text-[12px] text-[var(--text-secondary)]">
                              Loading verified facts...
                            </p>
                          ) : verifiedFacts.length === 0 ? (
                            <p className="text-[12px] text-[var(--text-secondary)]">
                              No verified facts found in your Career Profile yet. Add and verify an experience, project, or skill first.
                            </p>
                          ) : (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Select
                                value={selectedFactValue}
                                onValueChange={setSelectedFactValue}
                              >
                                <SelectTrigger
                                  aria-label="Select verified career fact"
                                  className="h-8 flex-1 text-[12px]"
                                >
                                  <SelectValue placeholder="Choose a verified fact..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {verifiedFacts.map((fact) => (
                                    <SelectItem key={fact.value} value={fact.value}>
                                      {fact.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  disabled={!selectedFactValue || isBusy}
                                  loading={isBusy}
                                  onClick={() =>
                                    void handleConfirmHasWithFact(req)
                                  }
                                >
                                  Confirm &amp; link
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setLinkingReqId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </>
        )}
      </section>

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

      <ConfirmAppliedDialog
        application={activeApplication}
        open={confirmAppliedOpen}
        onOpenChange={setConfirmAppliedOpen}
        onConfirmed={(updated) => {
          setActiveApplication(updated);
          void refreshJob();
        }}
      />
    </div>
  );
}
