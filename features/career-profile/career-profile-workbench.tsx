"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/components/ui/cn";
import { getCareerProfile } from "./api";
import {
  AchievementsSection,
  ContactSectionEditor,
  CredentialsSection,
  DocumentsSection,
  ExperiencesSection,
  ProjectsSection,
  SkillsSection,
} from "./entity-editors";
import { ImportReviewPanel } from "./import-review-panel";
import {
  createEmptyProfileHeader,
  matchesVerificationFilter,
  type CareerProfilePayload,
  type EvidenceLinkRecord,
  type ProfileTabKey,
  type SourceDocumentRecord,
  type VerificationFilter,
} from "./types";

const FILTER_OPTIONS: Array<{ value: VerificationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs_review", label: "Needs review" },
  { value: "verified", label: "Verified" },
  { value: "archived_rejected", label: "Archived/Rejected" },
];

const EMPTY_PAYLOAD: CareerProfilePayload = {
  profile: createEmptyProfileHeader(),
  experiences: [],
  projects: [],
  achievements: [],
  skills: [],
  education: [],
  certifications: [],
  languages: [],
  sourceDocuments: [],
  evidenceLinks: [],
  needsReviewCount: 0,
};

/**
 * Quiet-workbench Career Profile page combining structured fact authoring,
 * verification filtering, and side-by-side resume import review.
 */
export function CareerProfileWorkbench() {
  const [data, setData] = React.useState<CareerProfilePayload>(EMPTY_PAYLOAD);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [activeTab, setActiveTab] = React.useState<ProfileTabKey>("contact");
  const [filter, setFilter] = React.useState<VerificationFilter>("all");
  const [searchQuery, setSearchQuery] = React.useState("");

  const [importOpen, setImportOpen] = React.useState(false);
  const [inspectDocId, setInspectDocId] = React.useState<string>("");
  const [inspectExcerpt, setInspectExcerpt] = React.useState<string>("");
  const importSectionRef = React.useRef<HTMLDivElement | null>(null);

  const refreshProfile = React.useCallback(async () => {
    try {
      const next = await getCareerProfile();
      setData(next);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : "Career profile API is not reachable yet."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    getCareerProfile()
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : "Career profile API is not reachable yet."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const documentsById = React.useMemo(
    () => new Map<string, SourceDocumentRecord>(data.sourceDocuments.map((d) => [d.id, d])),
    [data.sourceDocuments]
  );

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

  const verificationSummary = React.useMemo(() => {
    const allFacts = [
      ...data.experiences,
      ...data.projects,
      ...data.achievements,
      ...data.skills,
      ...data.education,
      ...data.certifications,
      ...data.languages,
    ];
    let verifiedCount = allFacts.filter(
      (item) => item.verificationStatus === "verified"
    ).length;
    let needsReviewCount = allFacts.filter(
      (item) => item.verificationStatus === "needs_review"
    ).length;

    if (
      data.profile.fullName ||
      data.profile.headline ||
      data.profile.email ||
      data.profile.summary
    ) {
      if (data.profile.verificationStatus === "verified") verifiedCount += 1;
      if (data.profile.verificationStatus === "needs_review")
        needsReviewCount += 1;
    }

    return {
      verifiedCount,
      needsReviewCount: Math.max(needsReviewCount, data.needsReviewCount),
    };
  }, [data]);

  const tabCounts = React.useMemo(() => {
    const countMatching = (items: Array<{ verificationStatus: "needs_review" | "verified" | "rejected" | "archived" }>) =>
      items.filter((i) => matchesVerificationFilter(i.verificationStatus, filter))
        .length;

    const countPending = (items: Array<{ verificationStatus: "needs_review" | "verified" | "rejected" | "archived" }>) =>
      items.filter((i) => i.verificationStatus === "needs_review").length;

    return {
      experiences: {
        visible: countMatching(data.experiences),
        pending: countPending(data.experiences),
      },
      projects: {
        visible: countMatching(data.projects),
        pending: countPending(data.projects),
      },
      achievements: {
        visible: countMatching(data.achievements),
        pending: countPending(data.achievements),
      },
      skills: {
        visible: countMatching(data.skills),
        pending: countPending(data.skills),
      },
      credentials: {
        visible:
          countMatching(data.education) +
          countMatching(data.certifications) +
          countMatching(data.languages),
        pending:
          countPending(data.education) +
          countPending(data.certifications) +
          countPending(data.languages),
      },
      documents: {
        visible: data.sourceDocuments.length,
        pending: 0,
      },
    };
  }, [data, filter]);

  const handleOpenImport = React.useCallback(() => {
    setImportOpen(true);
    setTimeout(() => {
      importSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 40);
  }, []);

  const handleInspectInSource = React.useCallback(
    (sourceDocumentId: string, excerpt?: string | null) => {
      setInspectDocId(sourceDocumentId);
      setInspectExcerpt(excerpt ?? "");
      setImportOpen(true);
      setTimeout(() => {
        importSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 40);
    },
    []
  );

  return (
    <div className="space-y-6">
      {/* Top editorial header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border)] pb-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Career profile
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Single source of candidate facts. Every imported or extracted item begins as{" "}
            <span className="font-medium text-[var(--text-primary)]">Needs review</span>{" "}
            until you explicitly mark it{" "}
            <span className="font-medium text-[var(--text-primary)]">Verified</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setFilter((prev) => (prev === "verified" ? "all" : "verified"))
            }
            className="inline-flex items-center rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            title="Filter to Verified facts"
          >
            <Badge
              tone="accent"
              className={cn(
                "cursor-pointer px-2.5 py-1 transition-opacity",
                filter === "verified" && "ring-1 ring-[var(--accent)]"
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-data">{verificationSummary.verifiedCount}</span>
              <span>verified</span>
            </Badge>
          </button>

          <button
            type="button"
            onClick={() =>
              setFilter((prev) =>
                prev === "needs_review" ? "all" : "needs_review"
              )
            }
            className="inline-flex items-center rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            title="Filter to Needs review facts"
          >
            <Badge
              tone="warning"
              className={cn(
                "cursor-pointer px-2.5 py-1 transition-opacity",
                filter === "needs_review" && "ring-1 ring-[var(--warning)]"
              )}
            >
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-data">
                {verificationSummary.needsReviewCount}
              </span>
              <span>needs review</span>
            </Badge>
          </button>

          <Button
            variant={importOpen ? "secondary" : "primary"}
            size="md"
            onClick={() => {
              if (importOpen) {
                setImportOpen(false);
              } else {
                handleOpenImport();
              }
            }}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{importOpen ? "Hide import review" : "Import resume"}</span>
          </Button>
        </div>
      </div>

      {/* API unavailable / error notice */}
      {loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#E4B8B4] bg-[#F8EAE8] px-4 py-3 text-[13px] text-[var(--danger)]"
        >
          <span>{loadError}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setLoading(true);
              void refreshProfile();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retry</span>
          </Button>
        </div>
      ) : null}

      {/* Side-by-side Import & Verification workspace */}
      {importOpen ? (
        <div ref={importSectionRef}>
          <ImportReviewPanel
            data={data}
            selectedDocId={inspectDocId}
            onSelectDocId={setInspectDocId}
            excerptHighlight={inspectExcerpt}
            onChangeExcerptHighlight={setInspectExcerpt}
            onRefresh={refreshProfile}
            onClose={() => setImportOpen(false)}
          />
        </div>
      ) : null}

      {/* Filter & search bar */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div
          role="group"
          aria-label="Filter facts by verification state"
          className="inline-flex flex-wrap items-center gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-1"
        >
          {FILTER_OPTIONS.map((opt) => {
            const active = filter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(opt.value)}
                className={cn(
                  "rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-[var(--text-tertiary)]"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter profile facts..."
            aria-label="Filter profile facts"
            className="pl-8 pr-8"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear filter"
              className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Loading skeleton vs tabbed sections */}
      {loading ? (
        <div className="space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-5">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as ProfileTabKey)}
          indicatorId="career-profile-tabs"
        >
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="contact">Contact &amp; Summary</TabsTrigger>
            <TabsTrigger value="experiences" className="gap-1.5">
              <span>Work Experience</span>
              <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                {tabCounts.experiences.visible}
              </span>
              {tabCounts.experiences.pending > 0 ? (
                <span
                  aria-label={`${tabCounts.experiences.pending} needs review`}
                  className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]"
                />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="projects" className="gap-1.5">
              <span>Projects</span>
              <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                {tabCounts.projects.visible}
              </span>
              {tabCounts.projects.pending > 0 ? (
                <span
                  aria-label={`${tabCounts.projects.pending} needs review`}
                  className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]"
                />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="achievements" className="gap-1.5">
              <span>Achievements</span>
              <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                {tabCounts.achievements.visible}
              </span>
              {tabCounts.achievements.pending > 0 ? (
                <span
                  aria-label={`${tabCounts.achievements.pending} needs review`}
                  className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]"
                />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="skills" className="gap-1.5">
              <span>Skills</span>
              <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                {tabCounts.skills.visible}
              </span>
              {tabCounts.skills.pending > 0 ? (
                <span
                  aria-label={`${tabCounts.skills.pending} needs review`}
                  className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]"
                />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="credentials" className="gap-1.5">
              <span>Education &amp; Credentials</span>
              <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                {tabCounts.credentials.visible}
              </span>
              {tabCounts.credentials.pending > 0 ? (
                <span
                  aria-label={`${tabCounts.credentials.pending} needs review`}
                  className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]"
                />
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="documents" className="gap-1.5">
              <span>Documents &amp; Evidence</span>
              <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                {tabCounts.documents.visible}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contact">
            <ContactSectionEditor
              key={data.profile.updatedAt}
              data={data}
              documentsById={documentsById}
              evidenceByTarget={evidenceByTarget}
              onRefresh={refreshProfile}
              onInspectInSource={handleInspectInSource}
            />
          </TabsContent>

          <TabsContent value="experiences">
            <ExperiencesSection
              data={data}
              filter={filter}
              searchQuery={searchQuery}
              documentsById={documentsById}
              evidenceByTarget={evidenceByTarget}
              onRefresh={refreshProfile}
              onInspectInSource={handleInspectInSource}
            />
          </TabsContent>

          <TabsContent value="projects">
            <ProjectsSection
              data={data}
              filter={filter}
              searchQuery={searchQuery}
              documentsById={documentsById}
              evidenceByTarget={evidenceByTarget}
              onRefresh={refreshProfile}
              onInspectInSource={handleInspectInSource}
            />
          </TabsContent>

          <TabsContent value="achievements">
            <AchievementsSection
              data={data}
              filter={filter}
              searchQuery={searchQuery}
              documentsById={documentsById}
              evidenceByTarget={evidenceByTarget}
              onRefresh={refreshProfile}
              onInspectInSource={handleInspectInSource}
            />
          </TabsContent>

          <TabsContent value="skills">
            <SkillsSection
              data={data}
              filter={filter}
              searchQuery={searchQuery}
              documentsById={documentsById}
              evidenceByTarget={evidenceByTarget}
              onRefresh={refreshProfile}
              onInspectInSource={handleInspectInSource}
            />
          </TabsContent>

          <TabsContent value="credentials">
            <CredentialsSection
              data={data}
              filter={filter}
              searchQuery={searchQuery}
              documentsById={documentsById}
              evidenceByTarget={evidenceByTarget}
              onRefresh={refreshProfile}
              onInspectInSource={handleInspectInSource}
            />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsSection
              data={data}
              documentsById={documentsById}
              onRefresh={refreshProfile}
              onInspectInSource={handleInspectInSource}
              onOpenImport={handleOpenImport}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
