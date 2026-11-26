"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Info,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useWorkspace } from "@/components/shell/workspace-context";
import { listSources } from "@/features/job-sources/api";
import type { JobSourceItem } from "@/features/job-sources/types";
import {
  addSearchProfileSkill,
  createSearchProfile,
  deleteSearchProfile,
  deleteSearchProfileSkill,
  getSearchProfile,
  listSearchProfiles,
  listSearchProfileSkills,
  updateSearchProfile,
  updateSearchProfileSkill,
} from "./api";
import {
  createEmptyProfileFormInput,
  DEFAULT_RANKING_WEIGHTS,
  DEFAULT_SECTION_ORDER,
  PROFILE_WORKPLACE_TYPES,
  SKILL_FILTER_MODES,
  SKILL_PREFERENCES,
  sumRankingWeights,
  type ProfileWorkplaceType,
  type SalaryPeriodOption,
  type SearchProfileFormInput,
  type SearchProfileRankingWeights,
  type SearchProfileRecord,
  type SearchProfileSkill,
  type SearchProfileSkillInput,
  type SkillFilterMode,
  type SkillPreference,
} from "./types";

const SENIORITY_PRESETS = [
  "Intern",
  "Junior",
  "Mid-level",
  "Senior",
  "Staff",
  "Principal",
  "Lead",
  "Manager",
] as const;

const EMPLOYMENT_TYPE_PRESETS = [
  "Full-time",
  "Part-time",
  "Contract",
  "Internship",
] as const;

const RANKING_FACTOR_META: Array<{
  key: keyof SearchProfileRankingWeights;
  label: string;
  description: string;
}> = [
  {
    key: "documentedFit",
    label: "Candidate documented role/experience fit",
    description:
      "Verified Career Profile support for extracted job requirements.",
  },
  {
    key: "searchSkillAlignment",
    label: "Search-profile skill alignment",
    description:
      "Whether the job posting matches the target or excluded skills below.",
  },
  {
    key: "freshness",
    label: "Freshness",
    description:
      "Employer-posted recency when known (omitted when posted date is unknown).",
  },
  {
    key: "locationWorkMode",
    label: "Location / work-mode preference",
    description: "Match against preferred locations and remote/hybrid/onsite.",
  },
  {
    key: "compensation",
    label: "Compensation fit",
    description:
      "Comparison against disclosed or user-supplied salary bounds in matching currency/period.",
  },
  {
    key: "companyIndustry",
    label: "Company / industry preference",
    description: "Preferred or dispreferred company and industry tags.",
  },
];

function profileToFormInput(profile: SearchProfileRecord): SearchProfileFormInput {
  return {
    name: profile.name,
    enabled: profile.enabled,
    targetTitles: [...profile.targetTitles],
    titleAliases: [...profile.titleAliases],
    targetSeniority: [...profile.targetSeniority],
    minYearsExperience: profile.minYearsExperience,
    maxYearsExperience: profile.maxYearsExperience,
    locations: [...profile.locations],
    excludedLocations: [...profile.excludedLocations],
    remoteEligibleCountries: [...profile.remoteEligibleCountries],
    workplaceTypes: [...profile.workplaceTypes],
    employmentTypes: [...profile.employmentTypes],
    relocationAllowed: profile.relocationAllowed,
    maxJobAgeDays: profile.maxJobAgeDays,
    preferredRecencyDays: profile.preferredRecencyDays,
    minCompensation: profile.minCompensation,
    targetCompensation: profile.targetCompensation,
    compensationCurrency: profile.compensationCurrency,
    compensationPeriod: profile.compensationPeriod,
    preferredCompanies: [...profile.preferredCompanies],
    excludedCompanies: [...profile.excludedCompanies],
    preferredIndustries: [...profile.preferredIndustries],
    excludedIndustries: [...profile.excludedIndustries],
    includedSources: [...profile.includedSources],
    excludedSources: [...profile.excludedSources],
    failClosedOnUnknown: profile.failClosedOnUnknown,
    hardFilters: { ...profile.hardFilters },
    rankingWeights: { ...profile.rankingWeights },
    resumePreferences: {
      ...profile.resumePreferences,
      sectionOrder:
        profile.resumePreferences.sectionOrder.length > 0
          ? [...profile.resumePreferences.sectionOrder]
          : [...DEFAULT_SECTION_ORDER],
    },
  };
}

function parseNullableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function skillPreferenceLabel(pref: SkillPreference): string {
  switch (pref) {
    case "must_have":
      return "Must have";
    case "preferred":
      return "Preferred";
    case "excluded":
      return "Excluded";
  }
}

function skillPreferenceTone(pref: SkillPreference): BadgeTone {
  switch (pref) {
    case "must_have":
      return "accent";
    case "preferred":
      return "neutral";
    case "excluded":
      return "danger";
  }
}

interface TagListInputProps {
  id: string;
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  hint?: string;
}

function TagListInput({
  id,
  label,
  values,
  onChange,
  placeholder,
  hint,
}: TagListInputProps) {
  const [draft, setDraft] = React.useState("");

  const addItems = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const existingLower = new Set(values.map((v) => v.toLowerCase()));
    const additions: string[] = [];
    for (const part of parts) {
      if (!existingLower.has(part.toLowerCase())) {
        existingLower.add(part.toLowerCase());
        additions.push(part);
      }
    }
    if (additions.length > 0) {
      onChange([...values, ...additions]);
    }
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-[var(--text-primary)]"
      >
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addItems(draft);
            }
          }}
          placeholder={placeholder}
        />
        <Button
          variant="secondary"
          size="md"
          onClick={() => addItems(draft)}
          disabled={!draft.trim()}
        >
          Add
        </Button>
      </div>
      {hint ? (
        <p className="text-[12px] text-[var(--text-tertiary)]">{hint}</p>
      ) : null}
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {values.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[12px] text-[var(--text-primary)]"
            >
              <span>{item}</span>
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() =>
                  onChange(values.filter((existing) => existing !== item))
                }
                className="inline-flex h-4 w-4 items-center justify-center rounded-[2px] text-[var(--text-tertiary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface HardModeToggleProps {
  label: string;
  isHard: boolean;
  onChange: (isHard: boolean) => void;
}

function HardModeToggle({ label, isHard, onChange }: HardModeToggleProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] p-0.5">
      <span className="px-2 text-[11px] font-medium text-[var(--text-tertiary)]">
        {label}:
      </span>
      <button
        type="button"
        aria-pressed={!isHard}
        onClick={() => onChange(false)}
        className={cn(
          "rounded-[4px] px-2 py-1 text-[12px] font-medium transition-colors",
          !isHard
            ? "bg-[var(--surface-raised)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(34,35,31,0.06)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        )}
      >
        Soft / weighted
      </button>
      <button
        type="button"
        aria-pressed={isHard}
        onClick={() => onChange(true)}
        className={cn(
          "rounded-[4px] px-2 py-1 text-[12px] font-medium transition-colors",
          isHard
            ? "border border-[#DFC99B] bg-[#F5EFE2] text-[var(--warning)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        )}
      >
        Hard filter
      </button>
    </div>
  );
}

interface StagedSkillItem extends SearchProfileSkillInput {
  tempId: string;
}

/**
 * Search Profiles Workbench: defines independent job-search strategies, job-centric
 * skills (`must_have`/`preferred`/`excluded` + `weighted`/`hard`), hard vs soft
 * filters, and 6 ranking weights validating to 100%.
 */
export function SearchProfilesWorkbench() {
  const { toast } = useToast();
  const {
    activeProfileId,
    setActiveProfileId,
    refreshSearchProfiles,
  } = useWorkspace();

  const [profiles, setProfiles] = React.useState<SearchProfileRecord[]>([]);
  const [sources, setSources] = React.useState<JobSourceItem[]>([]);
  const [loadingList, setLoadingList] = React.useState(true);
  const [listError, setListError] = React.useState<string | null>(null);

  const [selectedId, setSelectedId] = React.useState<string | "new" | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [form, setForm] = React.useState<SearchProfileFormInput>(() =>
    createEmptyProfileFormInput()
  );
  const [skills, setSkills] = React.useState<SearchProfileSkill[]>([]);
  const [stagedSkills, setStagedSkills] = React.useState<StagedSkillItem[]>([]);
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deletingProfile, setDeletingProfile] = React.useState(false);

  // Add skill inline state
  const [newSkillLabel, setNewSkillLabel] = React.useState("");
  const [newSkillAliases, setNewSkillAliases] = React.useState("");
  const [newSkillPref, setNewSkillPref] =
    React.useState<SkillPreference>("must_have");
  const [newSkillMode, setNewSkillMode] =
    React.useState<SkillFilterMode>("weighted");
  const [newSkillWeight, setNewSkillWeight] = React.useState("");
  const [addingSkill, setAddingSkill] = React.useState(false);
  const [busySkillIds, setBusySkillIds] = React.useState<Record<string, boolean>>(
    {}
  );

  const loadSelectedProfile = React.useCallback(
    async (profileId: string) => {
      setLoadingDetail(true);
      try {
        const detail = await getSearchProfile(profileId);
        let resolvedSkills = detail.skills;
        if (resolvedSkills.length === 0) {
          try {
            resolvedSkills = await listSearchProfileSkills(profileId);
          } catch {
            // Non-fatal if GET /:id already includes skills
          }
        }
        setForm(profileToFormInput(detail));
        setSkills(resolvedSkills);
        setStagedSkills([]);
      } catch (err) {
        toast({
          title: "Could not load search profile",
          description: err instanceof Error ? err.message : "Request failed.",
          tone: "danger",
        });
      } finally {
        setLoadingDetail(false);
      }
    },
    [toast]
  );

  const loadAll = React.useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const [loadedProfiles, loadedSources] = await Promise.all([
        listSearchProfiles(),
        listSources().catch(() => [] as JobSourceItem[]),
      ]);
      setProfiles(loadedProfiles);
      setSources(loadedSources);

      if (loadedProfiles.length === 0) {
        setSelectedId("new");
        setForm(createEmptyProfileFormInput("Primary Search"));
        setSkills([]);
        setStagedSkills([]);
      } else {
        const preferred =
          (activeProfileId &&
            loadedProfiles.find((p) => p.id === activeProfileId)) ||
          loadedProfiles[0];
        if (preferred) {
          setSelectedId(preferred.id);
          await loadSelectedProfile(preferred.id);
        }
      }
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Could not load search profiles."
      );
    } finally {
      setLoadingList(false);
    }
  }, [activeProfileId, loadSelectedProfile]);

  React.useEffect(() => {
    let active = true;
    Promise.all([
      listSearchProfiles(),
      listSources().catch(() => [] as JobSourceItem[]),
    ])
      .then(async ([loadedProfiles, loadedSources]) => {
        if (!active) return;
        setProfiles(loadedProfiles);
        setSources(loadedSources);
        setListError(null);

        if (loadedProfiles.length === 0) {
          setSelectedId("new");
          setForm(createEmptyProfileFormInput("Primary Search"));
          setSkills([]);
          setStagedSkills([]);
          return;
        }

        const preferred =
          (activeProfileId &&
            loadedProfiles.find((p) => p.id === activeProfileId)) ||
          loadedProfiles[0];
        if (preferred) {
          setSelectedId(preferred.id);
          const detail = await getSearchProfile(preferred.id);
          if (!active) return;
          setForm(profileToFormInput(detail));
          setSkills(detail.skills);
          setStagedSkills([]);
        }
      })
      .catch((err) => {
        if (!active) return;
        setListError(
          err instanceof Error ? err.message : "Could not load search profiles."
        );
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });

    return () => {
      active = false;
    };
    // Initial hydration only; subsequent profile selections are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectProfile = (id: string) => {
    setSelectedId(id);
    void loadSelectedProfile(id);
  };

  const handleStartNewProfile = () => {
    setSelectedId("new");
    setForm(createEmptyProfileFormInput());
    setSkills([]);
    setStagedSkills([]);
  };

  const weightTotal = sumRankingWeights(form.rankingWeights);
  const weightsValid = Math.round(weightTotal * 100) / 100 === 100;

  const compensationRangeInvalid =
    form.minCompensation !== null &&
    form.targetCompensation !== null &&
    form.targetCompensation < form.minCompensation;

  const yearsRangeInvalid =
    form.minYearsExperience !== null &&
    form.maxYearsExperience !== null &&
    form.maxYearsExperience < form.minYearsExperience;

  const canSave =
    form.name.trim().length > 0 &&
    weightsValid &&
    !compensationRangeInvalid &&
    !yearsRangeInvalid &&
    !savingProfile;

  const handleSaveProfile = async () => {
    if (!canSave) return;
    setSavingProfile(true);
    try {
      if (selectedId === "new" || !selectedId) {
        const created = await createSearchProfile(form);
        for (const staged of stagedSkills) {
          await addSearchProfileSkill(created.id, {
            displayLabel: staged.displayLabel,
            aliases: staged.aliases,
            preference: staged.preference,
            filterMode: staged.filterMode,
            weight: staged.weight,
          });
        }
        await refreshSearchProfiles();
        setActiveProfileId(created.id);
        const updatedList = await listSearchProfiles();
        setProfiles(updatedList);
        setSelectedId(created.id);
        await loadSelectedProfile(created.id);
        toast({
          title: "Search profile created",
          description: created.name,
          tone: "accent",
        });
      } else {
        const updated = await updateSearchProfile(selectedId, form);
        await refreshSearchProfiles();
        setProfiles((prev) =>
          prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
        );
        setForm(profileToFormInput(updated));
        toast({
          title: "Search strategy saved",
          description: updated.name,
          tone: "accent",
        });
      }
    } catch (err) {
      toast({
        title: "Could not save search profile",
        description: err instanceof Error ? err.message : "Save failed.",
        tone: "danger",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!selectedId || selectedId === "new") return;
    setDeletingProfile(true);
    try {
      const deletedId = selectedId;
      await deleteSearchProfile(deletedId);
      await refreshSearchProfiles();
      const updatedList = await listSearchProfiles();
      setProfiles(updatedList);
      setDeleteDialogOpen(false);
      if (updatedList.length > 0) {
        const next = updatedList[0];
        setSelectedId(next.id);
        if (activeProfileId === deletedId) {
          setActiveProfileId(next.id);
        }
        await loadSelectedProfile(next.id);
      } else {
        setSelectedId("new");
        setForm(createEmptyProfileFormInput());
        setSkills([]);
        setStagedSkills([]);
      }
      toast({
        title: "Search profile deleted",
        tone: "neutral",
      });
    } catch (err) {
      toast({
        title: "Could not delete profile",
        description: err instanceof Error ? err.message : "Delete failed.",
        tone: "danger",
      });
    } finally {
      setDeletingProfile(false);
    }
  };

  const handleAddSkill = async () => {
    const label = newSkillLabel.trim();
    if (!label) return;
    const aliases = newSkillAliases
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const weight = parseNullableNumber(newSkillWeight);

    if (selectedId === "new" || !selectedId) {
      setStagedSkills((prev) => [
        ...prev,
        {
          tempId: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          displayLabel: label,
          aliases,
          preference: newSkillPref,
          filterMode: newSkillMode,
          weight,
        },
      ]);
      setNewSkillLabel("");
      setNewSkillAliases("");
      setNewSkillPref("must_have");
      setNewSkillMode("weighted");
      setNewSkillWeight("");
      return;
    }

    setAddingSkill(true);
    try {
      const created = await addSearchProfileSkill(selectedId, {
        displayLabel: label,
        aliases,
        preference: newSkillPref,
        filterMode: newSkillMode,
        weight,
      });
      setSkills((prev) => [...prev, created]);
      setNewSkillLabel("");
      setNewSkillAliases("");
      setNewSkillPref("must_have");
      setNewSkillMode("weighted");
      setNewSkillWeight("");
      toast({
        title: "Target skill added",
        description: `${created.displayLabel} (${skillPreferenceLabel(created.preference)} · ${created.filterMode})`,
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not add target skill",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setAddingSkill(false);
    }
  };

  const handleUpdateSkill = async (
    skill: SearchProfileSkill,
    patch: Partial<SearchProfileSkillInput>
  ) => {
    if (!selectedId || selectedId === "new") return;
    const previous = skills;
    setBusySkillIds((prev) => ({ ...prev, [skill.id]: true }));
    setSkills((prev) =>
      prev.map((s) => (s.id === skill.id ? { ...s, ...patch } : s))
    );
    try {
      const updated = await updateSearchProfileSkill(
        selectedId,
        skill.id,
        patch
      );
      setSkills((prev) => prev.map((s) => (s.id === skill.id ? updated : s)));
    } catch (err) {
      setSkills(previous);
      toast({
        title: "Could not update target skill",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setBusySkillIds((prev) => {
        const next = { ...prev };
        delete next[skill.id];
        return next;
      });
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    if (!selectedId || selectedId === "new") return;
    const previous = skills;
    setBusySkillIds((prev) => ({ ...prev, [skillId]: true }));
    setSkills((prev) => prev.filter((s) => s.id !== skillId));
    try {
      await deleteSearchProfileSkill(selectedId, skillId);
    } catch (err) {
      setSkills(previous);
      toast({
        title: "Could not remove target skill",
        description: err instanceof Error ? err.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setBusySkillIds((prev) => {
        const next = { ...prev };
        delete next[skillId];
        return next;
      });
    }
  };

  const toggleStringInArray = (arr: string[], item: string): string[] =>
    arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item];

  const toggleWorkplace = (wp: ProfileWorkplaceType) => {
    setForm((prev) => ({
      ...prev,
      workplaceTypes: prev.workplaceTypes.includes(wp)
        ? prev.workplaceTypes.filter((v) => v !== wp)
        : [...prev.workplaceTypes, wp],
    }));
  };

  const moveResumeSection = (index: number, delta: -1 | 1) => {
    setForm((prev) => {
      const next = [...prev.resumePreferences.sectionOrder];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return {
        ...prev,
        resumePreferences: {
          ...prev.resumePreferences,
          sectionOrder: next,
        },
      };
    });
  };

  if (loadingList) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-14 w-full" />
        <div className="grid gap-6 lg:grid-cols-[268px_minmax(0,1fr)]">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-[520px] w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Search profiles
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Independent job-search strategies with explicit hard filters, job-centric target skills, and weighted ranking rules. Your Career Profile remains the single source of verified facts.
          </p>
        </div>
        <Button variant="secondary" size="md" onClick={handleStartNewProfile}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New search profile
        </Button>
      </div>

      {listError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-[8px] border border-[#E4B8B4] bg-[#F8EAE8] px-4 py-3 text-[13px]"
        >
          <div className="flex items-center gap-2 text-[var(--text-primary)]">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-[var(--danger)]"
              aria-hidden="true"
            />
            <span>{listError}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void loadAll()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[268px_minmax(0,1fr)]">
        {/* Left Profile Selector Rail */}
        <aside aria-label="Search profiles list" className="space-y-3">
          <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3.5 py-2.5">
              <span className="text-[12px] font-semibold tracking-wide text-[var(--text-tertiary)] uppercase">
                Strategies ({profiles.length})
              </span>
              {selectedId === "new" ? (
                <Badge tone="accent">Creating new</Badge>
              ) : null}
            </div>

            {profiles.length === 0 ? (
              <div className="px-3.5 py-5 text-[13px] text-[var(--text-secondary)]">
                No saved profiles yet. Configure your first strategy on the right.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {profiles.map((p) => {
                  const isSelected = selectedId === p.id;
                  const isActiveWorkspace = activeProfileId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectProfile(p.id)}
                        className={cn(
                          "flex w-full flex-col gap-1 px-3.5 py-3 text-left transition-colors",
                          isSelected
                            ? "bg-[var(--accent-soft)]"
                            : "hover:bg-[var(--surface-muted)]"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[14px] font-medium text-[var(--text-primary)]">
                            {p.name}
                          </span>
                          {!p.enabled ? (
                            <Badge tone="neutral">Paused</Badge>
                          ) : isActiveWorkspace ? (
                            <Badge tone="accent">Active</Badge>
                          ) : null}
                        </div>
                        <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                          {p.targetTitles.length > 0
                            ? p.targetTitles.slice(0, 2).join(", ")
                            : "Any title"}{" "}
                          ·{" "}
                          {p.workplaceTypes.length > 0
                            ? p.workplaceTypes.join("/")
                            : "Any mode"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Right Strategy Workbench */}
        <div className="space-y-6 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-5">
          {loadingDetail ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <>
              {/* Workbench Action Header */}
              <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-center">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-[16px] font-semibold text-[var(--text-primary)]">
                    {selectedId === "new"
                      ? "New search profile"
                      : form.name || "Untitled search profile"}
                  </h3>
                  <label className="inline-flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({ ...prev, enabled: checked }))
                      }
                      aria-label="Enable search profile"
                    />
                    <span>{form.enabled ? "Enabled" : "Paused"}</span>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedId !== "new" &&
                  selectedId &&
                  activeProfileId !== selectedId ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setActiveProfileId(selectedId);
                        toast({
                          title: "Active workspace profile updated",
                          description: form.name,
                          tone: "accent",
                        });
                      }}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Set as active
                    </Button>
                  ) : null}

                  {selectedId !== "new" && selectedId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteDialogOpen(true)}
                      className="text-[var(--danger)] hover:bg-[#F8EAE8] hover:text-[var(--danger)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  ) : null}

                  <Button
                    variant="primary"
                    size="md"
                    disabled={!canSave}
                    loading={savingProfile}
                    onClick={() => void handleSaveProfile()}
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {selectedId === "new" ? "Create profile" : "Save strategy"}
                  </Button>
                </div>
              </div>

              {!weightsValid || compensationRangeInvalid || yearsRangeInvalid ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] px-3.5 py-2.5 text-[13px] text-[var(--text-primary)]"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
                    aria-hidden="true"
                  />
                  <div className="space-y-0.5">
                    {!weightsValid ? (
                      <p>
                        Ranking weights must total 100% before saving (current total:{" "}
                        <span className="font-data font-semibold">
                          {weightTotal}%
                        </span>
                        ).
                      </p>
                    ) : null}
                    {compensationRangeInvalid ? (
                      <p>
                        Target compensation cannot be lower than minimum acceptable compensation.
                      </p>
                    ) : null}
                    {yearsRangeInvalid ? (
                      <p>
                        Maximum years of experience cannot be less than minimum years.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* 1. Role & Seniority Strategy */}
              <section className="space-y-4 border-b border-[var(--border)] pb-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                      1. Role &amp; seniority strategy
                    </h4>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      Define target role titles, title aliases, seniority levels, and years-of-experience bounds.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <HardModeToggle
                      label="Seniority"
                      isHard={form.hardFilters.seniorityHard}
                      onChange={(seniorityHard) =>
                        setForm((prev) => ({
                          ...prev,
                          hardFilters: { ...prev.hardFilters, seniorityHard },
                        }))
                      }
                    />
                    <HardModeToggle
                      label="Years"
                      isHard={form.hardFilters.yearsExperienceHard}
                      onChange={(yearsExperienceHard) =>
                        setForm((prev) => ({
                          ...prev,
                          hardFilters: {
                            ...prev.hardFilters,
                            yearsExperienceHard,
                          },
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label
                      htmlFor="profile-name"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Profile name
                    </label>
                    <Input
                      id="profile-name"
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="e.g. Backend Engineer, AI Systems, Remote Full Stack"
                      invalid={form.name.trim().length === 0}
                    />
                  </div>

                  <TagListInput
                    id="target-titles"
                    label="Target job titles"
                    values={form.targetTitles}
                    onChange={(targetTitles) =>
                      setForm((prev) => ({ ...prev, targetTitles }))
                    }
                    placeholder="e.g. Backend Engineer, Platform Engineer"
                  />

                  <TagListInput
                    id="title-aliases"
                    label="Title aliases"
                    values={form.titleAliases}
                    onChange={(titleAliases) =>
                      setForm((prev) => ({ ...prev, titleAliases }))
                    }
                    placeholder="e.g. Distributed Systems Engineer, SWE"
                  />
                </div>

                <div className="space-y-2">
                  <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                    Target seniority
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {SENIORITY_PRESETS.map((level) => {
                      const active = form.targetSeniority.includes(level);
                      return (
                        <button
                          key={level}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              targetSeniority: toggleStringInArray(
                                prev.targetSeniority,
                                level
                              ),
                            }))
                          }
                          className={cn(
                            "h-8 rounded-[4px] border px-2.5 text-[13px] font-medium transition-colors",
                            active
                              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                              : "border-[var(--control-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          )}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="min-years"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Minimum years of experience
                    </label>
                    <Input
                      id="min-years"
                      type="number"
                      min={0}
                      max={80}
                      value={form.minYearsExperience ?? ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          minYearsExperience: parseNullableNumber(e.target.value),
                        }))
                      }
                      placeholder="Optional"
                      className="font-data"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="max-years"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Maximum years of experience
                    </label>
                    <Input
                      id="max-years"
                      type="number"
                      min={0}
                      max={80}
                      value={form.maxYearsExperience ?? ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          maxYearsExperience: parseNullableNumber(e.target.value),
                        }))
                      }
                      placeholder="Optional"
                      invalid={yearsRangeInvalid}
                      className="font-data"
                    />
                  </div>
                </div>
              </section>

              {/* 2. Job-centric Target Skills */}
              <section className="space-y-4 border-b border-[var(--border)] pb-6">
                <div>
                  <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                    2. Job-centric target &amp; excluded skills
                  </h4>
                  <p className="mt-1 flex items-start gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                    <Info
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                      aria-hidden="true"
                    />
                    <span>
                      These entries describe skills a <strong>target job posting</strong> should contain or exclude — not a claim that you already possess them. Entries marked <strong>Must have</strong> remain <strong>Weighted</strong> by default unless you explicitly switch them to <strong>Hard filter</strong>.
                    </span>
                  </p>
                </div>

                {/* Inline Add Skill Row */}
                <div className="grid gap-2.5 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] p-3 sm:grid-cols-12 sm:items-end">
                  <div className="space-y-1 sm:col-span-3">
                    <label
                      htmlFor="new-skill-label"
                      className="block text-[12px] font-medium text-[var(--text-secondary)]"
                    >
                      Skill label
                    </label>
                    <Input
                      id="new-skill-label"
                      value={newSkillLabel}
                      onChange={(e) => setNewSkillLabel(e.target.value)}
                      placeholder="e.g. Kubernetes"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-3">
                    <label
                      htmlFor="new-skill-aliases"
                      className="block text-[12px] font-medium text-[var(--text-secondary)]"
                    >
                      Aliases (comma-separated)
                    </label>
                    <Input
                      id="new-skill-aliases"
                      value={newSkillAliases}
                      onChange={(e) => setNewSkillAliases(e.target.value)}
                      placeholder="e.g. k8s, eks"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label
                      htmlFor="new-skill-pref"
                      className="block text-[12px] font-medium text-[var(--text-secondary)]"
                    >
                      Preference
                    </label>
                    <Select
                      value={newSkillPref}
                      onValueChange={(val) =>
                        setNewSkillPref(val as SkillPreference)
                      }
                    >
                      <SelectTrigger id="new-skill-pref">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SKILL_PREFERENCES.map((pref) => (
                          <SelectItem key={pref} value={pref}>
                            {skillPreferenceLabel(pref)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label
                      htmlFor="new-skill-mode"
                      className="block text-[12px] font-medium text-[var(--text-secondary)]"
                    >
                      Filter mode
                    </label>
                    <Select
                      value={newSkillMode}
                      onValueChange={(val) =>
                        setNewSkillMode(val as SkillFilterMode)
                      }
                    >
                      <SelectTrigger id="new-skill-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weighted">Weighted</SelectItem>
                        <SelectItem value="hard">Hard filter</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 sm:col-span-2">
                    <Input
                      aria-label="Optional skill weight"
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={newSkillWeight}
                      onChange={(e) => setNewSkillWeight(e.target.value)}
                      placeholder="Wt"
                      className="w-16 font-data"
                    />
                    <Button
                      variant="primary"
                      size="md"
                      loading={addingSkill}
                      disabled={!newSkillLabel.trim()}
                      onClick={() => void handleAddSkill()}
                      className="flex-1"
                    >
                      Add
                    </Button>
                  </div>
                </div>

                {/* Existing or Staged Skills List */}
                {selectedId === "new" ? (
                  stagedSkills.length === 0 ? (
                    <p className="text-[13px] text-[var(--text-tertiary)]">
                      No target skills added yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)]">
                      {stagedSkills.map((s) => (
                        <div
                          key={s.tempId}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[13px]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-[var(--text-primary)]">
                              {s.displayLabel}
                            </span>
                            {s.aliases && s.aliases.length > 0 ? (
                              <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                                ({s.aliases.join(", ")})
                              </span>
                            ) : null}
                            <Badge tone={skillPreferenceTone(s.preference)}>
                              {skillPreferenceLabel(s.preference)}
                            </Badge>
                            <Badge
                              tone={
                                s.filterMode === "hard" ? "warning" : "neutral"
                              }
                            >
                              {s.filterMode === "hard"
                                ? "Hard filter"
                                : "Weighted"}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${s.displayLabel}`}
                            onClick={() =>
                              setStagedSkills((prev) =>
                                prev.filter((item) => item.tempId !== s.tempId)
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )
                ) : skills.length === 0 ? (
                  <p className="text-[13px] text-[var(--text-tertiary)]">
                    No target skills configured for this profile yet.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)]">
                    {skills.map((skill) => {
                      const isBusy = Boolean(busySkillIds[skill.id]);
                      return (
                        <div
                          key={skill.id}
                          className="flex flex-col justify-between gap-2.5 px-3.5 py-2.5 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[14px] font-medium text-[var(--text-primary)]">
                                {skill.displayLabel}
                              </span>
                              <Badge tone={skillPreferenceTone(skill.preference)}>
                                {skillPreferenceLabel(skill.preference)}
                              </Badge>
                              <Badge
                                tone={
                                  skill.filterMode === "hard"
                                    ? "warning"
                                    : "neutral"
                                }
                              >
                                {skill.filterMode === "hard"
                                  ? "Hard filter"
                                  : "Weighted"}
                              </Badge>
                              {skill.weight !== null ? (
                                <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                                  wt {skill.weight}
                                </span>
                              ) : null}
                            </div>
                            {skill.aliases.length > 0 ? (
                              <p className="font-data text-[12px] text-[var(--text-tertiary)]">
                                Aliases: {skill.aliases.join(", ")}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <Select
                              value={skill.preference}
                              disabled={isBusy}
                              onValueChange={(val) =>
                                void handleUpdateSkill(skill, {
                                  preference: val as SkillPreference,
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label={`Preference for ${skill.displayLabel}`}
                                className="h-8 w-[124px] text-[12px]"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SKILL_PREFERENCES.map((pref) => (
                                  <SelectItem key={pref} value={pref}>
                                    {skillPreferenceLabel(pref)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Select
                              value={skill.filterMode}
                              disabled={isBusy}
                              onValueChange={(val) =>
                                void handleUpdateSkill(skill, {
                                  filterMode: val as SkillFilterMode,
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label={`Filter mode for ${skill.displayLabel}`}
                                className="h-8 w-[116px] text-[12px]"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SKILL_FILTER_MODES.map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {m === "hard" ? "Hard filter" : "Weighted"}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isBusy}
                              aria-label={`Remove ${skill.displayLabel}`}
                              onClick={() => void handleDeleteSkill(skill.id)}
                            >
                              <Trash2
                                className="h-4 w-4 text-[var(--text-secondary)]"
                                aria-hidden="true"
                              />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* 3. Geography, Work Mode & Employment */}
              <section className="space-y-4 border-b border-[var(--border)] pb-6">
                <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  3. Geography, work mode &amp; employment
                </h4>

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">
                      Workplace types
                    </span>
                    <HardModeToggle
                      label="Work mode"
                      isHard={form.hardFilters.workplaceTypesHard}
                      onChange={(workplaceTypesHard) =>
                        setForm((prev) => ({
                          ...prev,
                          hardFilters: {
                            ...prev.hardFilters,
                            workplaceTypesHard,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PROFILE_WORKPLACE_TYPES.map((wp) => {
                      const active = form.workplaceTypes.includes(wp);
                      return (
                        <button
                          key={wp}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleWorkplace(wp)}
                          className={cn(
                            "h-8 rounded-[4px] border px-3 text-[13px] font-medium capitalize transition-colors",
                            active
                              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                              : "border-[var(--control-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          )}
                        >
                          {wp}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <TagListInput
                      id="preferred-locations"
                      label="Preferred locations"
                      values={form.locations}
                      onChange={(locations) =>
                        setForm((prev) => ({ ...prev, locations }))
                      }
                      placeholder="e.g. San Francisco, London, New York"
                    />
                    <HardModeToggle
                      label="Location match"
                      isHard={form.hardFilters.locationsHard}
                      onChange={(locationsHard) =>
                        setForm((prev) => ({
                          ...prev,
                          hardFilters: { ...prev.hardFilters, locationsHard },
                        }))
                      }
                    />
                  </div>

                  <TagListInput
                    id="excluded-locations"
                    label="Excluded locations"
                    values={form.excludedLocations}
                    onChange={(excludedLocations) =>
                      setForm((prev) => ({ ...prev, excludedLocations }))
                    }
                    placeholder="Cities or regions to avoid"
                  />

                  <div className="space-y-2">
                    <TagListInput
                      id="remote-countries"
                      label="Remote-eligible countries"
                      values={form.remoteEligibleCountries}
                      onChange={(remoteEligibleCountries) =>
                        setForm((prev) => ({ ...prev, remoteEligibleCountries }))
                      }
                      placeholder="e.g. US, CA, UK, DE"
                      hint="Evaluated separately from employer headquarters city."
                    />
                    <HardModeToggle
                      label="Remote country"
                      isHard={form.hardFilters.remoteCountriesHard}
                      onChange={(remoteCountriesHard) =>
                        setForm((prev) => ({
                          ...prev,
                          hardFilters: {
                            ...prev.hardFilters,
                            remoteCountriesHard,
                          },
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">
                        Employment types
                      </span>
                      <HardModeToggle
                        label="Employment"
                        isHard={form.hardFilters.employmentTypesHard}
                        onChange={(employmentTypesHard) =>
                          setForm((prev) => ({
                            ...prev,
                            hardFilters: {
                              ...prev.hardFilters,
                              employmentTypesHard,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {EMPLOYMENT_TYPE_PRESETS.map((et) => {
                        const active = form.employmentTypes.includes(et);
                        return (
                          <button
                            key={et}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                employmentTypes: toggleStringInArray(
                                  prev.employmentTypes,
                                  et
                                ),
                              }))
                            }
                            className={cn(
                              "h-8 rounded-[4px] border px-2.5 text-[13px] font-medium transition-colors",
                              active
                                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                                : "border-[var(--control-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            )}
                          >
                            {et}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <label
                      htmlFor="relocation-select"
                      className="text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Relocation willingness
                    </label>
                    <Select
                      value={
                        form.relocationAllowed === null
                          ? "unspecified"
                          : form.relocationAllowed
                            ? "yes"
                            : "no"
                      }
                      onValueChange={(val) =>
                        setForm((prev) => ({
                          ...prev,
                          relocationAllowed:
                            val === "yes" ? true : val === "no" ? false : null,
                        }))
                      }
                    >
                      <SelectTrigger
                        id="relocation-select"
                        className="h-8 w-[180px] text-[13px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unspecified">Not specified</SelectItem>
                        <SelectItem value="yes">Willing to relocate</SelectItem>
                        <SelectItem value="no">Not willing to relocate</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <HardModeToggle
                    label="Relocation"
                    isHard={form.hardFilters.relocationHardNo}
                    onChange={(relocationHardNo) =>
                      setForm((prev) => ({
                        ...prev,
                        hardFilters: {
                          ...prev.hardFilters,
                          relocationHardNo,
                        },
                      }))
                    }
                  />
                </div>
              </section>

              {/* 4. Compensation Thresholds */}
              <section className="space-y-4 border-b border-[var(--border)] pb-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                      4. Compensation preferences
                    </h4>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      MVP performs no currency or pay-period conversion. Missing compensation remains unknown unless excluded below.
                    </p>
                  </div>
                  <HardModeToggle
                    label="Below min"
                    isHard={form.hardFilters.compensationHard}
                    onChange={(compensationHard) =>
                      setForm((prev) => ({
                        ...prev,
                        hardFilters: { ...prev.hardFilters, compensationHard },
                      }))
                    }
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="comp-currency"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Currency (ISO 4217)
                    </label>
                    <Input
                      id="comp-currency"
                      maxLength={3}
                      value={form.compensationCurrency ?? ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          compensationCurrency:
                            e.target.value.toUpperCase() || null,
                        }))
                      }
                      placeholder="USD"
                      className="font-data uppercase"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="comp-period"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Pay period
                    </label>
                    <Select
                      value={form.compensationPeriod ?? "year"}
                      onValueChange={(val) =>
                        setForm((prev) => ({
                          ...prev,
                          compensationPeriod: val as SalaryPeriodOption,
                        }))
                      }
                    >
                      <SelectTrigger id="comp-period">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="year">Per year</SelectItem>
                        <SelectItem value="month">Per month</SelectItem>
                        <SelectItem value="hour">Per hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="comp-min"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Minimum acceptable
                    </label>
                    <Input
                      id="comp-min"
                      type="number"
                      min={0}
                      value={form.minCompensation ?? ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          minCompensation: parseNullableNumber(e.target.value),
                        }))
                      }
                      placeholder="Optional"
                      className="font-data"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="comp-target"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Target amount
                    </label>
                    <Input
                      id="comp-target"
                      type="number"
                      min={0}
                      value={form.targetCompensation ?? ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          targetCompensation: parseNullableNumber(e.target.value),
                        }))
                      }
                      placeholder="Optional"
                      invalid={compensationRangeInvalid}
                      className="font-data"
                    />
                  </div>
                </div>

                <label className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-3.5 py-2.5 text-[13px]">
                  <span className="text-[var(--text-primary)]">
                    Hard-exclude jobs with unknown/undisclosed compensation
                  </span>
                  <Switch
                    checked={form.hardFilters.excludeMissingSalary}
                    onCheckedChange={(excludeMissingSalary) =>
                      setForm((prev) => ({
                        ...prev,
                        hardFilters: {
                          ...prev.hardFilters,
                          excludeMissingSalary,
                        },
                      }))
                    }
                  />
                </label>
              </section>

              {/* 5. Company, Industry & Source Strategy */}
              <section className="space-y-4 border-b border-[var(--border)] pb-6">
                <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  5. Company, industry &amp; source strategy
                </h4>

                <div className="grid gap-4 sm:grid-cols-2">
                  <TagListInput
                    id="preferred-companies"
                    label="Preferred companies"
                    values={form.preferredCompanies}
                    onChange={(preferredCompanies) =>
                      setForm((prev) => ({ ...prev, preferredCompanies }))
                    }
                    placeholder="Companies to boost in priority"
                  />

                  <div className="space-y-2">
                    <TagListInput
                      id="excluded-companies"
                      label="Excluded companies"
                      values={form.excludedCompanies}
                      onChange={(excludedCompanies) =>
                        setForm((prev) => ({ ...prev, excludedCompanies }))
                      }
                      placeholder="Companies to exclude or penalize"
                    />
                    <HardModeToggle
                      label="Excluded companies"
                      isHard={form.hardFilters.excludedCompaniesHard}
                      onChange={(excludedCompaniesHard) =>
                        setForm((prev) => ({
                          ...prev,
                          hardFilters: {
                            ...prev.hardFilters,
                            excludedCompaniesHard,
                          },
                        }))
                      }
                    />
                  </div>

                  <TagListInput
                    id="preferred-industries"
                    label="Preferred industries"
                    values={form.preferredIndustries}
                    onChange={(preferredIndustries) =>
                      setForm((prev) => ({ ...prev, preferredIndustries }))
                    }
                    placeholder="e.g. Developer tools, Climate tech"
                  />

                  <TagListInput
                    id="excluded-industries"
                    label="Dispreferred / excluded industries"
                    values={form.excludedIndustries}
                    onChange={(excludedIndustries) =>
                      setForm((prev) => ({ ...prev, excludedIndustries }))
                    }
                    placeholder="Industries to downrank"
                  />
                </div>

                {sources.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                        Included sources (leave empty for all)
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {sources.map((src) => {
                          const active = form.includedSources.includes(src.id);
                          return (
                            <button
                              key={src.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  includedSources: toggleStringInArray(
                                    prev.includedSources,
                                    src.id
                                  ),
                                }))
                              }
                              className={cn(
                                "h-7 rounded-[4px] border px-2 text-[12px] font-medium transition-colors",
                                active
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                                  : "border-[var(--control-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)]"
                              )}
                            >
                              {src.displayName}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                        Excluded sources
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {sources.map((src) => {
                          const active = form.excludedSources.includes(src.id);
                          return (
                            <button
                              key={src.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  excludedSources: toggleStringInArray(
                                    prev.excludedSources,
                                    src.id
                                  ),
                                }))
                              }
                              className={cn(
                                "h-7 rounded-[4px] border px-2 text-[12px] font-medium transition-colors",
                                active
                                  ? "border-[#E4B8B4] bg-[#F8EAE8] text-[var(--danger)]"
                                  : "border-[var(--control-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)]"
                              )}
                            >
                              {src.displayName}
                            </button>
                          );
                        })}
                      </div>
                      <HardModeToggle
                        label="Excluded sources"
                        isHard={form.hardFilters.excludedSourcesHard}
                        onChange={(excludedSourcesHard) =>
                          setForm((prev) => ({
                            ...prev,
                            hardFilters: {
                              ...prev.hardFilters,
                              excludedSourcesHard,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </section>

              {/* 6. Freshness & Unknown Field Policy */}
              <section className="space-y-3 border-b border-[var(--border)] pb-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                    6. Freshness &amp; unknown-field policy
                  </h4>
                  <HardModeToggle
                    label="Max job age"
                    isHard={form.hardFilters.maxJobAgeHard}
                    onChange={(maxJobAgeHard) =>
                      setForm((prev) => ({
                        ...prev,
                        hardFilters: { ...prev.hardFilters, maxJobAgeHard },
                      }))
                    }
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="max-job-age"
                        className="block text-[13px] font-medium text-[var(--text-primary)]"
                      >
                        Maximum job age (days)
                      </label>
                      <Input
                        id="max-job-age"
                        type="number"
                        min={1}
                        max={3650}
                        value={form.maxJobAgeDays ?? ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            maxJobAgeDays: parseNullableNumber(e.target.value),
                          }))
                        }
                        placeholder="No maximum age"
                        className="font-data"
                      />
                      <p className="text-[12px] text-[var(--text-tertiary)]">
                        When employer-posted date is unknown, maximum age is compared against local discovery time without fabricating a posted date.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="preferred-recency"
                        className="block text-[13px] font-medium text-[var(--text-primary)]"
                      >
                        Preferred recency window (days)
                      </label>
                      <Input
                        id="preferred-recency"
                        type="number"
                        min={1}
                        max={3650}
                        value={form.preferredRecencyDays ?? ""}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            preferredRecencyDays: parseNullableNumber(
                              e.target.value
                            ),
                          }))
                        }
                        placeholder="Optional (e.g. 7)"
                        className="font-data"
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <label className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-3.5 py-2.5 text-[13px]">
                      <span className="text-[var(--text-primary)]">
                        Include jobs with unknown employer-posted date
                      </span>
                      <Switch
                        checked={form.hardFilters.includeUnknownPostedDate}
                        onCheckedChange={(includeUnknownPostedDate) =>
                          setForm((prev) => ({
                            ...prev,
                            hardFilters: {
                              ...prev.hardFilters,
                              includeUnknownPostedDate,
                            },
                          }))
                        }
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-3.5 py-2.5 text-[13px]">
                      <div>
                        <span className="block text-[var(--text-primary)]">
                          Fail closed on unknown fields
                        </span>
                        <span className="text-[12px] text-[var(--text-tertiary)]">
                          When enabled, hard filters also exclude jobs whose location, seniority, or work mode is unspecified.
                        </span>
                      </div>
                      <Switch
                        checked={form.failClosedOnUnknown}
                        onCheckedChange={(checked) =>
                          setForm((prev) => ({
                            ...prev,
                            failClosedOnUnknown: checked,
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              </section>

              {/* 7. Ranking Weights (6 factors summing to 100%) */}
              <section className="space-y-4 border-b border-[var(--border)] pb-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                      7. Recommendation ranking weights
                    </h4>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      Enabled weights must total 100%. Unavailable factors (such as missing salary or unknown posted date) are omitted per job and remaining weights renormalized.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge
                      tone={weightsValid ? "accent" : "danger"}
                      className="font-data"
                    >
                      Total: {weightTotal}%
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          rankingWeights: { ...DEFAULT_RANKING_WEIGHTS },
                        }))
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Reset defaults
                    </Button>
                  </div>
                </div>

                {/* Horizontal proportion bar */}
                <div
                  aria-hidden="true"
                  className="flex h-2 w-full overflow-hidden rounded-[4px] border border-[var(--border)] bg-[var(--surface-muted)]"
                >
                  {RANKING_FACTOR_META.map((factor, idx) => {
                    const val = Math.max(0, form.rankingWeights[factor.key]);
                    const palette = [
                      "bg-[#416653]",
                      "bg-[#5A7D6B]",
                      "bg-[#749382]",
                      "bg-[#8E9B8F]",
                      "bg-[#A7ACA1]",
                      "bg-[#C4C4BA]",
                    ];
                    return (
                      <div
                        key={factor.key}
                        style={{
                          width: `${weightTotal > 0 ? (val / Math.max(100, weightTotal)) * 100 : 0}%`,
                        }}
                        className={cn(
                          "h-full transition-all",
                          palette[idx % palette.length]
                        )}
                      />
                    );
                  })}
                </div>

                <div className="divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)]">
                  {RANKING_FACTOR_META.map((factor) => (
                    <div
                      key={factor.key}
                      className="flex flex-col justify-between gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0">
                        <label
                          htmlFor={`weight-${factor.key}`}
                          className="block text-[13px] font-medium text-[var(--text-primary)]"
                        >
                          {factor.label}
                        </label>
                        <p className="text-[12px] text-[var(--text-tertiary)]">
                          {factor.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Input
                          id={`weight-${factor.key}`}
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={form.rankingWeights[factor.key]}
                          onChange={(e) => {
                            const val = Math.max(
                              0,
                              Math.min(100, Number(e.target.value) || 0)
                            );
                            setForm((prev) => ({
                              ...prev,
                              rankingWeights: {
                                ...prev.rankingWeights,
                                [factor.key]: val,
                              },
                            }));
                          }}
                          className="h-8 w-20 text-right font-data"
                        />
                        <span className="font-data text-[13px] text-[var(--text-secondary)]">
                          %
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 8. Resume & Cover Letter Preferences */}
              <section className="space-y-4">
                <div>
                  <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
                    8. Resume &amp; cover letter preferences
                  </h4>
                  <p className="text-[12px] text-[var(--text-secondary)]">
                    Defaults applied when generating tailored application materials for this search strategy.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="resume-pages"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Target page count
                    </label>
                    <Select
                      value={form.resumePreferences.pagePreference}
                      onValueChange={(val) =>
                        setForm((prev) => ({
                          ...prev,
                          resumePreferences: {
                            ...prev.resumePreferences,
                            pagePreference:
                              val === "1_page" || val === "2_pages"
                                ? val
                                : "auto",
                          },
                        }))
                      }
                    >
                      <SelectTrigger id="resume-pages">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1_page">1 page</SelectItem>
                        <SelectItem value="2_pages">2 pages</SelectItem>
                        <SelectItem value="auto">Auto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="resume-paper"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Default paper size
                    </label>
                    <Select
                      value={form.resumePreferences.paperSize}
                      onValueChange={(val) =>
                        setForm((prev) => ({
                          ...prev,
                          resumePreferences: {
                            ...prev.resumePreferences,
                            paperSize: val === "Letter" ? "Letter" : "A4",
                          },
                        }))
                      }
                    >
                      <SelectTrigger id="resume-paper">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A4">A4</SelectItem>
                        <SelectItem value="Letter">US Letter</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="resume-wording"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Wording style
                    </label>
                    <Select
                      value={form.resumePreferences.wordingStyle}
                      onValueChange={(val) =>
                        setForm((prev) => ({
                          ...prev,
                          resumePreferences: {
                            ...prev.resumePreferences,
                            wordingStyle:
                              val === "descriptive" ? "descriptive" : "concise",
                          },
                        }))
                      }
                    >
                      <SelectTrigger id="resume-wording">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="concise">Concise</SelectItem>
                        <SelectItem value="descriptive">Descriptive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="cl-tone"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Cover letter tone
                    </label>
                    <Select
                      value={form.resumePreferences.coverLetterTone ?? "direct"}
                      onValueChange={(val) =>
                        setForm((prev) => ({
                          ...prev,
                          resumePreferences: {
                            ...prev.resumePreferences,
                            coverLetterTone: val,
                          },
                        }))
                      }
                    >
                      <SelectTrigger id="cl-tone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">Direct</SelectItem>
                        <SelectItem value="analytical">Analytical</SelectItem>
                        <SelectItem value="warm">Warm</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="cl-length"
                      className="block text-[13px] font-medium text-[var(--text-primary)]"
                    >
                      Cover letter length
                    </label>
                    <Select
                      value={form.resumePreferences.coverLetterLength}
                      onValueChange={(val) =>
                        setForm((prev) => ({
                          ...prev,
                          resumePreferences: {
                            ...prev.resumePreferences,
                            coverLetterLength:
                              val === "short" || val === "long"
                                ? val
                                : "medium",
                          },
                        }))
                      }
                    >
                      <SelectTrigger id="cl-length">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="short">Short</SelectItem>
                        <SelectItem value="medium">Standard</SelectItem>
                        <SelectItem value="long">Detailed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-end">
                    <label className="flex h-9 w-full items-center justify-between gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--canvas)] px-3 text-[13px]">
                      <span className="truncate text-[var(--text-primary)]">
                        Allow company research
                      </span>
                      <Switch
                        checked={form.resumePreferences.allowCompanyResearch}
                        onCheckedChange={(checked) =>
                          setForm((prev) => ({
                            ...prev,
                            resumePreferences: {
                              ...prev.resumePreferences,
                              allowCompanyResearch: checked,
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>

                {/* Accessible Section Order Controls */}
                <div className="space-y-1.5">
                  <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                    Preferred resume section order
                  </span>
                  <div className="divide-y divide-[var(--border)] rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)]">
                    {form.resumePreferences.sectionOrder.map((sec, idx) => (
                      <div
                        key={sec}
                        className="flex items-center justify-between px-3 py-1.5 text-[13px]"
                      >
                        <span className="capitalize text-[var(--text-primary)]">
                          <span className="mr-2 font-data text-[12px] text-[var(--text-tertiary)]">
                            {idx + 1}.
                          </span>
                          {sec}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={idx === 0}
                            aria-label={`Move ${sec} up`}
                            onClick={() => moveResumeSection(idx, -1)}
                          >
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={
                              idx ===
                              form.resumePreferences.sectionOrder.length - 1
                            }
                            aria-label={`Move ${sec} down`}
                            onClick={() => moveResumeSection(idx, 1)}
                          >
                            <ArrowDown
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete search profile</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{form.name}&rdquo;? Match runs and saved job states associated with this strategy will be removed. Your Career Profile facts are never affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deletingProfile}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deletingProfile}
              onClick={() => void handleDeleteProfile()}
            >
              Delete profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
