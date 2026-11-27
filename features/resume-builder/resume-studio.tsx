"use client";

import * as React from "react";
import Link from "next/link";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Download,
  ExternalLink,
  FileCode2,
  FileDown,
  FileText,
  GripVertical,
  History,
  Link2,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useSse } from "@/components/shell/sse-provider";
import { getCareerProfile } from "@/features/career-profile/api";
import type { EvidenceTargetType, VerificationStatus } from "@/features/career-profile/types";
import { formatDateTime } from "@/features/job-discovery/types";
import {
  createResumeVersion,
  exportResumeDraft,
  getResumeDraft,
  ResumeApiError,
  updateResumeClaim,
  updateResumeDraft,
} from "./api";
import {
  buildClientResumePreviewHtml,
  estimateResumePages,
  reindexStructuredContent,
  type ClaimVerificationStatus,
  type DocumentExportRecord,
  type ExportFormat,
  type MarginPreset,
  type PaperSize,
  type ResumeBullet,
  type ResumeDraftDetail,
  type ResumeEvidenceRef,
  type ResumeSection,
  type ResumeTemplateSettings,
  type ResumeVersionRecord,
  type StructuredResumeContent,
  type UserEditedState,
} from "./types";

interface VerifiedFactChoice {
  key: string;
  factType: EvidenceTargetType;
  factId: string;
  label: string;
  excerpt: string;
  evidenceLinkId: string | null;
}

interface ActiveEvidenceTarget {
  claimId: string;
  label: string;
  text: string;
  evidenceRefs: ResumeEvidenceRef[];
  verificationStatus: ClaimVerificationStatus;
  userEditedState: UserEditedState;
}

interface StudioSnapshot {
  structuredContent: StructuredResumeContent;
  templateSettings: ResumeTemplateSettings;
}

const VISIBILITY_TOGGLES: Array<{
  key:
    | "showSummary"
    | "showProjects"
    | "showAchievements"
    | "showCertifications"
    | "showLanguages";
  label: string;
}> = [
  { key: "showSummary", label: "Summary" },
  { key: "showProjects", label: "Projects" },
  { key: "showAchievements", label: "Achievements" },
  { key: "showCertifications", label: "Certifications" },
  { key: "showLanguages", label: "Languages" },
];

function provenanceBadge(
  evidenceRefs: ResumeEvidenceRef[],
  verificationStatus: ClaimVerificationStatus,
  userEditedState: UserEditedState
): { label: string; tone: BadgeTone } {
  if (evidenceRefs.length > 0 && verificationStatus === "verified") {
    return { label: "Verified fact", tone: "accent" };
  }
  if (userEditedState === "user_edited" && evidenceRefs.length === 0) {
    return { label: "User edited · Needs evidence", tone: "warning" };
  }
  if (userEditedState === "user_edited") {
    return { label: "User edited", tone: "neutral" };
  }
  return { label: "Needs evidence link", tone: "warning" };
}

function triggerBrowserDownload(url: string, filename?: string) {
  const link = document.createElement("a");
  link.href = url;
  if (filename) {
    link.download = filename;
  }
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function arraySwapItems<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return list;
  }
  const copy = [...list];
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, item);
  return copy;
}

interface SortableBulletRowProps {
  bullet: ResumeBullet;
  entryId: string;
  index: number;
  total: number;
  onChangeText: (text: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpenEvidence: () => void;
  onDeleteBullet: () => void;
}

function SortableBulletRow({
  bullet,
  entryId,
  index,
  total,
  onChangeText,
  onMoveUp,
  onMoveDown,
  onOpenEvidence,
  onDeleteBullet,
}: SortableBulletRowProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id: bullet.id,
    index,
    type: `bullet:${entryId}`,
    accept: `bullet:${entryId}`,
    group: `bullets:${entryId}`,
  });

  const badge = provenanceBadge(
    bullet.evidenceRefs,
    bullet.verificationStatus,
    bullet.userEditedState
  );

  return (
    <div
      ref={ref}
      className={cn(
        "rounded-[6px] border bg-[var(--surface-raised)] p-2.5 transition-colors",
        isDragging
          ? "border-[var(--accent)] opacity-85 shadow-[0_6px_18px_rgba(34,35,31,0.12)]"
          : "border-[var(--border)]"
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          ref={handleRef}
          aria-label={`Drag bullet ${index + 1}`}
          className="mt-1 inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded-[3px] text-[var(--text-tertiary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <Textarea
            value={bullet.text}
            onChange={(e) => onChangeText(e.target.value)}
            rows={2}
            aria-label={`Bullet ${index + 1}`}
            className="min-h-[60px] text-[13px] leading-5"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={badge.tone}>{badge.label}</Badge>
              <button
                type="button"
                onClick={onOpenEvidence}
                className="inline-flex h-6 items-center gap-1 rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <Link2 className="h-3 w-3 text-[var(--accent)]" aria-hidden="true" />
                <span>Evidence ({bullet.evidenceRefs.length})</span>
              </button>
              {bullet.flaggedIssues && bullet.flaggedIssues.length > 0 ? (
                <Badge tone="warning">
                  {bullet.flaggedIssues.length} flag
                </Badge>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={index === 0}
                onClick={onMoveUp}
                aria-label="Move bullet up"
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={index === total - 1}
                onClick={onMoveDown}
                aria-label="Move bullet down"
                title="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onDeleteBullet}
                aria-label="Remove bullet"
                title="Remove bullet"
              >
                <Trash2
                  className="h-3.5 w-3.5 text-[var(--text-tertiary)] hover:text-[var(--danger)]"
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SortableSectionCardProps {
  section: ResumeSection;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdateSection: (updater: (sec: ResumeSection) => ResumeSection) => void;
  onOpenEvidence: (target: ActiveEvidenceTarget) => void;
}

function createStableClaimId(fallbackIndex: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `claim-${crypto.randomUUID()}`;
  }
  return `claim-${fallbackIndex}-${Math.random().toString(36).slice(2, 8)}`;
}

function SortableSectionCard({
  section,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onUpdateSection,
  onOpenEvidence,
}: SortableSectionCardProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id: section.id,
    index,
    type: "section",
    accept: "section",
    group: "sections",
  });

  const handleAddBullet = (entryId: string) => {
    onUpdateSection((sec) => ({
      ...sec,
      entries: sec.entries.map((ent) =>
        ent.id === entryId
          ? {
              ...ent,
              bullets: [
                ...ent.bullets,
                {
                  id: createStableClaimId(ent.bullets.length + 1),
                  sectionId: sec.id,
                  stableEntryId: ent.id,
                  text: "",
                  sortOrder: ent.bullets.length,
                  evidenceRefs: [],
                  userEditedState: "user_edited",
                  verificationStatus: "needs_review",
                },
              ],
            }
          : ent
      ),
    }));
  };

  const isSummarySection = section.type === "summary";
  const summaryBadge = isSummarySection
    ? provenanceBadge(
        section.summaryEvidenceRefs,
        section.summaryVerificationStatus ?? "needs_review",
        section.summaryUserEditedState ?? "generated"
      )
    : null;

  return (
    <section
      ref={ref}
      className={cn(
        "rounded-[8px] border bg-[var(--surface)] p-3.5",
        isDragging
          ? "border-[var(--accent)] opacity-85 shadow-[0_6px_20px_rgba(34,35,31,0.12)]"
          : "border-[var(--border)]"
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            ref={handleRef}
            aria-label={`Drag section ${section.title}`}
            className="inline-flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-[4px] text-[var(--text-tertiary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          <h3 className="truncate text-[13px] font-semibold tracking-wide text-[var(--text-primary)] uppercase">
            {section.title}
          </h3>
          <Badge tone="neutral" className="font-data text-[11px]">
            {isSummarySection
              ? "summary"
              : section.entries.length > 0
                ? `${section.entries.length} ${section.entries.length === 1 ? "entry" : "entries"}`
                : `${section.skillGroups.length} groups`}
          </Badge>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === 0}
            onClick={onMoveUp}
            aria-label={`Move ${section.title} section up`}
            title="Move section up"
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === total - 1}
            onClick={onMoveDown}
            aria-label={`Move ${section.title} section down`}
            title="Move section down"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {isSummarySection ? (
          <div className="space-y-2">
            {summaryBadge ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={summaryBadge.tone}>{summaryBadge.label}</Badge>
                {section.summaryClaimId ? (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenEvidence({
                        claimId: section.summaryClaimId!,
                        label: section.title || "Professional Summary",
                        text: section.summaryText ?? "",
                        evidenceRefs: section.summaryEvidenceRefs,
                        verificationStatus:
                          section.summaryVerificationStatus ?? "needs_review",
                        userEditedState:
                          section.summaryUserEditedState ?? "generated",
                      })
                    }
                    className="inline-flex h-6 items-center gap-1 rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-2 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
                  >
                    <Link2
                      className="h-3 w-3 text-[var(--accent)]"
                      aria-hidden="true"
                    />
                    <span>Evidence ({section.summaryEvidenceRefs.length})</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            <Textarea
              value={section.summaryText ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                onUpdateSection((sec) => ({
                  ...sec,
                  summaryText: val,
                  summaryUserEditedState: "user_edited",
                }));
              }}
              rows={3}
              aria-label="Professional summary"
              className="min-h-[76px] text-[13px]"
            />
          </div>
        ) : null}

        {section.skillGroups.length > 0 ? (
          <div className="space-y-2">
            {section.skillGroups.map((sg) => (
              <div
                key={sg.id}
                className="rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5"
              >
                <div className="text-[12px] font-semibold text-[var(--text-primary)]">
                  {sg.label}
                </div>
                <Textarea
                  value={sg.items.map((item) => item.name).join(", ")}
                  onChange={(e) => {
                    const names = e.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean);
                    onUpdateSection((sec) => ({
                      ...sec,
                      skillGroups: sec.skillGroups.map((g) => {
                        if (g.id !== sg.id) return g;
                        const existingByName = new Map(
                          g.items.map((item) => [
                            item.name.toLowerCase(),
                            item,
                          ])
                        );
                        return {
                          ...g,
                          items: names.map((name, nIdx) => {
                            const matched = existingByName.get(
                              name.toLowerCase()
                            );
                            if (matched) return matched;
                            return {
                              factId: `${sg.id}-skill-${nIdx}`,
                              name,
                              proficiency: null,
                              evidenceRefs: [],
                            };
                          }),
                        };
                      }),
                    }));
                  }}
                  rows={2}
                  aria-label={`${sg.label} skills`}
                  className="mt-1.5 min-h-[52px] text-[13px]"
                />
              </div>
            ))}
          </div>
        ) : null}

        {section.entries.map((entry) => (
          <div
            key={entry.id}
            className="space-y-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)]/60 p-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {entry.heading}
                </div>
                {entry.subheading || entry.location ? (
                  <div className="text-[12px] text-[var(--text-secondary)]">
                    {[entry.subheading, entry.location]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
              </div>
              {entry.dateRange ? (
                <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                  {entry.dateRange}
                </span>
              ) : null}
            </div>

            {entry.bullets.length > 0 ? (
              <div className="space-y-2">
                {entry.bullets.map((bullet, bIdx) => (
                  <SortableBulletRow
                    key={bullet.id}
                    bullet={bullet}
                    entryId={entry.id}
                    index={bIdx}
                    total={entry.bullets.length}
                    onChangeText={(nextText) => {
                      onUpdateSection((sec) => ({
                        ...sec,
                        entries: sec.entries.map((ent) =>
                          ent.id === entry.id
                            ? {
                                ...ent,
                                bullets: ent.bullets.map((b) =>
                                  b.id === bullet.id
                                    ? {
                                        ...b,
                                        text: nextText,
                                        userEditedState: "user_edited",
                                      }
                                    : b
                                ),
                              }
                            : ent
                        ),
                      }));
                    }}
                    onMoveUp={() => {
                      onUpdateSection((sec) => ({
                        ...sec,
                        entries: sec.entries.map((ent) =>
                          ent.id === entry.id
                            ? {
                                ...ent,
                                bullets: arraySwapItems(
                                  ent.bullets,
                                  bIdx,
                                  bIdx - 1
                                ),
                              }
                            : ent
                        ),
                      }));
                    }}
                    onMoveDown={() => {
                      onUpdateSection((sec) => ({
                        ...sec,
                        entries: sec.entries.map((ent) =>
                          ent.id === entry.id
                            ? {
                                ...ent,
                                bullets: arraySwapItems(
                                  ent.bullets,
                                  bIdx,
                                  bIdx + 1
                                ),
                              }
                            : ent
                        ),
                      }));
                    }}
                    onOpenEvidence={() =>
                      onOpenEvidence({
                        claimId: bullet.id,
                        label: `${section.title} · ${entry.heading}`,
                        text: bullet.text,
                        evidenceRefs: bullet.evidenceRefs,
                        verificationStatus: bullet.verificationStatus,
                        userEditedState: bullet.userEditedState,
                      })
                    }
                    onDeleteBullet={() => {
                      onUpdateSection((sec) => ({
                        ...sec,
                        entries: sec.entries.map((ent) =>
                          ent.id === entry.id
                            ? {
                                ...ent,
                                bullets: ent.bullets.filter(
                                  (b) => b.id !== bullet.id
                                ),
                              }
                            : ent
                        ),
                      }));
                    }}
                  />
                ))}
              </div>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px]"
              onClick={() => handleAddBullet(entry.id)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add bullet
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ResumeStudio({ draftId }: { draftId: string }) {
  const { toast } = useToast();
  const { subscribe } = useSse();

  const [draft, setDraft] = React.useState<ResumeDraftDetail | null>(null);
  const [structuredContent, setStructuredContent] =
    React.useState<StructuredResumeContent | null>(null);
  const [templateSettings, setTemplateSettings] =
    React.useState<ResumeTemplateSettings | null>(null);
  const [serverPreviewHtml, setServerPreviewHtml] = React.useState<string | null>(
    null
  );

  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [mobilePane, setMobilePane] = React.useState<"edit" | "preview">("edit");
  const [showLayoutControls, setShowLayoutControls] = React.useState(false);
  const [showVersionHistory, setShowVersionHistory] = React.useState(false);

  const [saveStatus, setSaveStatus] = React.useState<
    "saved" | "dirty" | "saving" | "error"
  >("saved");
  const [undoStack, setUndoStack] = React.useState<StudioSnapshot[]>([]);

  const [exportingFormat, setExportingFormat] =
    React.useState<ExportFormat | null>(null);
  const [creatingVersion, setCreatingVersion] = React.useState(false);
  const [pdfMissingNotice, setPdfMissingNotice] = React.useState<string | null>(
    null
  );

  const [evidenceTarget, setEvidenceTarget] =
    React.useState<ActiveEvidenceTarget | null>(null);
  const [verifiedFacts, setVerifiedFacts] = React.useState<VerifiedFactChoice[]>(
    []
  );
  const [loadingFacts, setLoadingFacts] = React.useState(false);
  const [selectedFactKey, setSelectedFactKey] = React.useState<string>("");
  const [savingClaim, setSavingClaim] = React.useState(false);

  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const latestSnapshotRef = React.useRef<StudioSnapshot | null>(null);
  const isDirtyRef = React.useRef(false);

  const applyDraftPayload = React.useCallback((loaded: ResumeDraftDetail) => {
    setDraft(loaded);
    setStructuredContent(loaded.structuredContent);
    setTemplateSettings(loaded.templateSettings);
    setServerPreviewHtml(loaded.renderedPreviewHtml);
    latestSnapshotRef.current = {
      structuredContent: loaded.structuredContent,
      templateSettings: loaded.templateSettings,
    };
    isDirtyRef.current = false;
    setSaveStatus("saved");
  }, []);

  const loadDraft = React.useCallback(async () => {
    try {
      const loaded = await getResumeDraft(draftId);
      setLoadError(null);
      applyDraftPayload(loaded);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load resume draft."
      );
    } finally {
      setLoading(false);
    }
  }, [applyDraftPayload, draftId]);

  React.useEffect(() => {
    let active = true;
    void getResumeDraft(draftId)
      .then((loaded) => {
        if (!active) return;
        setLoadError(null);
        applyDraftPayload(loaded);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(
          err instanceof Error ? err.message : "Could not load resume draft."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyDraftPayload, draftId]);

  React.useEffect(() => {
    return subscribe((msg) => {
      if (msg.kind === "event" && msg.event.resourceId === draftId) {
        if (!isDirtyRef.current) {
          void loadDraft();
        }
      }
    });
  }, [draftId, loadDraft, subscribe]);

  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (isDirtyRef.current && latestSnapshotRef.current) {
        const snap = latestSnapshotRef.current;
        isDirtyRef.current = false;
        void fetch(`/api/resumes/${encodeURIComponent(draftId)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            structuredContent: reindexStructuredContent(snap.structuredContent),
            templateSettings: snap.templateSettings,
          }),
          keepalive: true,
        }).catch(() => undefined);
      }
    };
  }, [draftId]);

  const persistSnapshot = React.useCallback(
    async (snapshot: StudioSnapshot) => {
      setSaveStatus("saving");
      try {
        const updated = await updateResumeDraft(draftId, {
          structuredContent: reindexStructuredContent(snapshot.structuredContent),
          templateSettings: snapshot.templateSettings,
        });
        setDraft(updated);
        setServerPreviewHtml(updated.renderedPreviewHtml);
        if (!isDirtyRef.current) {
          setSaveStatus("saved");
        }
      } catch (err) {
        setSaveStatus("error");
        toast({
          title: "Autosave failed",
          description:
            err instanceof Error ? err.message : "Could not save changes.",
          tone: "danger",
        });
      }
    },
    [draftId, toast]
  );

  const scheduleAutosave = React.useCallback(
    (nextSnapshot: StudioSnapshot, recordUndo = true) => {
      if (recordUndo && latestSnapshotRef.current) {
        const prevSnap = latestSnapshotRef.current;
        setUndoStack((stack) => [...stack.slice(-24), prevSnap]);
      }
      latestSnapshotRef.current = nextSnapshot;
      isDirtyRef.current = true;
      setSaveStatus("dirty");

      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = setTimeout(() => {
        isDirtyRef.current = false;
        void persistSnapshot(nextSnapshot);
      }, 500);
    },
    [persistSnapshot]
  );

  const updateContent = React.useCallback(
    (
      updater: (prev: StructuredResumeContent) => StructuredResumeContent,
      recordUndo = true
    ) => {
      setStructuredContent((prev) => {
        if (!prev || !templateSettings) return prev;
        const nextContent = reindexStructuredContent(updater(prev));
        scheduleAutosave(
          {
            structuredContent: nextContent,
            templateSettings,
          },
          recordUndo
        );
        return nextContent;
      });
    },
    [scheduleAutosave, templateSettings]
  );

  const updateSettings = React.useCallback(
    (
      updater: (prev: ResumeTemplateSettings) => ResumeTemplateSettings,
      recordUndo = true
    ) => {
      setTemplateSettings((prev) => {
        if (!prev || !structuredContent) return prev;
        const nextSettings = updater(prev);
        scheduleAutosave(
          {
            structuredContent,
            templateSettings: nextSettings,
          },
          recordUndo
        );
        return nextSettings;
      });
    },
    [scheduleAutosave, structuredContent]
  );

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setStructuredContent(previous.structuredContent);
    setTemplateSettings(previous.templateSettings);
    scheduleAutosave(previous, false);
  };

  const ensureVerifiedFactsLoaded = React.useCallback(async () => {
    if (verifiedFacts.length > 0 || loadingFacts) return;
    setLoadingFacts(true);
    try {
      const profile = await getCareerProfile();
      const linkByTarget = new Map<string, string>();
      for (const link of profile.evidenceLinks) {
        if (link.verificationStatus !== "rejected") {
          const k = `${link.targetType}:${link.targetId}`;
          if (!linkByTarget.has(k)) linkByTarget.set(k, link.id);
        }
      }
      const choices: VerifiedFactChoice[] = [];
      for (const exp of profile.experiences) {
        if (exp.verificationStatus === "verified") {
          const key = `experience:${exp.id}`;
          choices.push({
            key,
            factType: "experience",
            factId: exp.id,
            label: `Experience · ${exp.title} at ${exp.employer}`,
            excerpt:
              exp.description?.slice(0, 140) || `${exp.title} at ${exp.employer}`,
            evidenceLinkId: linkByTarget.get(key) ?? null,
          });
        }
      }
      for (const proj of profile.projects) {
        if (proj.verificationStatus === "verified") {
          const key = `project:${proj.id}`;
          choices.push({
            key,
            factType: "project",
            factId: proj.id,
            label: `Project · ${proj.name}`,
            excerpt: proj.outcomes || proj.description || proj.name,
            evidenceLinkId: linkByTarget.get(key) ?? null,
          });
        }
      }
      for (const ach of profile.achievements) {
        if (ach.verificationStatus === "verified") {
          const key = `achievement:${ach.id}`;
          choices.push({
            key,
            factType: "achievement",
            factId: ach.id,
            label: `Achievement · ${ach.text.slice(0, 80)}`,
            excerpt: ach.text,
            evidenceLinkId: linkByTarget.get(key) ?? null,
          });
        }
      }
      for (const sk of profile.skills) {
        if (sk.verificationStatus === "verified") {
          const key = `skill:${sk.id}`;
          choices.push({
            key,
            factType: "skill",
            factId: sk.id,
            label: `Skill · ${sk.canonicalName}`,
            excerpt: sk.canonicalName,
            evidenceLinkId: linkByTarget.get(key) ?? null,
          });
        }
      }
      for (const cert of profile.certifications) {
        if (cert.verificationStatus === "verified") {
          const key = `certification:${cert.id}`;
          choices.push({
            key,
            factType: "certification",
            factId: cert.id,
            label: `Certification · ${cert.name}`,
            excerpt: `${cert.name}${cert.issuer ? ` (${cert.issuer})` : ""}`,
            evidenceLinkId: linkByTarget.get(key) ?? null,
          });
        }
      }
      for (const edu of profile.education) {
        if (edu.verificationStatus === "verified") {
          const key = `education:${edu.id}`;
          choices.push({
            key,
            factType: "education",
            factId: edu.id,
            label: `Education · ${edu.qualification} (${edu.institution})`,
            excerpt: `${edu.qualification} — ${edu.institution}`,
            evidenceLinkId: linkByTarget.get(key) ?? null,
          });
        }
      }
      setVerifiedFacts(choices);
      if (choices.length > 0 && !selectedFactKey) {
        setSelectedFactKey(choices[0].key);
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
  }, [loadingFacts, selectedFactKey, toast, verifiedFacts.length]);

  const handleOpenEvidence = (target: ActiveEvidenceTarget) => {
    setEvidenceTarget(target);
    void ensureVerifiedFactsLoaded();
  };

  const syncClaimEvidence = async (
    nextRefs: ResumeEvidenceRef[],
    nextVerificationStatus: ClaimVerificationStatus,
    nextEditedState: UserEditedState
  ) => {
    if (!evidenceTarget || !structuredContent || !templateSettings) return;
    setSavingClaim(true);
    try {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
        isDirtyRef.current = false;
        await updateResumeDraft(draftId, {
          structuredContent: reindexStructuredContent(structuredContent),
          templateSettings,
        });
      }

      const updated = await updateResumeClaim(draftId, evidenceTarget.claimId, {
        text: evidenceTarget.text,
        verificationStatus: nextVerificationStatus as VerificationStatus,
        userEditedState: nextEditedState,
        evidenceRefs: nextRefs.map((ref) => ({
          factType: ref.factType,
          factId: ref.factId,
          excerpt: ref.excerpt ?? null,
          evidenceLinkId: ref.evidenceLinkId ?? null,
        })),
      });

      applyDraftPayload(updated);
      setEvidenceTarget((prev) =>
        prev
          ? {
              ...prev,
              evidenceRefs: nextRefs,
              verificationStatus: nextVerificationStatus,
              userEditedState: nextEditedState,
            }
          : null
      );
      toast({
        title: "Claim evidence updated",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not update claim evidence",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setSavingClaim(false);
    }
  };

  const handleAttachSelectedFact = () => {
    if (!evidenceTarget) return;
    const chosen = verifiedFacts.find((f) => f.key === selectedFactKey);
    if (!chosen) return;
    const alreadyExists = evidenceTarget.evidenceRefs.some(
      (r) => r.factType === chosen.factType && r.factId === chosen.factId
    );
    if (alreadyExists) {
      toast({
        title: "Fact already linked to this claim",
        tone: "neutral",
      });
      return;
    }
    const nextRefs: ResumeEvidenceRef[] = [
      ...evidenceTarget.evidenceRefs,
      {
        factType: chosen.factType,
        factId: chosen.factId,
        excerpt: chosen.excerpt,
        label: chosen.label,
        evidenceLinkId: chosen.evidenceLinkId,
      },
    ];
    void syncClaimEvidence(nextRefs, "verified", evidenceTarget.userEditedState);
  };

  const handleDetachEvidence = (factType: string, factId: string) => {
    if (!evidenceTarget) return;
    const nextRefs = evidenceTarget.evidenceRefs.filter(
      (r) => !(r.factType === factType && r.factId === factId)
    );
    const nextVer: ClaimVerificationStatus =
      nextRefs.length > 0 ? evidenceTarget.verificationStatus : "needs_review";
    void syncClaimEvidence(nextRefs, nextVer, evidenceTarget.userEditedState);
  };

  const handleVerifyManualEdit = () => {
    if (!evidenceTarget) return;
    void syncClaimEvidence(
      evidenceTarget.evidenceRefs,
      "verified",
      "user_verified"
    );
  };

  const handleCreateVersion = async () => {
    if (!structuredContent || !templateSettings) return;
    setCreatingVersion(true);
    try {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
        isDirtyRef.current = false;
      }
      await updateResumeDraft(draftId, {
        structuredContent: reindexStructuredContent(structuredContent),
        templateSettings,
      });
      const res = await createResumeVersion(draftId);
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              versions:
                res.versions.length > 0 ? res.versions : prev.versions,
              versionCount:
                res.versions.length > 0
                  ? res.versions.length
                  : prev.versionCount,
            }
          : prev
      );
      toast({
        title: res.version
          ? `Saved immutable snapshot v${res.version.versionNumber}`
          : "Saved immutable resume version",
        tone: "accent",
      });
      void loadDraft();
    } catch (err) {
      toast({
        title: "Could not snapshot resume version",
        description: err instanceof Error ? err.message : "Snapshot failed.",
        tone: "danger",
      });
    } finally {
      setCreatingVersion(false);
    }
  };

  const handleExport = async (format: ExportFormat) => {
    if (!structuredContent || !templateSettings) return;
    setExportingFormat(format);
    setPdfMissingNotice(null);
    try {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
        isDirtyRef.current = false;
      }
      await updateResumeDraft(draftId, {
        structuredContent: reindexStructuredContent(structuredContent),
        templateSettings,
      });

      const res = await exportResumeDraft(draftId, format);
      if (res.downloadUrl) {
        triggerBrowserDownload(res.downloadUrl);
      }
      toast({
        title: `Exported ${format.toUpperCase()}`,
        description: res.version
          ? `Immutable snapshot v${res.version.versionNumber} saved.`
          : "Download started.",
        tone: "accent",
      });
      void loadDraft();
    } catch (err) {
      if (
        err instanceof ResumeApiError &&
        err.code === "PDF_BROWSER_MISSING"
      ) {
        setPdfMissingNotice(err.message);
        toast({
          title: "PDF browser runtime missing",
          description:
            "Install the local Chromium runtime using `npm run setup:pdf-browser` to export PDFs.",
          tone: "warning",
        });
      } else {
        toast({
          title: `Could not export ${format.toUpperCase()}`,
          description: err instanceof Error ? err.message : "Export failed.",
          tone: "danger",
        });
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const previewHtml = React.useMemo(() => {
    if (!structuredContent || !templateSettings) return "";
    if (serverPreviewHtml && saveStatus === "saved") {
      return serverPreviewHtml;
    }
    return buildClientResumePreviewHtml(structuredContent, templateSettings);
  }, [saveStatus, serverPreviewHtml, structuredContent, templateSettings]);

  const draftEstimatedPages = draft?.estimatedPages ?? null;
  const estimatedPages = React.useMemo(() => {
    if (!structuredContent || !templateSettings) return 1;
    if (draftEstimatedPages && saveStatus === "saved") {
      return draftEstimatedPages;
    }
    return estimateResumePages(structuredContent, templateSettings);
  }, [draftEstimatedPages, saveStatus, structuredContent, templateSettings]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-14 w-full rounded-[8px]" />
        <div className="grid gap-4 min-[1100px]:grid-cols-[44%_56%]">
          <Skeleton className="h-[640px] w-full rounded-[8px]" />
          <Skeleton className="h-[640px] w-full rounded-[8px]" />
        </div>
      </div>
    );
  }

  if (loadError || !draft || !structuredContent || !templateSettings) {
    return (
      <div className="rounded-[8px] border border-[#E4B8B4] bg-[#F8EAE8] p-6 text-[14px] text-[var(--danger)]">
        <p className="font-semibold">Could not open resume studio</p>
        <p className="mt-1 text-[13px]">
          {loadError ?? "Resume draft was not found."}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void loadDraft()}>
            Retry
          </Button>
          <Link
            href="/resumes"
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)]"
          >
            Back to Resumes
          </Link>
        </div>
      </div>
    );
  }

  const allVersions: ResumeVersionRecord[] = draft.versions;
  const allExports: DocumentExportRecord[] = [
    ...draft.exports,
    ...allVersions.flatMap((v) => v.exports),
  ].filter(
    (exp, idx, arr) => arr.findIndex((other) => other.id === exp.id) === idx
  );

  const paperAspectRatio =
    templateSettings.paperSize === "Letter" ? "8.5 / 11" : "210 / 297";

  return (
    <div className="space-y-4 pb-8">
      {/* Studio Top Bar */}
      <div className="flex flex-col gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <Link
                href="/resumes"
                className="inline-flex items-center gap-1 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Resumes
              </Link>
              <span aria-hidden="true">/</span>
              {draft.jobId ? (
                <Link
                  href={`/jobs/${encodeURIComponent(draft.jobId)}`}
                  className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
                >
                  <span>{draft.companyName}</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </Link>
              ) : (
                <span>{draft.companyName}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="truncate text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">
                {draft.jobTitle}
              </h2>
              <Badge
                tone={
                  saveStatus === "error"
                    ? "danger"
                    : saveStatus === "saving" || saveStatus === "dirty"
                      ? "warning"
                      : "accent"
                }
              >
                {saveStatus === "saving"
                  ? "Saving..."
                  : saveStatus === "dirty"
                    ? "Unsaved edits"
                    : saveStatus === "error"
                      ? "Save failed"
                      : "Saved"}
              </Badge>
              {draft.searchProfileName ? (
                <Badge tone="neutral">{draft.searchProfileName}</Badge>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={undoStack.length === 0}
              onClick={handleUndo}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Undo ({undoStack.length})
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowLayoutControls((v) => !v)}
              aria-expanded={showLayoutControls}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Layout &amp; Paper
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowVersionHistory((v) => !v)}
              aria-expanded={showVersionHistory}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              Versions ({allVersions.length})
            </Button>

            <Button
              variant="secondary"
              size="sm"
              loading={creatingVersion}
              onClick={() => void handleCreateVersion()}
            >
              Snapshot version
            </Button>
          </div>
        </div>

        {/* Export & Format Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <span className="font-data">
              Paper: {templateSettings.paperSize}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-data">
              Margins: {templateSettings.marginPreset}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-data">
              Est. {estimatedPages} {estimatedPages === 1 ? "page" : "pages"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={exportingFormat === "docx"}
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("docx")}
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
              Export DOCX
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={exportingFormat === "pdf"}
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("pdf")}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              Export PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={exportingFormat === "md"}
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("md")}
            >
              <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
              Export Markdown
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={exportingFormat === "txt"}
              disabled={exportingFormat !== null}
              onClick={() => void handleExport("txt")}
            >
              Export TXT
            </Button>
          </div>
        </div>

        {/* PDF Browser Missing Notice */}
        {pdfMissingNotice ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] p-3 text-[13px] text-[var(--text-primary)]"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="font-semibold">
                  Local Playwright PDF browser runtime is not installed
                </p>
                <p className="text-[12px] text-[var(--text-secondary)]">
                  {pdfMissingNotice} Run the setup script once in your workspace
                  directory to install the pinned Chromium runtime under{" "}
                  <code className="font-data">APP_DATA_DIR</code>, then retry
                  PDF export (DOCX, Markdown, and TXT remain available):
                </p>
                <div className="mt-1 inline-flex items-center gap-2 rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 font-data text-[12px]">
                  <Terminal
                    className="h-3.5 w-3.5 text-[var(--accent)]"
                    aria-hidden="true"
                  />
                  <span>npm run setup:pdf-browser</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Layout & Paper Controls Panel */}
        {showLayoutControls ? (
          <div className="grid gap-4 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                Paper size
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-1">
                {(["A4", "Letter"] as PaperSize[]).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() =>
                      updateSettings((prev) => ({ ...prev, paperSize: size }))
                    }
                    className={cn(
                      "h-7 rounded-[4px] text-[12px] font-medium transition-colors",
                      templateSettings.paperSize === size
                        ? "bg-[var(--accent)] text-[var(--on-accent)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    {size === "Letter" ? "US Letter" : "A4"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                Margin preset
              </label>
              <Select
                value={templateSettings.marginPreset}
                onValueChange={(val) =>
                  updateSettings((prev) => ({
                    ...prev,
                    marginPreset: val as MarginPreset,
                  }))
                }
              >
                <SelectTrigger className="h-8 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="relaxed">Relaxed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                Font scale
              </label>
              <Select
                value={String(templateSettings.fontSizeScale)}
                onValueChange={(val) =>
                  updateSettings((prev) => ({
                    ...prev,
                    fontSizeScale: Number(val),
                  }))
                }
              >
                <SelectTrigger className="h-8 font-data text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.9">90% (Compact)</SelectItem>
                  <SelectItem value="0.95">95%</SelectItem>
                  <SelectItem value="1">100% (Standard)</SelectItem>
                  <SelectItem value="1.05">105%</SelectItem>
                  <SelectItem value="1.1">110% (Large)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                Line height scale
              </label>
              <Select
                value={String(templateSettings.lineHeightScale)}
                onValueChange={(val) =>
                  updateSettings((prev) => ({
                    ...prev,
                    lineHeightScale: Number(val),
                  }))
                }
              >
                <SelectTrigger className="h-8 font-data text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.9">0.90x (Tight)</SelectItem>
                  <SelectItem value="1">1.00x (Standard)</SelectItem>
                  <SelectItem value="1.1">1.10x</SelectItem>
                  <SelectItem value="1.2">1.20x (Relaxed)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border-t border-[var(--border)] pt-3 sm:col-span-2 lg:col-span-4">
              <div className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">
                Optional section visibility
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {VISIBILITY_TOGGLES.map((item) => {
                  const checked = templateSettings[item.key];
                  return (
                    <label
                      key={item.key}
                      className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-primary)]"
                    >
                      <Switch
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          updateSettings((prev) => ({
                            ...prev,
                            [item.key]: nextChecked,
                          }))
                        }
                      />
                      <span>{item.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {/* Immutable Version History Panel */}
        {showVersionHistory ? (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                Immutable version history
              </h3>
              <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                Profile hash:{" "}
                {draft.careerProfileHash
                  ? draft.careerProfileHash.slice(0, 8)
                  : "—"}
              </span>
            </div>

            {allVersions.length === 0 && allExports.length === 0 ? (
              <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
                No immutable versions yet. Exporting DOCX, PDF, Markdown, or TXT
                automatically creates an immutable version snapshot.
              </p>
            ) : (
              <div className="mt-2.5 divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {allVersions.map((ver) => (
                  <div
                    key={ver.id}
                    className="flex flex-col justify-between gap-2 py-2.5 sm:flex-row sm:items-center"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <Badge tone="accent" className="font-data">
                        v{ver.versionNumber}
                      </Badge>
                      <span className="font-data text-[11px] text-[var(--text-secondary)]">
                        sha256:{ver.contentHash.slice(0, 10)}
                      </span>
                      <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                        {formatDateTime(ver.createdAt)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {ver.exports.map((exp) =>
                        exp.downloadUrl ? (
                          <a
                            key={exp.id}
                            href={exp.downloadUrl}
                            download
                            className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface)] px-2 font-data text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
                          >
                            <Download className="h-3 w-3" aria-hidden="true" />
                            <span>{exp.format.toUpperCase()}</span>
                          </a>
                        ) : null
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Mobile (<1100px) Segmented Edit | Preview Switcher */}
      <div className="flex items-center justify-between gap-2 min-[1100px]:hidden">
        <div
          role="tablist"
          aria-label="Resume studio view"
          className="inline-grid w-full max-w-[260px] grid-cols-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === "edit"}
            onClick={() => setMobilePane("edit")}
            className={cn(
              "h-8 rounded-[4px] text-[13px] font-medium transition-colors",
              mobilePane === "edit"
                ? "bg-[var(--accent)] text-[var(--on-accent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            Edit
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobilePane === "preview"}
            onClick={() => setMobilePane("preview")}
            className={cn(
              "h-8 rounded-[4px] text-[13px] font-medium transition-colors",
              mobilePane === "preview"
                ? "bg-[var(--accent)] text-[var(--on-accent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            Preview
          </button>
        </div>
        <span className="font-data text-[12px] text-[var(--text-secondary)]">
          {estimatedPages}p · {templateSettings.paperSize}
        </span>
      </div>

      {/* Split-Pane Studio: >=1100px 44% Editor Rail / 56% Live Paper Preview */}
      <div className="grid gap-5 min-[1100px]:grid-cols-[44%_56%] min-[1100px]:items-start">
        {/* Left Editor Rail */}
        <div
          className={cn(
            "space-y-3",
            mobilePane === "preview" ? "hidden min-[1100px]:block" : "block"
          )}
        >
          {structuredContent.gapAnalysis &&
          structuredContent.gapAnalysis.length > 0 ? (
            <div className="rounded-[8px] border border-[#DFC99B] bg-[#F5EFE2] p-3 text-[12px]">
              <div className="font-semibold text-[var(--warning)]">
                Unverified JD gaps ({structuredContent.gapAnalysis.length})
              </div>
              <p className="mt-0.5 text-[var(--text-secondary)]">
                These job requirements had no supporting verified profile facts
                and were intentionally omitted from resume claims:
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[var(--text-primary)]">
                {structuredContent.gapAnalysis.slice(0, 4).map((gap, idx) => (
                  <li key={gap.requirementId ?? idx}>{gap.text}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Sortable Sections & Bullets via @dnd-kit/react */}
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled) return;
              const sourceType = event.operation.source?.type;
              if (sourceType === "section") {
                updateContent((prev) => ({
                  ...prev,
                  sections: move(prev.sections, event),
                }));
                return;
              }
              if (
                typeof sourceType === "string" &&
                sourceType.startsWith("bullet:")
              ) {
                const entryId = sourceType.slice("bullet:".length);
                updateContent((prev) => ({
                  ...prev,
                  sections: prev.sections.map((sec) => ({
                    ...sec,
                    entries: sec.entries.map((ent) =>
                      ent.id === entryId
                        ? { ...ent, bullets: move(ent.bullets, event) }
                        : ent
                    ),
                  })),
                }));
              }
            }}
          >
            <div className="space-y-3">
              {structuredContent.sections.map((section, sIdx) => (
                <SortableSectionCard
                  key={section.id}
                  section={section}
                  index={sIdx}
                  total={structuredContent.sections.length}
                  onMoveUp={() =>
                    updateContent((prev) => ({
                      ...prev,
                      sections: arraySwapItems(prev.sections, sIdx, sIdx - 1),
                    }))
                  }
                  onMoveDown={() =>
                    updateContent((prev) => ({
                      ...prev,
                      sections: arraySwapItems(prev.sections, sIdx, sIdx + 1),
                    }))
                  }
                  onUpdateSection={(updater) =>
                    updateContent((prev) => ({
                      ...prev,
                      sections: prev.sections.map((s) =>
                        s.id === section.id ? updater(s) : s
                      ),
                    }))
                  }
                  onOpenEvidence={handleOpenEvidence}
                />
              ))}
            </div>
          </DragDropProvider>
        </div>

        {/* Right Live A4 / US Letter Paper Preview */}
        <div
          className={cn(
            "min-[1100px]:sticky min-[1100px]:top-4",
            mobilePane === "edit" ? "hidden min-[1100px]:block" : "block"
          )}
        >
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--text-secondary)]">
              <span className="font-medium text-[var(--text-primary)]">
                Live ATS-safe preview (
                {templateSettings.paperSize === "Letter"
                  ? "8.5 × 11 in"
                  : "210 × 297 mm"}
                )
              </span>
              <span className="font-data">
                Estimated {estimatedPages}{" "}
                {estimatedPages === 1 ? "page" : "pages"}
              </span>
            </div>

            <div className="relative mx-auto w-full max-w-[760px] overflow-hidden rounded-[4px] border border-[var(--border-strong)] bg-white shadow-[0_8px_28px_rgba(34,35,31,0.10)]">
              <div
                style={{
                  aspectRatio: paperAspectRatio,
                  minHeight: estimatedPages > 1 ? "980px" : undefined,
                }}
                className="relative w-full bg-white"
              >
                <iframe
                  title="Live resume preview"
                  srcDoc={previewHtml}
                  sandbox=""
                  className="h-full w-full border-0 bg-white"
                  style={{
                    minHeight:
                      estimatedPages > 1
                        ? `${estimatedPages * 780}px`
                        : "780px",
                  }}
                />
                {estimatedPages > 1 ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-[var(--warning)]/60"
                    style={{ top: `${Math.round(100 / estimatedPages)}%` }}
                  >
                    <span className="ml-2 inline-block -translate-y-1/2 rounded-[3px] bg-[#F5EFE2] px-1.5 py-0.5 font-data text-[10px] text-[var(--warning)]">
                      Page 1 / Page 2 guide
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Claim Evidence Inspector Drawer */}
      <Drawer
        open={Boolean(evidenceTarget)}
        onOpenChange={(open) => {
          if (!open) setEvidenceTarget(null);
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Claim provenance &amp; evidence</DrawerTitle>
            <DrawerDescription>
              {evidenceTarget?.label ?? "Selected resume claim"}
            </DrawerDescription>
          </DrawerHeader>

          <DrawerBody className="space-y-5">
            {evidenceTarget ? (
              <>
                <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                      Claim text
                    </span>
                    {(() => {
                      const b = provenanceBadge(
                        evidenceTarget.evidenceRefs,
                        evidenceTarget.verificationStatus,
                        evidenceTarget.userEditedState
                      );
                      return <Badge tone={b.tone}>{b.label}</Badge>;
                    })()}
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-primary)]">
                    {evidenceTarget.text || "(Empty claim)"}
                  </p>
                </div>

                {/* Linked Evidence Facts */}
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                    Linked career evidence ({evidenceTarget.evidenceRefs.length})
                  </h4>

                  {evidenceTarget.evidenceRefs.length === 0 ? (
                    <p className="rounded-[6px] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-3 text-[12px] text-[var(--text-secondary)]">
                      No verified career profile fact is linked to this claim yet.
                      Attach a verified fact below or verify your manual edit.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {evidenceTarget.evidenceRefs.map((ref) => (
                        <div
                          key={`${ref.factType}:${ref.factId}`}
                          className="flex items-start justify-between gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-[12px]"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <Badge tone="accent" className="text-[11px]">
                                {ref.factType}
                              </Badge>
                              <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                                {ref.factId}
                              </span>
                            </div>
                            {ref.excerpt || ref.label ? (
                              <p className="text-[var(--text-primary)]">
                                {ref.excerpt ?? ref.label}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={savingClaim}
                            onClick={() =>
                              handleDetachEvidence(ref.factType, ref.factId)
                            }
                            aria-label="Detach evidence link"
                          >
                            Detach
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Attach Verified Fact */}
                <div className="space-y-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <h4 className="text-[12px] font-semibold text-[var(--text-primary)]">
                    Attach verified career profile fact
                  </h4>
                  {loadingFacts ? (
                    <Skeleton className="h-9 w-full rounded-[6px]" />
                  ) : verifiedFacts.length === 0 ? (
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      No verified facts found in your Career Profile.{" "}
                      <Link
                        href="/profile"
                        className="font-medium text-[var(--accent)] underline"
                      >
                        Verify facts in Profile
                      </Link>
                      .
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <Select
                        value={selectedFactKey}
                        onValueChange={setSelectedFactKey}
                      >
                        <SelectTrigger className="h-9 text-[12px]">
                          <SelectValue placeholder="Choose a verified fact..." />
                        </SelectTrigger>
                        <SelectContent>
                          {verifiedFacts.map((fact) => (
                            <SelectItem key={fact.key} value={fact.key}>
                              {fact.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={savingClaim}
                        onClick={handleAttachSelectedFact}
                      >
                        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Attach fact
                      </Button>
                    </div>
                  )}
                </div>

                {/* Explicit Manual Verification */}
                <div className="space-y-2 border-t border-[var(--border)] pt-4">
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    Confirm that you reviewed this claim and its wording is
                    accurate and truthful to your career history.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={savingClaim}
                    disabled={
                      evidenceTarget.verificationStatus === "verified" &&
                      evidenceTarget.userEditedState === "user_verified"
                    }
                    onClick={handleVerifyManualEdit}
                  >
                    {evidenceTarget.verificationStatus === "verified" &&
                    evidenceTarget.userEditedState === "user_verified" ? (
                      <>
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Manual edit verified
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Verify manual edit
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : null}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
