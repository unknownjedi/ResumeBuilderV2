"use client";

import * as React from "react";
import {
  AlertTriangle,
  Award,
  Briefcase,
  Check,
  ExternalLink,
  Eye,
  FileText,
  FolderGit2,
  GraduationCap,
  Languages as LanguagesIcon,
  Plus,
  Tag,
  Trash2,
  User,
  Wrench,
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  createProfileEntity,
  deleteProfileEntity,
  deleteSourceDocument,
  saveProfileHeader,
  setEntityVerification,
  updateProfileEntity,
} from "./api";
import {
  formatBytes,
  formatDateRange,
  formatShortDate,
  matchesVerificationFilter,
  safeJsonMetrics,
  safeJsonStringArray,
  type AchievementRecord,
  type CareerProfilePayload,
  type EvidenceLinkRecord,
  type ExperienceRecord,
  type ProjectMetricItem,
  type ProjectRecord,
  type SkillRecord,
  type SourceDocumentRecord,
  type VerificationFilter,
  type VerificationStatus,
} from "./types";
import {
  EvidenceAccordion,
  OriginTag,
  VerificationActionBar,
  VerificationBadge,
} from "./verification-badge";

interface SharedSectionProps {
  data: CareerProfilePayload;
  filter: VerificationFilter;
  searchQuery: string;
  documentsById: Map<string, SourceDocumentRecord>;
  evidenceByTarget: Map<string, EvidenceLinkRecord[]>;
  onRefresh: () => Promise<void>;
  onInspectInSource: (sourceDocumentId: string, excerpt?: string | null) => void;
}

function includesSearch(haystack: Array<string | null | undefined>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((val) => val && val.toLowerCase().includes(q));
}

function toSafeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractCreatedId(res: Record<string, unknown>): string | null {
  if (typeof res.id === "string" && res.id) return res.id;
  for (const key of ["item", "record", "data", "skill"]) {
    const nested = res[key];
    if (
      nested &&
      typeof nested === "object" &&
      !Array.isArray(nested) &&
      typeof (nested as Record<string, unknown>).id === "string"
    ) {
      return (nested as Record<string, unknown>).id as string;
    }
  }
  return null;
}

/**
 * Inline skill tag selector supporting linking existing profile skills
 * or creating a new manual skill on the fly.
 */
function InlineSkillTagger({
  selectedSkillIds,
  allSkills,
  onChange,
  onSkillCreated,
}: {
  selectedSkillIds: string[];
  allSkills: SkillRecord[];
  onChange: (nextIds: string[]) => void;
  onSkillCreated: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const selectedSet = React.useMemo(
    () => new Set(selectedSkillIds),
    [selectedSkillIds]
  );

  const selectedSkills = React.useMemo(
    () =>
      selectedSkillIds
        .map((id) => allSkills.find((s) => s.id === id))
        .filter((s): s is SkillRecord => Boolean(s)),
    [allSkills, selectedSkillIds]
  );

  const suggestions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return allSkills
      .filter((s) => !selectedSet.has(s.id))
      .filter(
        (s) =>
          !q ||
          s.canonicalName.toLowerCase().includes(q) ||
          safeJsonStringArray(s.aliasesJson).some((a) =>
            a.toLowerCase().includes(q)
          )
      )
      .slice(0, 8);
  }, [allSkills, query, selectedSet]);

  const exactMatch = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (
      allSkills.find((s) => s.canonicalName.toLowerCase() === q) ?? null
    );
  }, [allSkills, query]);

  const addSkillId = (skillId: string) => {
    if (!selectedSet.has(skillId)) {
      onChange([...selectedSkillIds, skillId]);
    }
    setQuery("");
  };

  const removeSkillId = (skillId: string) => {
    onChange(selectedSkillIds.filter((id) => id !== skillId));
  };

  const handleCreateAndLink = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (exactMatch) {
      addSkillId(exactMatch.id);
      return;
    }
    setCreating(true);
    try {
      const created = await createProfileEntity("skills", {
        canonicalName: trimmed,
        origin: "manual",
        verificationStatus: "verified",
      });
      const newId = extractCreatedId(created);
      await onSkillCreated();
      if (newId) {
        onChange([...selectedSkillIds, newId]);
      }
      setQuery("");
      toast({
        title: `Skill "${trimmed}" added`,
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not add skill",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {selectedSkills.map((skill) => (
          <span
            key={skill.id}
            className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[12px] text-[var(--text-primary)]"
          >
            <Tag className="h-3 w-3 text-[var(--text-tertiary)]" aria-hidden="true" />
            <span>{skill.canonicalName}</span>
            <button
              type="button"
              onClick={() => removeSkillId(skill.id)}
              aria-label={`Remove ${skill.canonicalName}`}
              className="ml-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--danger)]"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {selectedSkills.length === 0 ? (
          <span className="text-[12px] text-[var(--text-tertiary)]">
            No skills tagged yet
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (exactMatch) {
                addSkillId(exactMatch.id);
              } else if (query.trim()) {
                void handleCreateAndLink();
              }
            }
          }}
          placeholder="Tag existing skill or type new skill name..."
          className="h-8 text-[13px]"
        />
        {query.trim() && !exactMatch ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={creating}
            onClick={() => void handleCreateAndLink()}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add &ldquo;{query.trim()}&rdquo;</span>
          </Button>
        ) : null}
      </div>

      {query.trim() && suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => addSkillId(s.id)}
              className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-0.5 text-[12px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] hover:text-[var(--text-primary)]"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              <span>{s.canonicalName}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LinkedSkillChips({
  skillIds,
  skillsById,
}: {
  skillIds: string[];
  skillsById: Map<string, SkillRecord>;
}) {
  const resolved = skillIds
    .map((id) => skillsById.get(id))
    .filter((s): s is SkillRecord => Boolean(s));
  if (resolved.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {resolved.map((skill) => (
        <span
          key={skill.id}
          className="inline-flex items-center rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[12px] text-[var(--text-secondary)]"
        >
          {skill.canonicalName}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Contact & Headline + Optional Summary                                   */
/* -------------------------------------------------------------------------- */

export function ContactSectionEditor({
  data,
  documentsById,
  evidenceByTarget,
  onRefresh,
  onInspectInSource,
}: Omit<SharedSectionProps, "filter" | "searchQuery">) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    fullName: data.profile.fullName,
    headline: data.profile.headline ?? "",
    email: data.profile.email ?? "",
    phone: data.profile.phone ?? "",
    location: data.profile.location ?? "",
    noticePeriod: data.profile.noticePeriod ?? "",
    workAuthorizationSummary: data.profile.workAuthorizationSummary ?? "",
    websiteUrl: data.profile.websiteUrl ?? "",
    linkedinUrl: data.profile.linkedinUrl ?? "",
    githubUrl: data.profile.githubUrl ?? "",
    summary: data.profile.summary ?? "",
  });
  const [saving, setSaving] = React.useState(false);
  const [verifying, setVerifying] = React.useState<VerificationStatus | null>(null);

  const profileEvidence = React.useMemo(
    () =>
      evidenceByTarget.get(`profile:${data.profile.id}`) ??
      evidenceByTarget.get("profile:1") ??
      [],
    [data.profile.id, evidenceByTarget]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveProfileHeader({
        fullName: form.fullName.trim(),
        headline: form.headline.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        location: form.location.trim() || null,
        noticePeriod: form.noticePeriod.trim() || null,
        workAuthorizationSummary: form.workAuthorizationSummary.trim() || null,
        websiteUrl: form.websiteUrl.trim() || null,
        linkedinUrl: form.linkedinUrl.trim() || null,
        githubUrl: form.githubUrl.trim() || null,
        summary: form.summary.trim() || null,
      });
      await onRefresh();
      toast({
        title: "Contact & headline saved",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not save contact details",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (next: VerificationStatus) => {
    setVerifying(next);
    try {
      await saveProfileHeader({
        fullName: form.fullName.trim(),
        headline: form.headline.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        location: form.location.trim() || null,
        noticePeriod: form.noticePeriod.trim() || null,
        workAuthorizationSummary: form.workAuthorizationSummary.trim() || null,
        websiteUrl: form.websiteUrl.trim() || null,
        linkedinUrl: form.linkedinUrl.trim() || null,
        githubUrl: form.githubUrl.trim() || null,
        summary: form.summary.trim() || null,
        verificationStatus: next,
      });
      await onRefresh();
      toast({
        title:
          next === "verified"
            ? "Profile contact verified"
            : `Profile status set to ${next}`,
        tone: next === "verified" ? "accent" : "neutral",
      });
    } catch (err) {
      toast({
        title: "Status update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setVerifying(null);
    }
  };

  return (
    <form
      onSubmit={handleSave}
      className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <User className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Contact &amp; professional headline
            </h3>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Core identity fields used in resume headers and application answers.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OriginTag origin={data.profile.origin} />
          <VerificationBadge status={data.profile.verificationStatus} />
          {data.profile.verificationStatus !== "verified" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={verifying === "verified"}
              onClick={() => void handleStatusChange("verified")}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Verify header</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2">
        <div>
          <label
            htmlFor="profile-full-name"
            className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]"
          >
            Full name
          </label>
          <Input
            id="profile-full-name"
            value={form.fullName}
            onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
            placeholder="Alex Rivera"
          />
        </div>

        <div>
          <label
            htmlFor="profile-headline"
            className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]"
          >
            Professional headline
          </label>
          <Input
            id="profile-headline"
            value={form.headline}
            onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
            placeholder="Staff Distributed Systems Engineer"
          />
        </div>

        <div>
          <label
            htmlFor="profile-email"
            className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]"
          >
            Email
          </label>
          <Input
            id="profile-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="alex@example.com"
          />
        </div>

        <div>
          <label
            htmlFor="profile-phone"
            className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]"
          >
            Phone
          </label>
          <Input
            id="profile-phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="+1 (555) 010-2000"
          />
        </div>

        <div>
          <label
            htmlFor="profile-location"
            className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]"
          >
            Location
          </label>
          <Input
            id="profile-location"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="San Francisco, CA (Remote / Hybrid)"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Notice period / availability
          </label>
          <Input
            value={form.noticePeriod}
            onChange={(e) =>
              setForm((f) => ({ ...f, noticePeriod: e.target.value }))
            }
            placeholder="e.g. 2 weeks, Immediate"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Website / portfolio URL
          </label>
          <Input
            value={form.websiteUrl}
            onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
            placeholder="https://example.dev"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            LinkedIn URL
          </label>
          <Input
            value={form.linkedinUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, linkedinUrl: e.target.value }))
            }
            placeholder="https://linkedin.com/in/..."
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            GitHub URL
          </label>
          <Input
            value={form.githubUrl}
            onChange={(e) => setForm((f) => ({ ...f, githubUrl: e.target.value }))}
            placeholder="https://github.com/..."
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Work authorization summary (optional)
          </label>
          <Input
            value={form.workAuthorizationSummary}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                workAuthorizationSummary: e.target.value,
              }))
            }
            placeholder="e.g. Authorized to work in US without sponsorship"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Summary / career objective (optional)
          </label>
          <Textarea
            rows={4}
            value={form.summary}
            onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            placeholder="Concise, grounded summary of your core engineering focus and domain experience."
          />
        </div>
      </div>

      {profileEvidence.length > 0 ? (
        <div className="px-5 py-2">
          <EvidenceAccordion
            links={profileEvidence}
            documentsById={documentsById}
            onInspectInSource={onInspectInSource}
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 bg-[var(--surface-raised)] px-5 py-3.5">
        <span className="font-data text-[12px] text-[var(--text-tertiary)]">
          Last updated {formatShortDate(data.profile.updatedAt)}
        </span>
        <Button type="submit" variant="primary" loading={saving}>
          Save contact &amp; summary
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Work Experience                                                         */
/* -------------------------------------------------------------------------- */

interface ExpFormState {
  title: string;
  employer: string;
  location: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
  skillIds: string[];
  verificationStatus: VerificationStatus;
}

const EMPTY_EXP_FORM: ExpFormState = {
  title: "",
  employer: "",
  location: "",
  employmentType: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  description: "",
  skillIds: [],
  verificationStatus: "verified",
};

export function ExperiencesSection({
  data,
  filter,
  searchQuery,
  documentsById,
  evidenceByTarget,
  onRefresh,
  onInspectInSource,
}: SharedSectionProps) {
  const { toast } = useToast();
  const [adding, setAdding] = React.useState(false);
  const [addForm, setAddForm] = React.useState<ExpFormState>(EMPTY_EXP_FORM);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<ExpFormState>(EMPTY_EXP_FORM);
  const [saving, setSaving] = React.useState(false);
  const [busyRow, setBusyRow] = React.useState<{
    id: string;
    action: VerificationStatus | "delete";
  } | null>(null);

  const skillsById = React.useMemo(
    () => new Map(data.skills.map((s) => [s.id, s])),
    [data.skills]
  );

  const filtered = React.useMemo(
    () =>
      data.experiences.filter(
        (exp) =>
          matchesVerificationFilter(exp.verificationStatus, filter) &&
          includesSearch(
            [
              exp.title,
              exp.employer,
              exp.location,
              exp.description,
              ...exp.skillIds.map((id) => skillsById.get(id)?.canonicalName),
            ],
            searchQuery
          )
      ),
    [data.experiences, filter, searchQuery, skillsById]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.title.trim() || !addForm.employer.trim()) return;
    setSaving(true);
    try {
      await createProfileEntity("experiences", {
        title: addForm.title.trim(),
        employer: addForm.employer.trim(),
        location: addForm.location.trim() || null,
        employmentType: addForm.employmentType.trim() || null,
        startDate: addForm.startDate.trim() || null,
        endDate: addForm.isCurrent ? null : addForm.endDate.trim() || null,
        isCurrent: addForm.isCurrent,
        description: addForm.description.trim() || null,
        skillIds: addForm.skillIds,
        origin: "manual",
        verificationStatus: addForm.verificationStatus,
      });
      setAddForm(EMPTY_EXP_FORM);
      setAdding(false);
      await onRefresh();
      toast({ title: "Work experience added", tone: "accent" });
    } catch (err) {
      toast({
        title: "Failed to add experience",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (exp: ExperienceRecord) => {
    setEditingId(exp.id);
    setEditForm({
      title: exp.title,
      employer: exp.employer,
      location: exp.location ?? "",
      employmentType: exp.employmentType ?? "",
      startDate: exp.startDate ?? "",
      endDate: exp.endDate ?? "",
      isCurrent: exp.isCurrent,
      description: exp.description ?? "",
      skillIds: exp.skillIds,
      verificationStatus: exp.verificationStatus,
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    try {
      await updateProfileEntity("experiences", editingId, {
        title: editForm.title.trim(),
        employer: editForm.employer.trim(),
        location: editForm.location.trim() || null,
        employmentType: editForm.employmentType.trim() || null,
        startDate: editForm.startDate.trim() || null,
        endDate: editForm.isCurrent ? null : editForm.endDate.trim() || null,
        isCurrent: editForm.isCurrent,
        description: editForm.description.trim() || null,
        skillIds: editForm.skillIds,
      });
      setEditingId(null);
      await onRefresh();
      toast({ title: "Work experience updated", tone: "accent" });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, next: VerificationStatus) => {
    setBusyRow({ id, action: next });
    try {
      await setEntityVerification("experiences", id, next);
      await onRefresh();
    } catch (err) {
      toast({
        title: "Status update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyRow(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyRow({ id, action: "delete" });
    try {
      await deleteProfileEntity("experiences", id);
      await onRefresh();
      toast({ title: "Experience deleted", tone: "neutral" });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyRow(null);
    }
  };

  const renderFormFields = (
    formState: ExpFormState,
    setFormState: React.Dispatch<React.SetStateAction<ExpFormState>>,
    includeInitialStatus: boolean
  ) => (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Role / title *
          </label>
          <Input
            required
            value={formState.title}
            onChange={(e) =>
              setFormState((f) => ({ ...f, title: e.target.value }))
            }
            placeholder="Senior Backend Engineer"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Employer *
          </label>
          <Input
            required
            value={formState.employer}
            onChange={(e) =>
              setFormState((f) => ({ ...f, employer: e.target.value }))
            }
            placeholder="Acme Corp"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Location
          </label>
          <Input
            value={formState.location}
            onChange={(e) =>
              setFormState((f) => ({ ...f, location: e.target.value }))
            }
            placeholder="Remote / New York, NY"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Employment type
          </label>
          <Input
            value={formState.employmentType}
            onChange={(e) =>
              setFormState((f) => ({ ...f, employmentType: e.target.value }))
            }
            placeholder="Full-time, Contract"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Start date
          </label>
          <Input
            value={formState.startDate}
            onChange={(e) =>
              setFormState((f) => ({ ...f, startDate: e.target.value }))
            }
            placeholder="2022-04"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            End date
          </label>
          <div className="flex items-center gap-2">
            <Input
              disabled={formState.isCurrent}
              value={formState.isCurrent ? "" : formState.endDate}
              onChange={(e) =>
                setFormState((f) => ({ ...f, endDate: e.target.value }))
              }
              placeholder={formState.isCurrent ? "Present" : "2024-11"}
            />
            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={formState.isCurrent}
                onChange={(e) =>
                  setFormState((f) => ({ ...f, isCurrent: e.target.checked }))
                }
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span>Current</span>
            </label>
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
          Summary &amp; scope
        </label>
        <Textarea
          rows={3}
          value={formState.description}
          onChange={(e) =>
            setFormState((f) => ({ ...f, description: e.target.value }))
          }
          placeholder="Key responsibilities, team scope, and systems owned."
        />
      </div>

      <div>
        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
          Tagged skills
        </label>
        <InlineSkillTagger
          selectedSkillIds={formState.skillIds}
          allSkills={data.skills}
          onChange={(nextIds) =>
            setFormState((f) => ({ ...f, skillIds: nextIds }))
          }
          onSkillCreated={onRefresh}
        />
      </div>

      {includeInitialStatus ? (
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={formState.verificationStatus === "verified"}
            onChange={(e) =>
              setFormState((f) => ({
                ...f,
                verificationStatus: e.target.checked ? "verified" : "needs_review",
              }))
            }
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>Mark immediately as Verified</span>
        </label>
      ) : null}
    </div>
  );

  return (
    <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Briefcase className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Work experience
            </h3>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Roles, employment dates, tagged skills, and source evidence.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={adding ? "secondary" : "primary"}
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Add experience</span>
        </Button>
      </div>

      {adding ? (
        <form onSubmit={handleCreate} className="space-y-4 bg-[var(--surface-raised)] p-5">
          {renderFormFields(addForm, setAddForm, true)}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" loading={saving}>
              Save experience
            </Button>
          </div>
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-[var(--text-secondary)]">
          No work experience entries match the current filter.
        </div>
      ) : (
        filtered.map((exp) => {
          const isEditing = editingId === exp.id;
          const links = evidenceByTarget.get(`experience:${exp.id}`) ?? [];
          const dateRange = formatDateRange(
            exp.startDate,
            exp.endDate,
            exp.isCurrent
          );

          return (
            <div key={exp.id} className="px-5 py-4">
              {isEditing ? (
                <form
                  onSubmit={handleSaveEdit}
                  className="space-y-4 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
                >
                  {renderFormFields(editForm, setEditForm, false)}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" variant="primary" loading={saving}>
                      Save changes
                    </Button>
                  </div>
                </form>
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <h4 className="text-[15px] font-semibold text-[var(--text-primary)]">
                          {exp.title}
                        </h4>
                        <span className="text-[14px] text-[var(--text-secondary)]">
                          at {exp.employer}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-data text-[12px] text-[var(--text-tertiary)]">
                        {dateRange ? <span>{dateRange}</span> : null}
                        {exp.location ? <span>{exp.location}</span> : null}
                        {exp.employmentType ? <span>{exp.employmentType}</span> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <OriginTag origin={exp.origin} />
                      <VerificationBadge status={exp.verificationStatus} />
                    </div>
                  </div>

                  {exp.description ? (
                    <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">
                      {exp.description}
                    </p>
                  ) : null}

                  <LinkedSkillChips skillIds={exp.skillIds} skillsById={skillsById} />

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <VerificationActionBar
                      compact
                      status={exp.verificationStatus}
                      busyStatus={busyRow?.id === exp.id ? busyRow.action : null}
                      onEdit={() => startEdit(exp)}
                      onSetStatus={(next) => void handleStatus(exp.id, next)}
                      onDelete={() => void handleDelete(exp.id)}
                    />
                  </div>

                  <EvidenceAccordion
                    links={links}
                    documentsById={documentsById}
                    onInspectInSource={onInspectInSource}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Projects (Section 6.2 full record)                                      */
/* -------------------------------------------------------------------------- */

interface ProjectFormState {
  name: string;
  experienceId: string;
  description: string;
  problem: string;
  roleContribution: string;
  architecture: string;
  challengesSolved: string;
  outcomes: string;
  metrics: ProjectMetricItem[];
  targetRolesText: string;
  startDate: string;
  endDate: string;
  url: string;
  skillIds: string[];
  verificationStatus: VerificationStatus;
}

const EMPTY_PROJECT_FORM: ProjectFormState = {
  name: "",
  experienceId: "",
  description: "",
  problem: "",
  roleContribution: "",
  architecture: "",
  challengesSolved: "",
  outcomes: "",
  metrics: [],
  targetRolesText: "",
  startDate: "",
  endDate: "",
  url: "",
  skillIds: [],
  verificationStatus: "verified",
};

export function ProjectsSection({
  data,
  filter,
  searchQuery,
  documentsById,
  evidenceByTarget,
  onRefresh,
  onInspectInSource,
}: SharedSectionProps) {
  const { toast } = useToast();
  const [adding, setAdding] = React.useState(false);
  const [addForm, setAddForm] =
    React.useState<ProjectFormState>(EMPTY_PROJECT_FORM);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editForm, setEditForm] =
    React.useState<ProjectFormState>(EMPTY_PROJECT_FORM);
  const [saving, setSaving] = React.useState(false);
  const [busyRow, setBusyRow] = React.useState<{
    id: string;
    action: VerificationStatus | "delete";
  } | null>(null);

  const skillsById = React.useMemo(
    () => new Map(data.skills.map((s) => [s.id, s])),
    [data.skills]
  );
  const expById = React.useMemo(
    () => new Map(data.experiences.map((e) => [e.id, e])),
    [data.experiences]
  );

  const filtered = React.useMemo(
    () =>
      data.projects.filter(
        (proj) =>
          matchesVerificationFilter(proj.verificationStatus, filter) &&
          includesSearch(
            [
              proj.name,
              proj.description,
              proj.problem,
              proj.roleContribution,
              proj.architecture,
              proj.challengesSolved,
              proj.outcomes,
              ...proj.skillIds.map((id) => skillsById.get(id)?.canonicalName),
            ],
            searchQuery
          )
      ),
    [data.projects, filter, searchQuery, skillsById]
  );

  const serializeProjectPayload = (
    formState: ProjectFormState,
    isCreate: boolean
  ) => {
    const cleanMetrics = formState.metrics
      .filter((m) => m.label.trim() || m.value.trim())
      .map((m) => ({
        label: m.label.trim() || "Metric",
        value: m.value.trim(),
        ...(m.unit?.trim() ? { unit: m.unit.trim() } : {}),
        ...(m.context?.trim() ? { context: m.context.trim() } : {}),
      }));
    const targetRoles = formState.targetRolesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      name: formState.name.trim(),
      experienceId: formState.experienceId || null,
      description: formState.description.trim() || null,
      problem: formState.problem.trim() || null,
      roleContribution: formState.roleContribution.trim() || null,
      architecture: formState.architecture.trim() || null,
      challengesSolved: formState.challengesSolved.trim() || null,
      outcomes: formState.outcomes.trim() || null,
      metricsJson: cleanMetrics.length > 0 ? JSON.stringify(cleanMetrics) : null,
      targetRolesJson:
        targetRoles.length > 0 ? JSON.stringify(targetRoles) : null,
      startDate: formState.startDate.trim() || null,
      endDate: formState.endDate.trim() || null,
      url: formState.url.trim() || null,
      skillIds: formState.skillIds,
      ...(isCreate
        ? {
            origin: "manual",
            verificationStatus: formState.verificationStatus,
          }
        : {}),
    };
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) return;
    setSaving(true);
    try {
      await createProfileEntity(
        "projects",
        serializeProjectPayload(addForm, true)
      );
      setAddForm(EMPTY_PROJECT_FORM);
      setAdding(false);
      await onRefresh();
      toast({ title: "Project added", tone: "accent" });
    } catch (err) {
      toast({
        title: "Could not add project",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (proj: ProjectRecord) => {
    setEditingId(proj.id);
    setEditForm({
      name: proj.name,
      experienceId: proj.experienceId ?? "",
      description: proj.description ?? "",
      problem: proj.problem ?? "",
      roleContribution: proj.roleContribution ?? "",
      architecture: proj.architecture ?? "",
      challengesSolved: proj.challengesSolved ?? "",
      outcomes: proj.outcomes ?? "",
      metrics: safeJsonMetrics(proj.metricsJson),
      targetRolesText: safeJsonStringArray(proj.targetRolesJson).join(", "),
      startDate: proj.startDate ?? "",
      endDate: proj.endDate ?? "",
      url: proj.url ?? "",
      skillIds: proj.skillIds,
      verificationStatus: proj.verificationStatus,
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    try {
      await updateProfileEntity(
        "projects",
        editingId,
        serializeProjectPayload(editForm, false)
      );
      setEditingId(null);
      await onRefresh();
      toast({ title: "Project updated", tone: "accent" });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, next: VerificationStatus) => {
    setBusyRow({ id, action: next });
    try {
      await setEntityVerification("projects", id, next);
      await onRefresh();
    } catch (err) {
      toast({
        title: "Status update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyRow(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyRow({ id, action: "delete" });
    try {
      await deleteProfileEntity("projects", id);
      await onRefresh();
      toast({ title: "Project deleted", tone: "neutral" });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyRow(null);
    }
  };

  const renderProjectFields = (
    formState: ProjectFormState,
    setFormState: React.Dispatch<React.SetStateAction<ProjectFormState>>,
    includeInitialStatus: boolean
  ) => (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Project name *
          </label>
          <Input
            required
            value={formState.name}
            onChange={(e) =>
              setFormState((f) => ({ ...f, name: e.target.value }))
            }
            placeholder="Event-Driven Billing Pipeline"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Associated work experience (optional)
          </label>
          <Select
            value={formState.experienceId || "__none__"}
            onValueChange={(val) =>
              setFormState((f) => ({
                ...f,
                experienceId: val === "__none__" ? "" : val,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Standalone / personal project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Standalone / no linked role</SelectItem>
              {data.experiences.map((exp) => (
                <SelectItem key={exp.id} value={exp.id}>
                  {exp.title} — {exp.employer}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Start date
          </label>
          <Input
            value={formState.startDate}
            onChange={(e) =>
              setFormState((f) => ({ ...f, startDate: e.target.value }))
            }
            placeholder="2023-01"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            End date
          </label>
          <Input
            value={formState.endDate}
            onChange={(e) =>
              setFormState((f) => ({ ...f, endDate: e.target.value }))
            }
            placeholder="2023-09 or Ongoing"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Project URL (optional)
          </label>
          <Input
            value={formState.url}
            onChange={(e) =>
              setFormState((f) => ({ ...f, url: e.target.value }))
            }
            placeholder="https://github.com/..."
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Target roles (comma-separated)
          </label>
          <Input
            value={formState.targetRolesText}
            onChange={(e) =>
              setFormState((f) => ({ ...f, targetRolesText: e.target.value }))
            }
            placeholder="Staff Engineer, Distributed Systems"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
          Short description
        </label>
        <Textarea
          rows={2}
          value={formState.description}
          onChange={(e) =>
            setFormState((f) => ({ ...f, description: e.target.value }))
          }
          placeholder="Concise overview of what this project is."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Problem or goal
          </label>
          <Textarea
            rows={2}
            value={formState.problem}
            onChange={(e) =>
              setFormState((f) => ({ ...f, problem: e.target.value }))
            }
            placeholder="What bottleneck or business goal prompted this project?"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Your role &amp; individual contribution
          </label>
          <Textarea
            rows={2}
            value={formState.roleContribution}
            onChange={(e) =>
              setFormState((f) => ({ ...f, roleContribution: e.target.value }))
            }
            placeholder="What you personally designed, built, or led."
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Architecture &amp; technical decisions
          </label>
          <Textarea
            rows={2}
            value={formState.architecture}
            onChange={(e) =>
              setFormState((f) => ({ ...f, architecture: e.target.value }))
            }
            placeholder="Key components, storage/queue choices, and trade-offs."
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Challenges solved
          </label>
          <Textarea
            rows={2}
            value={formState.challengesSolved}
            onChange={(e) =>
              setFormState((f) => ({ ...f, challengesSolved: e.target.value }))
            }
            placeholder="Hard reliability, scale, or correctness obstacles overcome."
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
          Outcomes &amp; business impact
        </label>
        <Textarea
          rows={2}
          value={formState.outcomes}
          onChange={(e) =>
            setFormState((f) => ({ ...f, outcomes: e.target.value }))
          }
          placeholder="Concrete impact on latency, revenue, reliability, or developer velocity."
        />
      </div>

      {/* Metrics builder */}
      <div className="space-y-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            Metrics (value, unit, and measurement context)
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setFormState((f) => ({
                ...f,
                metrics: [
                  ...f.metrics,
                  { label: "", value: "", unit: "", context: "" },
                ],
              }))
            }
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add metric</span>
          </Button>
        </div>

        {formState.metrics.length === 0 ? (
          <p className="text-[12px] text-[var(--text-tertiary)]">
            No metrics added. Record only verified measurements.
          </p>
        ) : (
          <div className="space-y-2">
            {formState.metrics.map((m, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 gap-2 sm:grid-cols-12"
              >
                <Input
                  className="sm:col-span-3"
                  value={m.label}
                  onChange={(e) =>
                    setFormState((f) => ({
                      ...f,
                      metrics: f.metrics.map((row, i) =>
                        i === idx ? { ...row, label: e.target.value } : row
                      ),
                    }))
                  }
                  placeholder="Metric (e.g. Latency)"
                />
                <Input
                  className="sm:col-span-2"
                  value={m.value}
                  onChange={(e) =>
                    setFormState((f) => ({
                      ...f,
                      metrics: f.metrics.map((row, i) =>
                        i === idx ? { ...row, value: e.target.value } : row
                      ),
                    }))
                  }
                  placeholder="Value (-42)"
                />
                <Input
                  className="sm:col-span-2"
                  value={m.unit ?? ""}
                  onChange={(e) =>
                    setFormState((f) => ({
                      ...f,
                      metrics: f.metrics.map((row, i) =>
                        i === idx ? { ...row, unit: e.target.value } : row
                      ),
                    }))
                  }
                  placeholder="Unit (% / ms)"
                />
                <Input
                  className="sm:col-span-4"
                  value={m.context ?? ""}
                  onChange={(e) =>
                    setFormState((f) => ({
                      ...f,
                      metrics: f.metrics.map((row, i) =>
                        i === idx ? { ...row, context: e.target.value } : row
                      ),
                    }))
                  }
                  placeholder="Context (p99 checkout API)"
                />
                <div className="flex justify-end sm:col-span-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove metric"
                    onClick={() =>
                      setFormState((f) => ({
                        ...f,
                        metrics: f.metrics.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
          Technologies &amp; tools (linked skills)
        </label>
        <InlineSkillTagger
          selectedSkillIds={formState.skillIds}
          allSkills={data.skills}
          onChange={(nextIds) =>
            setFormState((f) => ({ ...f, skillIds: nextIds }))
          }
          onSkillCreated={onRefresh}
        />
      </div>

      {includeInitialStatus ? (
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={formState.verificationStatus === "verified"}
            onChange={(e) =>
              setFormState((f) => ({
                ...f,
                verificationStatus: e.target.checked ? "verified" : "needs_review",
              }))
            }
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>Mark immediately as Verified</span>
        </label>
      ) : null}
    </div>
  );

  return (
    <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <FolderGit2
            className="h-4 w-4 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Projects
            </h3>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Structured engineering records: problem, contribution, architecture, challenges, outcomes, and verified metrics.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={adding ? "secondary" : "primary"}
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Add project</span>
        </Button>
      </div>

      {adding ? (
        <form onSubmit={handleCreate} className="space-y-4 bg-[var(--surface-raised)] p-5">
          {renderProjectFields(addForm, setAddForm, true)}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" loading={saving}>
              Save project
            </Button>
          </div>
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-[var(--text-secondary)]">
          No projects match the current filter.
        </div>
      ) : (
        filtered.map((proj) => {
          const isEditing = editingId === proj.id;
          const links = evidenceByTarget.get(`project:${proj.id}`) ?? [];
          const metrics = safeJsonMetrics(proj.metricsJson);
          const targetRoles = safeJsonStringArray(proj.targetRolesJson);
          const linkedExp = proj.experienceId
            ? expById.get(proj.experienceId)
            : undefined;
          const dateRange = formatDateRange(proj.startDate, proj.endDate);

          return (
            <div key={proj.id} className="px-5 py-4">
              {isEditing ? (
                <form
                  onSubmit={handleSaveEdit}
                  className="space-y-4 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
                >
                  {renderProjectFields(editForm, setEditForm, false)}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" variant="primary" loading={saving}>
                      Save changes
                    </Button>
                  </div>
                </form>
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-[15px] font-semibold text-[var(--text-primary)]">
                          {proj.name}
                        </h4>
                        {(() => {
                          const safeProjUrl = toSafeExternalUrl(proj.url);
                          if (!safeProjUrl) return null;
                          return (
                            <a
                              href={safeProjUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[12px] text-[var(--accent)] hover:underline"
                            >
                              <span>Link</span>
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          );
                        })()}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-data text-[12px] text-[var(--text-tertiary)]">
                        {dateRange ? <span>{dateRange}</span> : null}
                        {linkedExp ? (
                          <span>
                            {linkedExp.title} @ {linkedExp.employer}
                          </span>
                        ) : null}
                        {targetRoles.length > 0 ? (
                          <span>Roles: {targetRoles.join(", ")}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <OriginTag origin={proj.origin} />
                      <VerificationBadge status={proj.verificationStatus} />
                    </div>
                  </div>

                  {proj.description ? (
                    <p className="mt-2 text-[14px] leading-relaxed text-[var(--text-primary)]">
                      {proj.description}
                    </p>
                  ) : null}

                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5 text-[13px] md:grid-cols-2">
                    {proj.problem ? (
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          Problem / goal
                        </dt>
                        <dd className="mt-0.5 text-[var(--text-secondary)]">
                          {proj.problem}
                        </dd>
                      </div>
                    ) : null}
                    {proj.roleContribution ? (
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          Role &amp; contribution
                        </dt>
                        <dd className="mt-0.5 text-[var(--text-secondary)]">
                          {proj.roleContribution}
                        </dd>
                      </div>
                    ) : null}
                    {proj.architecture ? (
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          Architecture &amp; decisions
                        </dt>
                        <dd className="mt-0.5 text-[var(--text-secondary)]">
                          {proj.architecture}
                        </dd>
                      </div>
                    ) : null}
                    {proj.challengesSolved ? (
                      <div>
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          Challenges solved
                        </dt>
                        <dd className="mt-0.5 text-[var(--text-secondary)]">
                          {proj.challengesSolved}
                        </dd>
                      </div>
                    ) : null}
                    {proj.outcomes ? (
                      <div className="md:col-span-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                          Outcomes &amp; impact
                        </dt>
                        <dd className="mt-0.5 text-[var(--text-secondary)]">
                          {proj.outcomes}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  {metrics.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {metrics.map((m, idx) => (
                        <div
                          key={idx}
                          className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-[12px]"
                        >
                          <span className="text-[var(--text-tertiary)]">
                            {m.label}:{" "}
                          </span>
                          <span className="font-data font-medium text-[var(--text-primary)]">
                            {m.value}
                            {m.unit ? ` ${m.unit}` : ""}
                          </span>
                          {m.context ? (
                            <span className="text-[var(--text-secondary)]">
                              {" "}
                              ({m.context})
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <LinkedSkillChips skillIds={proj.skillIds} skillsById={skillsById} />

                  <div className="mt-3">
                    <VerificationActionBar
                      compact
                      status={proj.verificationStatus}
                      busyStatus={busyRow?.id === proj.id ? busyRow.action : null}
                      onEdit={() => startEdit(proj)}
                      onSetStatus={(next) => void handleStatus(proj.id, next)}
                      onDelete={() => void handleDelete(proj.id)}
                    />
                  </div>

                  <EvidenceAccordion
                    links={links}
                    documentsById={documentsById}
                    onInspectInSource={onInspectInSource}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Achievements & Measurable Impact                                        */
/* -------------------------------------------------------------------------- */

interface AchievementFormState {
  text: string;
  metricValue: string;
  metricUnit: string;
  metricContext: string;
  experienceId: string;
  projectId: string;
  skillIds: string[];
  verificationStatus: VerificationStatus;
}

const EMPTY_ACHIEVEMENT_FORM: AchievementFormState = {
  text: "",
  metricValue: "",
  metricUnit: "",
  metricContext: "",
  experienceId: "",
  projectId: "",
  skillIds: [],
  verificationStatus: "verified",
};

export function AchievementsSection({
  data,
  filter,
  searchQuery,
  documentsById,
  evidenceByTarget,
  onRefresh,
  onInspectInSource,
}: SharedSectionProps) {
  const { toast } = useToast();
  const [adding, setAdding] = React.useState(false);
  const [addForm, setAddForm] = React.useState<AchievementFormState>(
    EMPTY_ACHIEVEMENT_FORM
  );
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<AchievementFormState>(
    EMPTY_ACHIEVEMENT_FORM
  );
  const [saving, setSaving] = React.useState(false);
  const [busyRow, setBusyRow] = React.useState<{
    id: string;
    action: VerificationStatus | "delete";
  } | null>(null);

  const skillsById = React.useMemo(
    () => new Map(data.skills.map((s) => [s.id, s])),
    [data.skills]
  );
  const expById = React.useMemo(
    () => new Map(data.experiences.map((e) => [e.id, e])),
    [data.experiences]
  );
  const projById = React.useMemo(
    () => new Map(data.projects.map((p) => [p.id, p])),
    [data.projects]
  );

  const filtered = React.useMemo(
    () =>
      data.achievements.filter(
        (ach) =>
          matchesVerificationFilter(ach.verificationStatus, filter) &&
          includesSearch(
            [
              ach.text,
              ach.metricUnit,
              ach.metricContext,
              ach.experienceId ? expById.get(ach.experienceId)?.employer : null,
              ach.projectId ? projById.get(ach.projectId)?.name : null,
            ],
            searchQuery
          )
      ),
    [data.achievements, expById, filter, projById, searchQuery]
  );

  const serializeAchievement = (
    formState: AchievementFormState,
    isCreate: boolean
  ) => {
    const parsedNum = formState.metricValue.trim()
      ? Number(formState.metricValue.trim())
      : null;
    return {
      text: formState.text.trim(),
      metricValue:
        parsedNum !== null && Number.isFinite(parsedNum) ? parsedNum : null,
      metricUnit: formState.metricUnit.trim() || null,
      metricContext: formState.metricContext.trim() || null,
      experienceId: formState.experienceId || null,
      projectId: formState.projectId || null,
      skillIds: formState.skillIds,
      ...(isCreate
        ? {
            origin: "manual",
            verificationStatus: formState.verificationStatus,
          }
        : {}),
    };
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.text.trim()) return;
    setSaving(true);
    try {
      await createProfileEntity(
        "achievements",
        serializeAchievement(addForm, true)
      );
      setAddForm(EMPTY_ACHIEVEMENT_FORM);
      setAdding(false);
      await onRefresh();
      toast({ title: "Achievement added", tone: "accent" });
    } catch (err) {
      toast({
        title: "Failed to add achievement",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (ach: AchievementRecord) => {
    setEditingId(ach.id);
    setEditForm({
      text: ach.text,
      metricValue: ach.metricValue !== null ? String(ach.metricValue) : "",
      metricUnit: ach.metricUnit ?? "",
      metricContext: ach.metricContext ?? "",
      experienceId: ach.experienceId ?? "",
      projectId: ach.projectId ?? "",
      skillIds: ach.skillIds,
      verificationStatus: ach.verificationStatus,
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    try {
      await updateProfileEntity(
        "achievements",
        editingId,
        serializeAchievement(editForm, false)
      );
      setEditingId(null);
      await onRefresh();
      toast({ title: "Achievement updated", tone: "accent" });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, next: VerificationStatus) => {
    setBusyRow({ id, action: next });
    try {
      await setEntityVerification("achievements", id, next);
      await onRefresh();
    } catch (err) {
      toast({
        title: "Status update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyRow(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyRow({ id, action: "delete" });
    try {
      await deleteProfileEntity("achievements", id);
      await onRefresh();
      toast({ title: "Achievement deleted", tone: "neutral" });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyRow(null);
    }
  };

  const renderFields = (
    formState: AchievementFormState,
    setFormState: React.Dispatch<React.SetStateAction<AchievementFormState>>,
    includeInitialStatus: boolean
  ) => (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
          Achievement statement *
        </label>
        <Textarea
          required
          rows={2}
          value={formState.text}
          onChange={(e) => setFormState((f) => ({ ...f, text: e.target.value }))}
          placeholder="Reduced checkout p95 latency from 420ms to 250ms by introducing batched Redis caching."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Metric value
          </label>
          <Input
            type="number"
            step="any"
            value={formState.metricValue}
            onChange={(e) =>
              setFormState((f) => ({ ...f, metricValue: e.target.value }))
            }
            placeholder="40"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Metric unit
          </label>
          <Input
            value={formState.metricUnit}
            onChange={(e) =>
              setFormState((f) => ({ ...f, metricUnit: e.target.value }))
            }
            placeholder="%, ms, USD, req/s"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Measurement context
          </label>
          <Input
            value={formState.metricContext}
            onChange={(e) =>
              setFormState((f) => ({ ...f, metricContext: e.target.value }))
            }
            placeholder="p95 checkout latency"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Linked experience (optional)
          </label>
          <Select
            value={formState.experienceId || "__none__"}
            onValueChange={(val) =>
              setFormState((f) => ({
                ...f,
                experienceId: val === "__none__" ? "" : val,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {data.experiences.map((exp) => (
                <SelectItem key={exp.id} value={exp.id}>
                  {exp.title} — {exp.employer}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Linked project (optional)
          </label>
          <Select
            value={formState.projectId || "__none__"}
            onValueChange={(val) =>
              setFormState((f) => ({
                ...f,
                projectId: val === "__none__" ? "" : val,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {data.projects.map((proj) => (
                <SelectItem key={proj.id} value={proj.id}>
                  {proj.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
          Tagged skills
        </label>
        <InlineSkillTagger
          selectedSkillIds={formState.skillIds}
          allSkills={data.skills}
          onChange={(nextIds) =>
            setFormState((f) => ({ ...f, skillIds: nextIds }))
          }
          onSkillCreated={onRefresh}
        />
      </div>

      {includeInitialStatus ? (
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={formState.verificationStatus === "verified"}
            onChange={(e) =>
              setFormState((f) => ({
                ...f,
                verificationStatus: e.target.checked ? "verified" : "needs_review",
              }))
            }
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>Mark immediately as Verified</span>
        </label>
      ) : null}
    </div>
  );

  return (
    <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Award className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Achievements &amp; measurable impact
            </h3>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Concrete accomplishments with numeric metrics, units, measurement context, and role/project links.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={adding ? "secondary" : "primary"}
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Add achievement</span>
        </Button>
      </div>

      {adding ? (
        <form onSubmit={handleCreate} className="space-y-4 bg-[var(--surface-raised)] p-5">
          {renderFields(addForm, setAddForm, true)}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" loading={saving}>
              Save achievement
            </Button>
          </div>
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-[var(--text-secondary)]">
          No achievements match the current filter.
        </div>
      ) : (
        filtered.map((ach) => {
          const isEditing = editingId === ach.id;
          const links = evidenceByTarget.get(`achievement:${ach.id}`) ?? [];
          const exp = ach.experienceId ? expById.get(ach.experienceId) : undefined;
          const proj = ach.projectId ? projById.get(ach.projectId) : undefined;

          return (
            <div key={ach.id} className="px-5 py-4">
              {isEditing ? (
                <form
                  onSubmit={handleSaveEdit}
                  className="space-y-4 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
                >
                  {renderFields(editForm, setEditForm, false)}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" variant="primary" loading={saving}>
                      Save changes
                    </Button>
                  </div>
                </form>
              ) : (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-[var(--text-primary)]">
                      {ach.text}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      <OriginTag origin={ach.origin} />
                      <VerificationBadge status={ach.verificationStatus} />
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {ach.metricValue !== null ? (
                      <span className="inline-flex items-center rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-0.5 font-data text-[12px] text-[var(--text-primary)]">
                        {ach.metricValue}
                        {ach.metricUnit ? ` ${ach.metricUnit}` : ""}
                        {ach.metricContext ? ` · ${ach.metricContext}` : ""}
                      </span>
                    ) : null}
                    {exp ? (
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        Role: {exp.title} @ {exp.employer}
                      </span>
                    ) : null}
                    {proj ? (
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        Project: {proj.name}
                      </span>
                    ) : null}
                  </div>

                  <LinkedSkillChips skillIds={ach.skillIds} skillsById={skillsById} />

                  <div className="mt-3">
                    <VerificationActionBar
                      compact
                      status={ach.verificationStatus}
                      busyStatus={busyRow?.id === ach.id ? busyRow.action : null}
                      onEdit={() => startEdit(ach)}
                      onSetStatus={(next) => void handleStatus(ach.id, next)}
                      onDelete={() => void handleDelete(ach.id)}
                    />
                  </div>

                  <EvidenceAccordion
                    links={links}
                    documentsById={documentsById}
                    onInspectInSource={onInspectInSource}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Skills & User-Entered Proficiency                                       */
/* -------------------------------------------------------------------------- */

interface SkillFormState {
  canonicalName: string;
  category: string;
  proficiency: string;
  aliasesText: string;
  verificationStatus: VerificationStatus;
}

const EMPTY_SKILL_FORM: SkillFormState = {
  canonicalName: "",
  category: "",
  proficiency: "",
  aliasesText: "",
  verificationStatus: "verified",
};

export function SkillsSection({
  data,
  filter,
  searchQuery,
  documentsById,
  evidenceByTarget,
  onRefresh,
  onInspectInSource,
}: SharedSectionProps) {
  const { toast } = useToast();
  const [adding, setAdding] = React.useState(false);
  const [addForm, setAddForm] = React.useState<SkillFormState>(EMPTY_SKILL_FORM);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editForm, setEditForm] =
    React.useState<SkillFormState>(EMPTY_SKILL_FORM);
  const [saving, setSaving] = React.useState(false);
  const [busyRow, setBusyRow] = React.useState<{
    id: string;
    action: VerificationStatus | "delete";
  } | null>(null);

  const filtered = React.useMemo(
    () =>
      data.skills.filter(
        (skill) =>
          matchesVerificationFilter(skill.verificationStatus, filter) &&
          includesSearch(
            [
              skill.canonicalName,
              skill.category,
              skill.proficiency,
              ...safeJsonStringArray(skill.aliasesJson),
            ],
            searchQuery
          )
      ),
    [data.skills, filter, searchQuery]
  );

  const serializeSkill = (formState: SkillFormState, isCreate: boolean) => {
    const aliases = formState.aliasesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      canonicalName: formState.canonicalName.trim(),
      category: formState.category.trim() || null,
      proficiency: formState.proficiency.trim() || null,
      aliasesJson: JSON.stringify(aliases),
      ...(isCreate
        ? {
            origin: "manual",
            verificationStatus: formState.verificationStatus,
          }
        : {}),
    };
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.canonicalName.trim()) return;
    setSaving(true);
    try {
      await createProfileEntity("skills", serializeSkill(addForm, true));
      setAddForm(EMPTY_SKILL_FORM);
      setAdding(false);
      await onRefresh();
      toast({ title: "Skill added", tone: "accent" });
    } catch (err) {
      toast({
        title: "Failed to add skill",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (skill: SkillRecord) => {
    setEditingId(skill.id);
    setEditForm({
      canonicalName: skill.canonicalName,
      category: skill.category ?? "",
      proficiency: skill.proficiency ?? "",
      aliasesText: safeJsonStringArray(skill.aliasesJson).join(", "),
      verificationStatus: skill.verificationStatus,
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    try {
      await updateProfileEntity(
        "skills",
        editingId,
        serializeSkill(editForm, false)
      );
      setEditingId(null);
      await onRefresh();
      toast({ title: "Skill updated", tone: "accent" });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id: string, next: VerificationStatus) => {
    setBusyRow({ id, action: next });
    try {
      await setEntityVerification("skills", id, next);
      await onRefresh();
    } catch (err) {
      toast({
        title: "Status update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyRow(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyRow({ id, action: "delete" });
    try {
      await deleteProfileEntity("skills", id);
      await onRefresh();
      toast({ title: "Skill deleted", tone: "neutral" });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyRow(null);
    }
  };

  const renderFields = (
    formState: SkillFormState,
    setFormState: React.Dispatch<React.SetStateAction<SkillFormState>>,
    includeInitialStatus: boolean
  ) => (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Canonical skill name *
          </label>
          <Input
            required
            value={formState.canonicalName}
            onChange={(e) =>
              setFormState((f) => ({ ...f, canonicalName: e.target.value }))
            }
            placeholder="TypeScript"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Category (optional)
          </label>
          <Input
            value={formState.category}
            onChange={(e) =>
              setFormState((f) => ({ ...f, category: e.target.value }))
            }
            placeholder="Languages, Databases, Cloud"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Proficiency (optional, user-entered only)
          </label>
          <Input
            value={formState.proficiency}
            onChange={(e) =>
              setFormState((f) => ({ ...f, proficiency: e.target.value }))
            }
            placeholder="Leave blank unless self-assessed"
          />
        </div>
        <div>
          <label className="mb-1 block text-[12px] font-medium text-[var(--text-secondary)]">
            Aliases (comma-separated)
          </label>
          <Input
            value={formState.aliasesText}
            onChange={(e) =>
              setFormState((f) => ({ ...f, aliasesText: e.target.value }))
            }
            placeholder="TS, Node TS"
          />
        </div>
      </div>

      {includeInitialStatus ? (
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={formState.verificationStatus === "verified"}
            onChange={(e) =>
              setFormState((f) => ({
                ...f,
                verificationStatus: e.target.checked ? "verified" : "needs_review",
              }))
            }
            className="h-4 w-4 accent-[var(--accent)]"
          />
          <span>Mark immediately as Verified</span>
        </label>
      ) : null}
    </div>
  );

  return (
    <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Wrench className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Skills &amp; proficiency
            </h3>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Canonical skill list. Proficiency is strictly optional and user-entered—never inferred automatically from resumes.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={adding ? "secondary" : "primary"}
          onClick={() => setAdding((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Add skill</span>
        </Button>
      </div>

      {adding ? (
        <form onSubmit={handleCreate} className="space-y-4 bg-[var(--surface-raised)] p-5">
          {renderFields(addForm, setAddForm, true)}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" loading={saving}>
              Save skill
            </Button>
          </div>
        </form>
      ) : null}

      {filtered.length === 0 ? (
        <div className="px-5 py-8 text-center text-[13px] text-[var(--text-secondary)]">
          No skills match the current filter.
        </div>
      ) : (
        filtered.map((skill) => {
          const isEditing = editingId === skill.id;
          const links = evidenceByTarget.get(`skill:${skill.id}`) ?? [];
          const aliases = safeJsonStringArray(skill.aliasesJson);

          return (
            <div key={skill.id} className="px-5 py-3.5">
              {isEditing ? (
                <form
                  onSubmit={handleSaveEdit}
                  className="space-y-4 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
                >
                  {renderFields(editForm, setEditForm, false)}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" variant="primary" loading={saving}>
                      Save changes
                    </Button>
                  </div>
                </form>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-[var(--text-primary)]">
                          {skill.canonicalName}
                        </span>
                        {skill.category ? (
                          <span className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                            {skill.category}
                          </span>
                        ) : null}
                        {skill.proficiency ? (
                          <span className="font-data text-[12px] text-[var(--accent)]">
                            {skill.proficiency}
                          </span>
                        ) : null}
                        {aliases.length > 0 ? (
                          <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                            Aliases: {aliases.join(", ")}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <OriginTag origin={skill.origin} />
                      <VerificationBadge status={skill.verificationStatus} />
                      <VerificationActionBar
                        compact
                        status={skill.verificationStatus}
                        busyStatus={busyRow?.id === skill.id ? busyRow.action : null}
                        onEdit={() => startEdit(skill)}
                        onSetStatus={(next) => void handleStatus(skill.id, next)}
                        onDelete={() => void handleDelete(skill.id)}
                      />
                    </div>
                  </div>

                  <EvidenceAccordion
                    links={links}
                    documentsById={documentsById}
                    onInspectInSource={onInspectInSource}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Education, Certifications & Languages                                   */
/* -------------------------------------------------------------------------- */

export function CredentialsSection({
  data,
  filter,
  searchQuery,
  documentsById,
  evidenceByTarget,
  onRefresh,
  onInspectInSource,
}: SharedSectionProps) {
  const { toast } = useToast();

  // Education state
  const [addingEdu, setAddingEdu] = React.useState(false);
  const [eduForm, setEduForm] = React.useState({
    institution: "",
    qualification: "",
    fieldOfStudy: "",
    startDate: "",
    endDate: "",
    details: "",
    verified: true,
  });
  const [editingEduId, setEditingEduId] = React.useState<string | null>(null);
  const [editEduForm, setEditEduForm] = React.useState(eduForm);

  // Certifications state
  const [addingCert, setAddingCert] = React.useState(false);
  const [certForm, setCertForm] = React.useState({
    name: "",
    issuer: "",
    issueDate: "",
    expiryDate: "",
    credentialUrl: "",
    verified: true,
  });
  const [editingCertId, setEditingCertId] = React.useState<string | null>(null);
  const [editCertForm, setEditCertForm] = React.useState(certForm);

  // Languages state
  const [addingLang, setAddingLang] = React.useState(false);
  const [langForm, setLangForm] = React.useState({
    language: "",
    proficiency: "",
    verified: true,
  });
  const [editingLangId, setEditingLangId] = React.useState<string | null>(null);
  const [editLangForm, setEditLangForm] = React.useState(langForm);

  const [saving, setSaving] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<{
    key: string;
    action: VerificationStatus | "delete";
  } | null>(null);

  const handleStatus = async (
    entity: "education" | "certifications" | "languages",
    id: string,
    next: VerificationStatus
  ) => {
    const key = `${entity}:${id}`;
    setBusyKey({ key, action: next });
    try {
      await setEntityVerification(entity, id, next);
      await onRefresh();
    } catch (err) {
      toast({
        title: "Status update failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (
    entity: "education" | "certifications" | "languages",
    id: string
  ) => {
    const key = `${entity}:${id}`;
    setBusyKey({ key, action: "delete" });
    try {
      await deleteProfileEntity(entity, id);
      await onRefresh();
      toast({ title: "Entry deleted", tone: "neutral" });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const filteredEdu = data.education.filter(
    (e) =>
      matchesVerificationFilter(e.verificationStatus, filter) &&
      includesSearch(
        [e.institution, e.qualification, e.fieldOfStudy, e.details],
        searchQuery
      )
  );
  const filteredCerts = data.certifications.filter(
    (c) =>
      matchesVerificationFilter(c.verificationStatus, filter) &&
      includesSearch([c.name, c.issuer], searchQuery)
  );
  const filteredLangs = data.languages.filter(
    (l) =>
      matchesVerificationFilter(l.verificationStatus, filter) &&
      includesSearch([l.language, l.proficiency], searchQuery)
  );

  return (
    <div className="space-y-6">
      {/* Education */}
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <GraduationCap
              className="h-4 w-4 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Education
            </h3>
          </div>
          <Button
            size="sm"
            variant={addingEdu ? "secondary" : "primary"}
            onClick={() => setAddingEdu((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add education</span>
          </Button>
        </div>

        {addingEdu ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!eduForm.institution.trim() || !eduForm.qualification.trim())
                return;
              setSaving(true);
              try {
                await createProfileEntity("education", {
                  institution: eduForm.institution.trim(),
                  qualification: eduForm.qualification.trim(),
                  fieldOfStudy: eduForm.fieldOfStudy.trim() || null,
                  startDate: eduForm.startDate.trim() || null,
                  endDate: eduForm.endDate.trim() || null,
                  details: eduForm.details.trim() || null,
                  origin: "manual",
                  verificationStatus: eduForm.verified
                    ? "verified"
                    : "needs_review",
                });
                setEduForm({
                  institution: "",
                  qualification: "",
                  fieldOfStudy: "",
                  startDate: "",
                  endDate: "",
                  details: "",
                  verified: true,
                });
                setAddingEdu(false);
                await onRefresh();
                toast({ title: "Education added", tone: "accent" });
              } catch (err) {
                toast({
                  title: "Failed to add education",
                  description:
                    err instanceof Error ? err.message : "Unknown error.",
                  tone: "danger",
                });
              } finally {
                setSaving(false);
              }
            }}
            className="space-y-3 bg-[var(--surface-raised)] p-5"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                required
                value={eduForm.qualification}
                onChange={(e) =>
                  setEduForm((f) => ({ ...f, qualification: e.target.value }))
                }
                placeholder="Qualification / Degree (e.g. B.S.) *"
              />
              <Input
                required
                value={eduForm.institution}
                onChange={(e) =>
                  setEduForm((f) => ({ ...f, institution: e.target.value }))
                }
                placeholder="Institution *"
              />
              <Input
                value={eduForm.fieldOfStudy}
                onChange={(e) =>
                  setEduForm((f) => ({ ...f, fieldOfStudy: e.target.value }))
                }
                placeholder="Field of study"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={eduForm.startDate}
                  onChange={(e) =>
                    setEduForm((f) => ({ ...f, startDate: e.target.value }))
                  }
                  placeholder="Start (2016)"
                />
                <Input
                  value={eduForm.endDate}
                  onChange={(e) =>
                    setEduForm((f) => ({ ...f, endDate: e.target.value }))
                  }
                  placeholder="End (2020)"
                />
              </div>
            </div>
            <Textarea
              rows={2}
              value={eduForm.details}
              onChange={(e) =>
                setEduForm((f) => ({ ...f, details: e.target.value }))
              }
              placeholder="Honors, thesis, or relevant coursework (optional)"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={eduForm.verified}
                  onChange={(e) =>
                    setEduForm((f) => ({ ...f, verified: e.target.checked }))
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span>Mark immediately as Verified</span>
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAddingEdu(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" variant="primary" loading={saving}>
                  Save education
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {filteredEdu.length === 0 ? (
          <div className="px-5 py-6 text-center text-[13px] text-[var(--text-secondary)]">
            No education entries match the current filter.
          </div>
        ) : (
          filteredEdu.map((edu) => {
            const isEditing = editingEduId === edu.id;
            const links = evidenceByTarget.get(`education:${edu.id}`) ?? [];
            const key = `education:${edu.id}`;

            return (
              <div key={edu.id} className="px-5 py-4">
                {isEditing ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSaving(true);
                      try {
                        await updateProfileEntity("education", edu.id, {
                          institution: editEduForm.institution.trim(),
                          qualification: editEduForm.qualification.trim(),
                          fieldOfStudy: editEduForm.fieldOfStudy.trim() || null,
                          startDate: editEduForm.startDate.trim() || null,
                          endDate: editEduForm.endDate.trim() || null,
                          details: editEduForm.details.trim() || null,
                        });
                        setEditingEduId(null);
                        await onRefresh();
                        toast({ title: "Education updated", tone: "accent" });
                      } catch (err) {
                        toast({
                          title: "Update failed",
                          description:
                            err instanceof Error ? err.message : "Unknown error.",
                          tone: "danger",
                        });
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="space-y-3 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input
                        required
                        value={editEduForm.qualification}
                        onChange={(e) =>
                          setEditEduForm((f) => ({
                            ...f,
                            qualification: e.target.value,
                          }))
                        }
                        placeholder="Qualification"
                      />
                      <Input
                        required
                        value={editEduForm.institution}
                        onChange={(e) =>
                          setEditEduForm((f) => ({
                            ...f,
                            institution: e.target.value,
                          }))
                        }
                        placeholder="Institution"
                      />
                      <Input
                        value={editEduForm.fieldOfStudy}
                        onChange={(e) =>
                          setEditEduForm((f) => ({
                            ...f,
                            fieldOfStudy: e.target.value,
                          }))
                        }
                        placeholder="Field of study"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={editEduForm.startDate}
                          onChange={(e) =>
                            setEditEduForm((f) => ({
                              ...f,
                              startDate: e.target.value,
                            }))
                          }
                          placeholder="Start"
                        />
                        <Input
                          value={editEduForm.endDate}
                          onChange={(e) =>
                            setEditEduForm((f) => ({
                              ...f,
                              endDate: e.target.value,
                            }))
                          }
                          placeholder="End"
                        />
                      </div>
                    </div>
                    <Textarea
                      rows={2}
                      value={editEduForm.details}
                      onChange={(e) =>
                        setEditEduForm((f) => ({ ...f, details: e.target.value }))
                      }
                      placeholder="Details"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingEduId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        loading={saving}
                      >
                        Save changes
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                          {edu.qualification}
                          {edu.fieldOfStudy ? `, ${edu.fieldOfStudy}` : ""}
                        </h4>
                        <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                          {edu.institution}
                          {formatDateRange(edu.startDate, edu.endDate)
                            ? ` · ${formatDateRange(edu.startDate, edu.endDate)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <OriginTag origin={edu.origin} />
                        <VerificationBadge status={edu.verificationStatus} />
                      </div>
                    </div>
                    {edu.details ? (
                      <p className="mt-2 text-[13px] text-[var(--text-secondary)]">
                        {edu.details}
                      </p>
                    ) : null}
                    <div className="mt-3">
                      <VerificationActionBar
                        compact
                        status={edu.verificationStatus}
                        busyStatus={busyKey?.key === key ? busyKey.action : null}
                        onEdit={() => {
                          setEditingEduId(edu.id);
                          setEditEduForm({
                            institution: edu.institution,
                            qualification: edu.qualification,
                            fieldOfStudy: edu.fieldOfStudy ?? "",
                            startDate: edu.startDate ?? "",
                            endDate: edu.endDate ?? "",
                            details: edu.details ?? "",
                            verified: edu.verificationStatus === "verified",
                          });
                        }}
                        onSetStatus={(next) =>
                          void handleStatus("education", edu.id, next)
                        }
                        onDelete={() => void handleDelete("education", edu.id)}
                      />
                    </div>
                    <EvidenceAccordion
                      links={links}
                      documentsById={documentsById}
                      onInspectInSource={onInspectInSource}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Certifications */}
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Award className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Certifications
            </h3>
          </div>
          <Button
            size="sm"
            variant={addingCert ? "secondary" : "primary"}
            onClick={() => setAddingCert((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add certification</span>
          </Button>
        </div>

        {addingCert ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!certForm.name.trim()) return;
              setSaving(true);
              try {
                await createProfileEntity("certifications", {
                  name: certForm.name.trim(),
                  issuer: certForm.issuer.trim() || null,
                  issueDate: certForm.issueDate.trim() || null,
                  expiryDate: certForm.expiryDate.trim() || null,
                  credentialUrl: certForm.credentialUrl.trim() || null,
                  origin: "manual",
                  verificationStatus: certForm.verified
                    ? "verified"
                    : "needs_review",
                });
                setCertForm({
                  name: "",
                  issuer: "",
                  issueDate: "",
                  expiryDate: "",
                  credentialUrl: "",
                  verified: true,
                });
                setAddingCert(false);
                await onRefresh();
                toast({ title: "Certification added", tone: "accent" });
              } catch (err) {
                toast({
                  title: "Failed to add certification",
                  description:
                    err instanceof Error ? err.message : "Unknown error.",
                  tone: "danger",
                });
              } finally {
                setSaving(false);
              }
            }}
            className="space-y-3 bg-[var(--surface-raised)] p-5"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                required
                value={certForm.name}
                onChange={(e) =>
                  setCertForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Certification name *"
              />
              <Input
                value={certForm.issuer}
                onChange={(e) =>
                  setCertForm((f) => ({ ...f, issuer: e.target.value }))
                }
                placeholder="Issuing organization"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={certForm.issueDate}
                  onChange={(e) =>
                    setCertForm((f) => ({ ...f, issueDate: e.target.value }))
                  }
                  placeholder="Issued (2024-02)"
                />
                <Input
                  value={certForm.expiryDate}
                  onChange={(e) =>
                    setCertForm((f) => ({ ...f, expiryDate: e.target.value }))
                  }
                  placeholder="Expiry (optional)"
                />
              </div>
              <Input
                value={certForm.credentialUrl}
                onChange={(e) =>
                  setCertForm((f) => ({ ...f, credentialUrl: e.target.value }))
                }
                placeholder="Credential URL (optional)"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={certForm.verified}
                  onChange={(e) =>
                    setCertForm((f) => ({ ...f, verified: e.target.checked }))
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span>Mark immediately as Verified</span>
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAddingCert(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" variant="primary" loading={saving}>
                  Save certification
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {filteredCerts.length === 0 ? (
          <div className="px-5 py-6 text-center text-[13px] text-[var(--text-secondary)]">
            No certifications match the current filter.
          </div>
        ) : (
          filteredCerts.map((cert) => {
            const isEditing = editingCertId === cert.id;
            const links =
              evidenceByTarget.get(`certification:${cert.id}`) ?? [];
            const key = `certifications:${cert.id}`;

            return (
              <div key={cert.id} className="px-5 py-4">
                {isEditing ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSaving(true);
                      try {
                        await updateProfileEntity("certifications", cert.id, {
                          name: editCertForm.name.trim(),
                          issuer: editCertForm.issuer.trim() || null,
                          issueDate: editCertForm.issueDate.trim() || null,
                          expiryDate: editCertForm.expiryDate.trim() || null,
                          credentialUrl:
                            editCertForm.credentialUrl.trim() || null,
                        });
                        setEditingCertId(null);
                        await onRefresh();
                        toast({ title: "Certification updated", tone: "accent" });
                      } catch (err) {
                        toast({
                          title: "Update failed",
                          description:
                            err instanceof Error ? err.message : "Unknown error.",
                          tone: "danger",
                        });
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="space-y-3 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input
                        required
                        value={editCertForm.name}
                        onChange={(e) =>
                          setEditCertForm((f) => ({ ...f, name: e.target.value }))
                        }
                        placeholder="Certification name"
                      />
                      <Input
                        value={editCertForm.issuer}
                        onChange={(e) =>
                          setEditCertForm((f) => ({
                            ...f,
                            issuer: e.target.value,
                          }))
                        }
                        placeholder="Issuer"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={editCertForm.issueDate}
                          onChange={(e) =>
                            setEditCertForm((f) => ({
                              ...f,
                              issueDate: e.target.value,
                            }))
                          }
                          placeholder="Issue date"
                        />
                        <Input
                          value={editCertForm.expiryDate}
                          onChange={(e) =>
                            setEditCertForm((f) => ({
                              ...f,
                              expiryDate: e.target.value,
                            }))
                          }
                          placeholder="Expiry date"
                        />
                      </div>
                      <Input
                        value={editCertForm.credentialUrl}
                        onChange={(e) =>
                          setEditCertForm((f) => ({
                            ...f,
                            credentialUrl: e.target.value,
                          }))
                        }
                        placeholder="Credential URL"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingCertId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        loading={saving}
                      >
                        Save changes
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                            {cert.name}
                          </h4>
                          {(() => {
                            const safeCertUrl = toSafeExternalUrl(cert.credentialUrl);
                            if (!safeCertUrl) return null;
                            return (
                              <a
                                href={safeCertUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[12px] text-[var(--accent)] hover:underline"
                              >
                                <span>Verify link</span>
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            );
                          })()}
                        </div>
                        <p className="mt-0.5 font-data text-[12px] text-[var(--text-secondary)]">
                          {[
                            cert.issuer,
                            cert.issueDate ? `Issued ${cert.issueDate}` : null,
                            cert.expiryDate ? `Expires ${cert.expiryDate}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <OriginTag origin={cert.origin} />
                        <VerificationBadge status={cert.verificationStatus} />
                      </div>
                    </div>
                    <div className="mt-3">
                      <VerificationActionBar
                        compact
                        status={cert.verificationStatus}
                        busyStatus={busyKey?.key === key ? busyKey.action : null}
                        onEdit={() => {
                          setEditingCertId(cert.id);
                          setEditCertForm({
                            name: cert.name,
                            issuer: cert.issuer ?? "",
                            issueDate: cert.issueDate ?? "",
                            expiryDate: cert.expiryDate ?? "",
                            credentialUrl: cert.credentialUrl ?? "",
                            verified: cert.verificationStatus === "verified",
                          });
                        }}
                        onSetStatus={(next) =>
                          void handleStatus("certifications", cert.id, next)
                        }
                        onDelete={() =>
                          void handleDelete("certifications", cert.id)
                        }
                      />
                    </div>
                    <EvidenceAccordion
                      links={links}
                      documentsById={documentsById}
                      onInspectInSource={onInspectInSource}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Languages */}
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <LanguagesIcon
              className="h-4 w-4 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Languages <span className="font-normal text-[var(--text-tertiary)]">(optional)</span>
            </h3>
          </div>
          <Button
            size="sm"
            variant={addingLang ? "secondary" : "primary"}
            onClick={() => setAddingLang((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add language</span>
          </Button>
        </div>

        {addingLang ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!langForm.language.trim()) return;
              setSaving(true);
              try {
                await createProfileEntity("languages", {
                  language: langForm.language.trim(),
                  proficiency: langForm.proficiency.trim() || null,
                  origin: "manual",
                  verificationStatus: langForm.verified
                    ? "verified"
                    : "needs_review",
                });
                setLangForm({ language: "", proficiency: "", verified: true });
                setAddingLang(false);
                await onRefresh();
                toast({ title: "Language added", tone: "accent" });
              } catch (err) {
                toast({
                  title: "Failed to add language",
                  description:
                    err instanceof Error ? err.message : "Unknown error.",
                  tone: "danger",
                });
              } finally {
                setSaving(false);
              }
            }}
            className="space-y-3 bg-[var(--surface-raised)] p-5"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                required
                value={langForm.language}
                onChange={(e) =>
                  setLangForm((f) => ({ ...f, language: e.target.value }))
                }
                placeholder="Language (e.g. English, Spanish) *"
              />
              <Input
                value={langForm.proficiency}
                onChange={(e) =>
                  setLangForm((f) => ({ ...f, proficiency: e.target.value }))
                }
                placeholder="Proficiency (e.g. Native, C1, Conversational)"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={langForm.verified}
                  onChange={(e) =>
                    setLangForm((f) => ({ ...f, verified: e.target.checked }))
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span>Mark immediately as Verified</span>
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAddingLang(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" variant="primary" loading={saving}>
                  Save language
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {filteredLangs.length === 0 ? (
          <div className="px-5 py-6 text-center text-[13px] text-[var(--text-secondary)]">
            No languages match the current filter.
          </div>
        ) : (
          filteredLangs.map((lang) => {
            const isEditing = editingLangId === lang.id;
            const links = evidenceByTarget.get(`language:${lang.id}`) ?? [];
            const key = `languages:${lang.id}`;

            return (
              <div key={lang.id} className="px-5 py-3.5">
                {isEditing ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSaving(true);
                      try {
                        await updateProfileEntity("languages", lang.id, {
                          language: editLangForm.language.trim(),
                          proficiency: editLangForm.proficiency.trim() || null,
                        });
                        setEditingLangId(null);
                        await onRefresh();
                        toast({ title: "Language updated", tone: "accent" });
                      } catch (err) {
                        toast({
                          title: "Update failed",
                          description:
                            err instanceof Error ? err.message : "Unknown error.",
                          tone: "danger",
                        });
                      } finally {
                        setSaving(false);
                      }
                    }}
                    className="space-y-3 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-4"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Input
                        required
                        value={editLangForm.language}
                        onChange={(e) =>
                          setEditLangForm((f) => ({
                            ...f,
                            language: e.target.value,
                          }))
                        }
                        placeholder="Language"
                      />
                      <Input
                        value={editLangForm.proficiency}
                        onChange={(e) =>
                          setEditLangForm((f) => ({
                            ...f,
                            proficiency: e.target.value,
                          }))
                        }
                        placeholder="Proficiency"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingLangId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        loading={saving}
                      >
                        Save changes
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[14px] font-medium text-[var(--text-primary)]">
                          {lang.language}
                        </span>
                        {lang.proficiency ? (
                          <span className="text-[13px] text-[var(--text-secondary)]">
                            · {lang.proficiency}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <OriginTag origin={lang.origin} />
                        <VerificationBadge status={lang.verificationStatus} />
                        <VerificationActionBar
                          compact
                          status={lang.verificationStatus}
                          busyStatus={busyKey?.key === key ? busyKey.action : null}
                          onEdit={() => {
                            setEditingLangId(lang.id);
                            setEditLangForm({
                              language: lang.language,
                              proficiency: lang.proficiency ?? "",
                              verified: lang.verificationStatus === "verified",
                            });
                          }}
                          onSetStatus={(next) =>
                            void handleStatus("languages", lang.id, next)
                          }
                          onDelete={() =>
                            void handleDelete("languages", lang.id)
                          }
                        />
                      </div>
                    </div>
                    <EvidenceAccordion
                      links={links}
                      documentsById={documentsById}
                      onInspectInSource={onInspectInSource}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 7. Source Documents & Evidence Library                                     */
/* -------------------------------------------------------------------------- */

export function DocumentsSection({
  data,
  documentsById,
  onRefresh,
  onInspectInSource,
  onOpenImport,
}: Omit<SharedSectionProps, "filter" | "searchQuery" | "evidenceByTarget"> & {
  onOpenImport: () => void;
}) {
  const { toast } = useToast();
  const [deletingDocId, setDeletingDocId] = React.useState<string | null>(null);
  const [deletingEvidenceId, setDeletingEvidenceId] = React.useState<
    string | null
  >(null);

  const evidenceCountByDoc = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of data.evidenceLinks) {
      if (link.sourceDocumentId) {
        counts.set(
          link.sourceDocumentId,
          (counts.get(link.sourceDocumentId) ?? 0) + 1
        );
      }
    }
    return counts;
  }, [data.evidenceLinks]);

  const handleDeleteDoc = async (doc: SourceDocumentRecord) => {
    setDeletingDocId(doc.id);
    try {
      await deleteSourceDocument(doc.id);
      await onRefresh();
      toast({
        title: "Document deleted",
        description: doc.displayFilename,
        tone: "neutral",
      });
    } catch (err) {
      toast({
        title: "Could not delete document",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleDeleteEvidence = async (id: string) => {
    setDeletingEvidenceId(id);
    try {
      await deleteProfileEntity("evidence-links", id);
      await onRefresh();
      toast({ title: "Evidence link removed", tone: "neutral" });
    } catch (err) {
      toast({
        title: "Failed to remove evidence link",
        description: err instanceof Error ? err.message : "Unknown error.",
        tone: "danger",
      });
    } finally {
      setDeletingEvidenceId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <FileText
              className="h-4 w-4 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <div>
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Source documents
              </h3>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Uploaded resumes and supporting documents stored locally for provenance.
              </p>
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={onOpenImport}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Import document</span>
          </Button>
        </div>

        {data.sourceDocuments.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-[var(--text-secondary)]">
            No source documents imported yet. Use &ldquo;Import resume&rdquo; to upload a PDF, DOCX, TXT, or Markdown file.
          </div>
        ) : (
          data.sourceDocuments.map((doc) => {
            const linkedCount = evidenceCountByDoc.get(doc.id) ?? 0;
            return (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-[var(--text-primary)]">
                      {doc.displayFilename}
                    </span>
                    <Badge
                      tone={
                        doc.extractionStatus === "extracted"
                          ? "accent"
                          : doc.extractionStatus === "scanned_pdf"
                            ? "warning"
                            : doc.extractionStatus === "failed"
                              ? "danger"
                              : "neutral"
                      }
                    >
                      {doc.extractionStatus === "scanned_pdf"
                        ? "Scanned PDF"
                        : doc.extractionStatus}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 font-data text-[12px] text-[var(--text-tertiary)]">
                    <span>{formatBytes(doc.fileSizeBytes)}</span>
                    <span>Imported {formatShortDate(doc.importedAt)}</span>
                    <span>
                      {linkedCount} evidence link{linkedCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  {doc.extractionStatus === "scanned_pdf" ? (
                    <p className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--warning)]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Provide a text-based PDF or DOCX to extract text.</span>
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onInspectInSource(doc.id, null)}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Open viewer</span>
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    loading={deletingDocId === doc.id}
                    onClick={() => void handleDeleteDoc(doc)}
                    aria-label={`Delete ${doc.displayFilename}`}
                    className="text-[var(--text-tertiary)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Evidence links table */}
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Evidence library
            </h3>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Verbatim source excerpts linking profile facts back to imported documents.
            </p>
          </div>
          <span className="font-data text-[12px] text-[var(--text-tertiary)]">
            {data.evidenceLinks.length} links
          </span>
        </div>

        {data.evidenceLinks.length === 0 ? (
          <div className="px-5 py-8 text-center text-[13px] text-[var(--text-secondary)]">
            No evidence links recorded yet.
          </div>
        ) : (
          data.evidenceLinks.map((link) => {
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
              <div key={link.id} className="space-y-2 px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-data text-[11px] uppercase text-[var(--text-secondary)]">
                      {link.targetType}
                    </span>
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">
                      {doc ? doc.displayFilename : "Manual excerpt"}
                    </span>
                    <OriginTag origin={link.origin} />
                    {confidencePct !== null ? (
                      <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                        Parser confidence {confidencePct}%
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {doc ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onInspectInSource(doc.id, link.excerpt)}
                        className="h-7 px-2 text-[12px] text-[var(--accent)]"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Inspect</span>
                      </Button>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      loading={deletingEvidenceId === link.id}
                      onClick={() => void handleDeleteEvidence(link.id)}
                      aria-label="Remove evidence link"
                      className="h-7 w-7 text-[var(--text-tertiary)] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                {link.excerpt ? (
                  <blockquote className="border-l-2 border-[var(--border-strong)] pl-3 font-data text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">
                    {link.excerpt}
                  </blockquote>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
