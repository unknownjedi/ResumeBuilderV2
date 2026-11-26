import {
  asRecord,
  extractApiErrorMessage,
  normalizeSearchProfile,
  normalizeSearchProfileSkill,
  type SearchProfileFormInput,
  type SearchProfileRecord,
  type SearchProfileSkill,
  type SearchProfileSkillInput,
} from "./types";

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function serializeProfileInput(input: Partial<SearchProfileFormInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.enabled !== undefined) payload.enabled = input.enabled;
  if (input.targetTitles !== undefined) payload.targetTitles = input.targetTitles;
  if (input.titleAliases !== undefined) payload.titleAliases = input.titleAliases;
  if (input.targetSeniority !== undefined) {
    payload.targetSeniority = input.targetSeniority;
  }
  if (input.minYearsExperience !== undefined) {
    payload.minYearsExperience = input.minYearsExperience;
  }
  if (input.maxYearsExperience !== undefined) {
    payload.maxYearsExperience = input.maxYearsExperience;
  }
  if (input.locations !== undefined) payload.locations = input.locations;
  if (input.excludedLocations !== undefined) {
    payload.excludedLocations = input.excludedLocations;
  }
  if (input.remoteEligibleCountries !== undefined) {
    payload.remoteEligibleCountries = input.remoteEligibleCountries;
  }
  if (input.workplaceTypes !== undefined) {
    payload.workplaceTypes = input.workplaceTypes;
  }
  if (input.employmentTypes !== undefined) {
    payload.employmentTypes = input.employmentTypes;
  }
  if (input.relocationAllowed !== undefined) {
    payload.relocationAllowed = input.relocationAllowed;
  }
  if (input.maxJobAgeDays !== undefined) {
    payload.maxJobAgeDays = input.maxJobAgeDays;
  }
  if (input.preferredRecencyDays !== undefined) {
    payload.preferredRecencyDays = input.preferredRecencyDays;
  }
  if (input.minCompensation !== undefined) {
    payload.minCompensation = input.minCompensation;
  }
  if (input.targetCompensation !== undefined) {
    payload.targetCompensation = input.targetCompensation;
  }
  if (input.compensationCurrency !== undefined) {
    payload.compensationCurrency = input.compensationCurrency;
  }
  if (input.compensationPeriod !== undefined) {
    payload.compensationPeriod = input.compensationPeriod;
  }
  if (input.preferredCompanies !== undefined) {
    payload.preferredCompanies = input.preferredCompanies;
  }
  if (input.excludedCompanies !== undefined) {
    payload.excludedCompanies = input.excludedCompanies;
  }
  if (input.preferredIndustries !== undefined) {
    payload.preferredIndustries = input.preferredIndustries;
  }
  if (input.excludedIndustries !== undefined) {
    payload.excludedIndustries = input.excludedIndustries;
  }
  if (input.includedSources !== undefined) {
    payload.includedSources = input.includedSources;
  }
  if (input.excludedSources !== undefined) {
    payload.excludedSources = input.excludedSources;
  }
  if (input.failClosedOnUnknown !== undefined) {
    payload.failClosedOnUnknown = input.failClosedOnUnknown;
  }
  if (input.hardFilters !== undefined) {
    payload.hardFilters = input.hardFilters;
  }
  if (input.rankingWeights !== undefined) {
    payload.rankingWeights = input.rankingWeights;
  }
  if (input.resumePreferences !== undefined) {
    payload.resumePreferences = input.resumePreferences;
  }
  return payload;
}

export async function listSearchProfiles(): Promise<SearchProfileRecord[]> {
  const response = await fetch("/api/search-profiles", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to load search profiles (HTTP ${response.status}).`
      )
    );
  }

  const root = asRecord(data);
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root?.profiles)
        ? root.profiles
        : [];

  return rawList
    .map(normalizeSearchProfile)
    .filter((item): item is SearchProfileRecord => item !== null);
}

export async function getSearchProfile(id: string): Promise<SearchProfileRecord> {
  const response = await fetch(`/api/search-profiles/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to load search profile (HTTP ${response.status}).`
      )
    );
  }

  const normalized = normalizeSearchProfile(data);
  if (!normalized) {
    throw new Error("Server returned an unexpected search profile payload.");
  }
  return normalized;
}

export async function createSearchProfile(
  input: SearchProfileFormInput
): Promise<SearchProfileRecord> {
  const response = await fetch("/api/search-profiles", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(serializeProfileInput(input)),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to create search profile (HTTP ${response.status}).`
      )
    );
  }

  const normalized = normalizeSearchProfile(data);
  if (!normalized) {
    throw new Error("Server returned an unexpected search profile response.");
  }
  return normalized;
}

export async function updateSearchProfile(
  id: string,
  input: Partial<SearchProfileFormInput>
): Promise<SearchProfileRecord> {
  const response = await fetch(`/api/search-profiles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(serializeProfileInput(input)),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to update search profile (HTTP ${response.status}).`
      )
    );
  }

  const normalized = normalizeSearchProfile(data);
  if (!normalized) {
    throw new Error("Server returned an unexpected search profile response.");
  }
  return normalized;
}

export async function deleteSearchProfile(id: string): Promise<void> {
  const response = await fetch(`/api/search-profiles/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to delete search profile (HTTP ${response.status}).`
      )
    );
  }
}

export async function listSearchProfileSkills(
  profileId: string
): Promise<SearchProfileSkill[]> {
  const response = await fetch(
    `/api/search-profiles/${encodeURIComponent(profileId)}/skills`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to load profile skills (HTTP ${response.status}).`
      )
    );
  }

  const root = asRecord(data);
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray(root?.items)
      ? root.items
      : Array.isArray(root?.skills)
        ? root.skills
        : [];

  return rawList
    .map(normalizeSearchProfileSkill)
    .filter((s): s is SearchProfileSkill => s !== null);
}

export async function addSearchProfileSkill(
  profileId: string,
  input: SearchProfileSkillInput
): Promise<SearchProfileSkill> {
  const payload: Record<string, unknown> = {
    displayLabel: input.displayLabel.trim(),
    aliases: input.aliases ?? [],
    preference: input.preference,
    filterMode: input.filterMode,
  };
  if (input.weight !== undefined) {
    payload.weight = input.weight;
  }

  const response = await fetch(
    `/api/search-profiles/${encodeURIComponent(profileId)}/skills`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to add skill preference (HTTP ${response.status}).`
      )
    );
  }

  const root = asRecord(data);
  const normalized = normalizeSearchProfileSkill(root?.skill ?? root?.item ?? data);
  if (!normalized) {
    throw new Error("Server returned an unexpected skill response.");
  }
  return normalized;
}

export async function updateSearchProfileSkill(
  profileId: string,
  skillId: string,
  input: Partial<SearchProfileSkillInput>
): Promise<SearchProfileSkill> {
  const payload: Record<string, unknown> = {};
  if (input.displayLabel !== undefined) payload.displayLabel = input.displayLabel.trim();
  if (input.aliases !== undefined) payload.aliases = input.aliases;
  if (input.preference !== undefined) payload.preference = input.preference;
  if (input.filterMode !== undefined) payload.filterMode = input.filterMode;
  if (input.weight !== undefined) payload.weight = input.weight;

  const response = await fetch(
    `/api/search-profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to update skill preference (HTTP ${response.status}).`
      )
    );
  }

  const root = asRecord(data);
  const normalized = normalizeSearchProfileSkill(root?.skill ?? root?.item ?? data);
  if (!normalized) {
    throw new Error("Server returned an unexpected skill response.");
  }
  return normalized;
}

export async function deleteSearchProfileSkill(
  profileId: string,
  skillId: string
): Promise<void> {
  const response = await fetch(
    `/api/search-profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}`,
    {
      method: "DELETE",
      headers: { Accept: "application/json" },
    }
  );
  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(
      extractApiErrorMessage(
        data,
        `Failed to delete skill preference (HTTP ${response.status}).`
      )
    );
  }
}
