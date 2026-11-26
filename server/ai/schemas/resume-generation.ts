import { z } from "zod";
import type { FullCareerProfile } from "../../services/profile";

export const RESUME_PROMPT_VERSION = "resume_v1" as const;
export const COVER_LETTER_PROMPT_VERSION = "cover_letter_v1" as const;
export const ANSWERS_PROMPT_VERSION = "answers_v1" as const;

export const PAPER_SIZES = ["A4", "Letter"] as const;
export const PaperSizeSchema = z.enum(PAPER_SIZES);
export type PaperSize = z.infer<typeof PaperSizeSchema>;

export const MARGIN_PRESETS = ["compact", "standard", "relaxed"] as const;
export const MarginPresetSchema = z.enum(MARGIN_PRESETS);
export type MarginPreset = z.infer<typeof MarginPresetSchema>;

export const ResumeTemplateSettingsSchema = z.object({
  paperSize: PaperSizeSchema.default("A4"),
  fontSizeScale: z.number().min(0.85).max(1.15).default(1),
  lineHeightScale: z.number().min(0.9).max(1.25).default(1),
  marginPreset: MarginPresetSchema.default("standard"),
  showSummary: z.boolean().default(true),
  showProjects: z.boolean().default(true),
  showAchievements: z.boolean().default(true),
  showCertifications: z.boolean().default(true),
  showLanguages: z.boolean().default(false),
});
export type ResumeTemplateSettings = z.infer<typeof ResumeTemplateSettingsSchema>;

export const CLAIM_FACT_TYPES = [
  "experience",
  "project",
  "achievement",
  "skill",
  "education",
  "certification",
  "language",
  "profile",
] as const;
export const ClaimFactTypeSchema = z.enum(CLAIM_FACT_TYPES);
export type ClaimFactType = z.infer<typeof ClaimFactTypeSchema>;

export const ClaimEvidenceRefSchema = z.object({
  factType: ClaimFactTypeSchema,
  factId: z.string().min(1),
  evidenceLinkId: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
});
export type ClaimEvidenceRef = z.infer<typeof ClaimEvidenceRefSchema>;

export const CLAIM_USER_EDITED_STATES = [
  "generated",
  "user_edited",
  "user_verified",
] as const;
export const ClaimUserEditedStateSchema = z.enum(CLAIM_USER_EDITED_STATES);
export type ClaimUserEditedState = z.infer<typeof ClaimUserEditedStateSchema>;

export const CLAIM_VERIFICATION_STATUSES = [
  "verified",
  "needs_review",
  "rejected",
] as const;
export const ClaimVerificationStatusSchema = z.enum(
  CLAIM_VERIFICATION_STATUSES
);
export type ClaimVerificationStatus = z.infer<
  typeof ClaimVerificationStatusSchema
>;

export const ResumeBulletSchema = z.object({
  id: z.string().trim().min(1),
  sectionId: z.string().trim().min(1),
  stableEntryId: z.string().trim().min(1),
  text: z.string().trim().min(1),
  sortOrder: z.number().int().min(0),
  userEditedState: ClaimUserEditedStateSchema.default("generated"),
  verificationStatus: ClaimVerificationStatusSchema.default("needs_review"),
  evidenceRefs: z.array(ClaimEvidenceRefSchema).default([]),
});
export type ResumeBullet = z.infer<typeof ResumeBulletSchema>;

export const ResumeSectionEntrySchema = z.object({
  id: z.string().trim().min(1),
  heading: z.string().trim().min(1),
  subheading: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  dateRange: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0),
  bullets: z.array(ResumeBulletSchema).default([]),
});
export type ResumeSectionEntry = z.infer<typeof ResumeSectionEntrySchema>;

export const RESUME_SECTION_TYPES = [
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "achievements",
  "certifications",
  "languages",
] as const;
export const ResumeSectionTypeSchema = z.enum(RESUME_SECTION_TYPES);
export type ResumeSectionType = z.infer<typeof ResumeSectionTypeSchema>;

export const ResumeSkillItemSchema = z.object({
  factId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  proficiency: z.string().nullable().optional(),
  evidenceRefs: z.array(ClaimEvidenceRefSchema).default([]),
});
export type ResumeSkillItem = z.infer<typeof ResumeSkillItemSchema>;

export const ResumeSkillGroupSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  items: z.array(ResumeSkillItemSchema).default([]),
});
export type ResumeSkillGroup = z.infer<typeof ResumeSkillGroupSchema>;

export const ResumeSectionSchema = z.object({
  id: z.string().trim().min(1),
  type: ResumeSectionTypeSchema,
  title: z.string().trim().min(1),
  sortOrder: z.number().int().min(0),
  summaryText: z.string().nullable().optional(),
  summaryClaimId: z.string().nullable().optional(),
  summaryUserEditedState: ClaimUserEditedStateSchema.optional(),
  summaryVerificationStatus: ClaimVerificationStatusSchema.optional(),
  summaryEvidenceRefs: z.array(ClaimEvidenceRefSchema).default([]),
  entries: z.array(ResumeSectionEntrySchema).default([]),
  skillGroups: z.array(ResumeSkillGroupSchema).default([]),
});
export type ResumeSection = z.infer<typeof ResumeSectionSchema>;

export const ResumeHeaderLinkSchema = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().min(1),
});
export type ResumeHeaderLink = z.infer<typeof ResumeHeaderLinkSchema>;

export const ResumeHeaderSchema = z.object({
  fullName: z.string().trim().min(1),
  headline: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  links: z.array(ResumeHeaderLinkSchema).default([]),
});
export type ResumeHeader = z.infer<typeof ResumeHeaderSchema>;

export const StructuredResumeDocumentSchema = z.object({
  version: z.literal(1),
  header: ResumeHeaderSchema,
  sections: z.array(ResumeSectionSchema),
});
export type StructuredResumeDocument = z.infer<
  typeof StructuredResumeDocumentSchema
>;

export const CoverLetterParagraphSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
  evidenceRefs: z.array(ClaimEvidenceRefSchema).default([]),
});
export type CoverLetterParagraph = z.infer<typeof CoverLetterParagraphSchema>;

export const CoverLetterContentSchema = z.object({
  greeting: z.string().trim().min(1),
  paragraphs: z.array(CoverLetterParagraphSchema).min(1),
  closing: z.string().trim().min(1),
  signature: z.string().trim().min(1),
});
export type CoverLetterContent = z.infer<typeof CoverLetterContentSchema>;

export const ApplicationAnswerItemSchema = z.object({
  promptKey: z.string().trim().min(1),
  promptText: z.string().trim().min(1),
  answerText: z.string(),
  evidenceRefs: z.array(ClaimEvidenceRefSchema).default([]),
  requiresHumanInput: z.boolean().default(false),
  withheldReason: z.string().nullable().optional(),
});
export type ApplicationAnswerItem = z.infer<typeof ApplicationAnswerItemSchema>;

export interface VerifiedFactCatalogItem {
  key: string;
  factType: ClaimFactType;
  factId: string;
  label: string;
  excerpt: string;
  textCorpus: string;
  defaultEvidenceLinkId: string | null;
}

export interface VerifiedFactCatalog {
  items: VerifiedFactCatalogItem[];
  byKey: Record<string, VerifiedFactCatalogItem>;
  byType: Record<ClaimFactType, VerifiedFactCatalogItem[]>;
}

export interface FactualityValidationResult {
  valid: boolean;
  violations: string[];
}

export function makeFactCatalogKey(
  factType: ClaimFactType,
  factId: string
): string {
  return `${factType}:${factId}`;
}

function joinCorpusParts(parts: Array<unknown>): string {
  const flat: string[] = [];
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    if (typeof part === "string") {
      const trimmed = part.trim();
      if (trimmed) flat.push(trimmed);
    } else if (typeof part === "number" || typeof part === "boolean") {
      flat.push(String(part));
    } else if (Array.isArray(part)) {
      const nested = joinCorpusParts(part);
      if (nested) flat.push(nested);
    } else if (typeof part === "object") {
      for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
        const nested = joinCorpusParts([v]);
        if (nested) flat.push(`${k}: ${nested}`);
      }
    }
  }
  return flat.join(" | ");
}

function pickDefaultEvidenceLinkId(
  links: Array<{ id: string; verificationStatus: string }>
): string | null {
  const verified = links.find((l) => l.verificationStatus === "verified");
  if (verified) return verified.id;
  const nonRejected = links.find((l) => l.verificationStatus !== "rejected");
  return nonRejected?.id ?? null;
}

function collectEvidenceExcerpts(
  links: Array<{ excerpt: string | null; verificationStatus: string }>
): string[] {
  return links
    .filter((l) => l.verificationStatus !== "rejected" && l.excerpt)
    .map((l) => l.excerpt as string);
}

/**
 * Builds an index of ONLY `verificationStatus === "verified"` career facts
 * keyed by `${factType}:${factId}`. Excludes `needs_review`, `rejected`, and `archived`.
 */
export function buildVerifiedFactCatalog(
  careerProfile: FullCareerProfile
): VerifiedFactCatalog {
  const items: VerifiedFactCatalogItem[] = [];
  const byKey: Record<string, VerifiedFactCatalogItem> = {};
  const byType: Record<ClaimFactType, VerifiedFactCatalogItem[]> = {
    experience: [],
    project: [],
    achievement: [],
    skill: [],
    education: [],
    certification: [],
    language: [],
    profile: [],
  };

  const addItem = (item: VerifiedFactCatalogItem) => {
    items.push(item);
    byKey[item.key] = item;
    byType[item.factType].push(item);
  };

  if (
    careerProfile.profile &&
    careerProfile.profile.verificationStatus === "verified"
  ) {
    const p = careerProfile.profile;
    const factId = String(p.id);
    addItem({
      key: makeFactCatalogKey("profile", factId),
      factType: "profile",
      factId,
      label: p.fullName.trim() || "Candidate Profile",
      excerpt: (p.summary || p.headline || p.fullName || "Verified profile").slice(
        0,
        240
      ),
      textCorpus: joinCorpusParts([
        p.fullName,
        p.headline,
        p.summary,
        p.location,
        p.email,
        p.phone,
        p.websiteUrl,
        p.linkedinUrl,
        p.githubUrl,
        p.noticePeriod,
        p.workAuthorizationSummary,
        p.additionalDetails,
        collectEvidenceExcerpts(p.evidenceLinks),
      ]),
      defaultEvidenceLinkId: pickDefaultEvidenceLinkId(p.evidenceLinks),
    });
  }

  for (const exp of careerProfile.experiences) {
    if (exp.verificationStatus !== "verified") continue;
    const verifiedSkills = exp.skills
      .filter((s) => s.verificationStatus === "verified")
      .map((s) => s.canonicalName);
    const firstLine =
      exp.description
        ?.split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean) ?? `${exp.title} at ${exp.employer}`;

    addItem({
      key: makeFactCatalogKey("experience", exp.id),
      factType: "experience",
      factId: exp.id,
      label: `${exp.title} at ${exp.employer}`,
      excerpt: firstLine.slice(0, 240),
      textCorpus: joinCorpusParts([
        exp.employer,
        exp.title,
        exp.location,
        exp.startDate,
        exp.endDate,
        exp.isCurrent ? "Present Current" : "",
        exp.employmentType,
        exp.description,
        verifiedSkills,
        collectEvidenceExcerpts(exp.evidenceLinks),
      ]),
      defaultEvidenceLinkId: pickDefaultEvidenceLinkId(exp.evidenceLinks),
    });
  }

  for (const proj of careerProfile.projects) {
    if (proj.verificationStatus !== "verified") continue;
    const verifiedSkills = proj.skills
      .filter((s) => s.verificationStatus === "verified")
      .map((s) => s.canonicalName);
    const excerptSource =
      proj.outcomes ||
      proj.description ||
      proj.roleContribution ||
      proj.problem ||
      proj.name;

    addItem({
      key: makeFactCatalogKey("project", proj.id),
      factType: "project",
      factId: proj.id,
      label: proj.name,
      excerpt: excerptSource.slice(0, 240),
      textCorpus: joinCorpusParts([
        proj.name,
        proj.problem,
        proj.description,
        proj.roleContribution,
        proj.architecture,
        proj.challengesSolved,
        proj.outcomes,
        proj.metrics,
        proj.metricsJson,
        proj.startDate,
        proj.endDate,
        proj.url,
        proj.targetRoles,
        verifiedSkills,
        collectEvidenceExcerpts(proj.evidenceLinks),
      ]),
      defaultEvidenceLinkId: pickDefaultEvidenceLinkId(proj.evidenceLinks),
    });
  }

  for (const ach of careerProfile.achievements) {
    if (ach.verificationStatus !== "verified") continue;
    const verifiedSkills = ach.skills
      .filter((s) => s.verificationStatus === "verified")
      .map((s) => s.canonicalName);
    const combinedMetric =
      ach.metricValue !== null && ach.metricUnit
        ? `${ach.metricValue}${ach.metricUnit} ${ach.metricValue} ${ach.metricUnit}`
        : ach.metricValue !== null
          ? String(ach.metricValue)
          : "";

    addItem({
      key: makeFactCatalogKey("achievement", ach.id),
      factType: "achievement",
      factId: ach.id,
      label: ach.text.slice(0, 120),
      excerpt: ach.text.slice(0, 240),
      textCorpus: joinCorpusParts([
        ach.text,
        combinedMetric,
        ach.metricContext,
        verifiedSkills,
        collectEvidenceExcerpts(ach.evidenceLinks),
      ]),
      defaultEvidenceLinkId: pickDefaultEvidenceLinkId(ach.evidenceLinks),
    });
  }

  for (const sk of careerProfile.skills) {
    if (sk.verificationStatus !== "verified") continue;
    addItem({
      key: makeFactCatalogKey("skill", sk.id),
      factType: "skill",
      factId: sk.id,
      label: sk.canonicalName,
      excerpt: [sk.canonicalName, sk.proficiency, sk.category]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 240),
      textCorpus: joinCorpusParts([
        sk.canonicalName,
        sk.normalizedKey,
        sk.aliases,
        sk.category,
        sk.proficiency,
        collectEvidenceExcerpts(sk.evidenceLinks),
      ]),
      defaultEvidenceLinkId: pickDefaultEvidenceLinkId(sk.evidenceLinks),
    });
  }

  for (const ed of careerProfile.education) {
    if (ed.verificationStatus !== "verified") continue;
    addItem({
      key: makeFactCatalogKey("education", ed.id),
      factType: "education",
      factId: ed.id,
      label: `${ed.qualification} — ${ed.institution}`,
      excerpt: [ed.qualification, ed.fieldOfStudy, ed.institution]
        .filter(Boolean)
        .join(", ")
        .slice(0, 240),
      textCorpus: joinCorpusParts([
        ed.institution,
        ed.qualification,
        ed.fieldOfStudy,
        ed.startDate,
        ed.endDate,
        ed.details,
        collectEvidenceExcerpts(ed.evidenceLinks),
      ]),
      defaultEvidenceLinkId: pickDefaultEvidenceLinkId(ed.evidenceLinks),
    });
  }

  for (const cert of careerProfile.certifications) {
    if (cert.verificationStatus !== "verified") continue;
    addItem({
      key: makeFactCatalogKey("certification", cert.id),
      factType: "certification",
      factId: cert.id,
      label: cert.name,
      excerpt: [cert.name, cert.issuer, cert.issueDate]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 240),
      textCorpus: joinCorpusParts([
        cert.name,
        cert.issuer,
        cert.issueDate,
        cert.expiryDate,
        cert.credentialUrl,
        collectEvidenceExcerpts(cert.evidenceLinks),
      ]),
      defaultEvidenceLinkId: pickDefaultEvidenceLinkId(cert.evidenceLinks),
    });
  }

  for (const lang of careerProfile.languages) {
    if (lang.verificationStatus !== "verified") continue;
    addItem({
      key: makeFactCatalogKey("language", lang.id),
      factType: "language",
      factId: lang.id,
      label: lang.language,
      excerpt: [lang.language, lang.proficiency]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 240),
      textCorpus: joinCorpusParts([
        lang.language,
        lang.proficiency,
        collectEvidenceExcerpts(lang.evidenceLinks),
      ]),
      defaultEvidenceLinkId: pickDefaultEvidenceLinkId(lang.evidenceLinks),
    });
  }

  return { items, byKey, byType };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeNumericCorpus(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/([$€£¥₹])\s+(?=\d)/g, "$1")
    .replace(/\bpercent(?:age)?\b/g, "%")
    .replace(/\bthousand\b/g, "k")
    .replace(/\bmillion\b/g, "m")
    .replace(/\bbillion\b/g, "b")
    .replace(/\btrillion\b/g, "t")
    .replace(/\s+(?=(%|ms|s|sec|secs|min|mins|hr|hrs|h|kb|mb|gb|tb|k|m|b|t|x)\b)/g, "");
}

/**
 * Extracts standalone numeric metrics, percentages, currencies, multipliers,
 * and multi-digit figures while ignoring alphanumeric identifiers like S3, EC2, K8s, or OAuth2.
 */
export function extractNumericClaims(text: string): string[] {
  const normalized = text.normalize("NFKC").replace(/(\d),(\d)/g, "$1$2");
  const pattern =
    /(?<![A-Za-z])(?:[$€£¥₹]\s*\d+(?:\.\d+)?(?:[kKmMbBtT]\+?)?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?[xX]\b|\d+(?:\.\d+)?[kKmMbBtT]\+?|\d+\.\d+(?:[A-Za-z+]+)?|\d{2,}(?:[A-Za-z+]+)?|\d+\+)/g;

  const matches = normalized.match(pattern) ?? [];
  const unique = new Set<string>();
  for (const m of matches) {
    const cleaned = m.replace(/\s+/g, "").trim();
    if (cleaned) unique.add(cleaned);
  }
  return Array.from(unique);
}

function isNumericTokenSupportedByCorpus(
  token: string,
  normalizedCorpus: string
): boolean {
  const normToken = token.toLowerCase().replace(/(\d),(\d)/g, "$1$2");
  const candidates = new Set<string>([normToken]);

  // Expand shorthand magnitude tokens to numeric equivalents (e.g. $2m -> 2000000, 50k -> 50000)
  const magnitudeMatch = normToken.match(
    /^([$€£¥₹])?(\d+(?:\.\d+)?)([kmbt])(\+)?$/
  );
  if (magnitudeMatch) {
    const [, currency = "", numStr, suffix] = magnitudeMatch;
    const base = Number(numStr);
    const mult =
      suffix === "k"
        ? 1_000
        : suffix === "m"
          ? 1_000_000
          : suffix === "b"
            ? 1_000_000_000
            : 1_000_000_000_000;
    if (Number.isFinite(base)) {
      const expanded = String(Math.round(base * mult));
      candidates.add(`${currency}${expanded}`);
      candidates.add(expanded);
    }
    if (currency) {
      candidates.add(`${numStr}${suffix}`);
    }
  }

  // Allow currency-prefixed exact figure to match bare figure if currency symbol appears separately
  const currencyMatch = normToken.match(/^([$€£¥₹])(\d+(?:\.\d+)?)$/);
  if (currencyMatch) {
    const [, currency, numStr] = currencyMatch;
    if (normalizedCorpus.includes(currency)) {
      candidates.add(numStr);
    }
  }

  for (const candidate of candidates) {
    // Allow sentence-ending periods (e.g., "by 35%." or "served 500.") while blocking partial decimals ("35" matching "35.5").
    const endsWithDigit = /\d$/.test(candidate);
    const trailingLookahead = endsWithDigit ? "(?!\\d|\\.\\d)" : "(?![A-Za-z0-9])";
    const boundaryRegex = new RegExp(
      `(?<!\\d)(?<!\\d\\.)${escapeRegExp(candidate)}${trailingLookahead}`
    );
    if (boundaryRegex.test(normalizedCorpus)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates that a claim's evidenceRefs all point to verified facts in the catalog
 * and that any numeric figures in the generated text appear in the cited facts' corpus.
 */
export function validateClaimAgainstCatalog(params: {
  text: string;
  userEditedState: ClaimUserEditedState;
  evidenceRefs: ClaimEvidenceRef[];
  catalog: VerifiedFactCatalog;
  claimLabel: string;
  enforceEvidenceForGenerated?: boolean;
}): string[] {
  const violations: string[] = [];
  const {
    text,
    userEditedState,
    evidenceRefs,
    catalog,
    claimLabel,
    enforceEvidenceForGenerated = true,
  } = params;

  const citedCorpusParts: string[] = [];

  for (const ref of evidenceRefs) {
    const key = makeFactCatalogKey(ref.factType, ref.factId);
    const fact = catalog.byKey[key];
    if (!fact) {
      violations.push(
        `${claimLabel} cites unverified, rejected, or non-existent fact "${key}".`
      );
    } else {
      citedCorpusParts.push(fact.textCorpus);
    }
  }

  if (
    enforceEvidenceForGenerated &&
    userEditedState === "generated" &&
    evidenceRefs.length < 1
  ) {
    violations.push(
      `${claimLabel} has userEditedState="generated" with no verified evidenceRefs.`
    );
  }

  if (userEditedState === "generated" && citedCorpusParts.length > 0) {
    const combinedCorpus = normalizeNumericCorpus(citedCorpusParts.join(" | "));
    const numericTokens = extractNumericClaims(text);
    for (const token of numericTokens) {
      if (!isNumericTokenSupportedByCorpus(token, combinedCorpus)) {
        violations.push(
          `Generated ${claimLabel} introduces unverified numeric figure "${token}" in "${text.slice(0, 120)}".`
        );
      }
    }
  }

  return violations;
}

/**
 * Validates structural consistency and strict factuality of a StructuredResumeDocument
 * against a VerifiedFactCatalog.
 */
export function validateStructuredResumeFactuality(
  doc: StructuredResumeDocument,
  catalog: VerifiedFactCatalog
): FactualityValidationResult {
  const violations: string[] = [];

  const parsed = StructuredResumeDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push(
        `Invalid resume document structure at "${issue.path.join(".")}": ${issue.message}`
      );
    }
    return { valid: false, violations };
  }

  const validDoc = parsed.data;

  if (!validDoc.header.fullName.trim()) {
    violations.push("Resume header fullName must not be empty.");
  }

  const seenSectionIds = new Set<string>();
  const seenEntryIds = new Set<string>();
  const seenBulletIds = new Set<string>();

  for (const section of validDoc.sections) {
    if (seenSectionIds.has(section.id)) {
      violations.push(`Duplicate section id "${section.id}".`);
    }
    seenSectionIds.add(section.id);

    // Check summary claim if present
    if (section.summaryText && section.summaryText.trim().length > 0) {
      if (!section.summaryClaimId || !section.summaryClaimId.trim()) {
        violations.push(
          `Summary in section "${section.id}" is missing summaryClaimId.`
        );
      }
      const summaryState: ClaimUserEditedState =
        section.summaryUserEditedState ?? "generated";
      violations.push(
        ...validateClaimAgainstCatalog({
          text: section.summaryText,
          userEditedState: summaryState,
          evidenceRefs: section.summaryEvidenceRefs,
          catalog,
          claimLabel: `summary (${section.id})`,
        })
      );
    } else if (section.summaryEvidenceRefs.length > 0) {
      for (const ref of section.summaryEvidenceRefs) {
        const key = makeFactCatalogKey(ref.factType, ref.factId);
        if (!catalog.byKey[key]) {
          violations.push(
            `Summary in section "${section.id}" cites unverified or non-existent fact "${key}".`
          );
        }
      }
    }

    // Check entries and bullets
    for (const entry of section.entries) {
      if (seenEntryIds.has(entry.id)) {
        violations.push(
          `Duplicate entry id "${entry.id}" in section "${section.id}".`
        );
      }
      seenEntryIds.add(entry.id);

      if (!entry.heading.trim()) {
        violations.push(
          `Entry "${entry.id}" in section "${section.id}" has an empty heading.`
        );
      }

      for (const bullet of entry.bullets) {
        if (seenBulletIds.has(bullet.id)) {
          violations.push(`Duplicate bullet id "${bullet.id}".`);
        }
        seenBulletIds.add(bullet.id);

        if (bullet.sectionId !== section.id) {
          violations.push(
            `Bullet "${bullet.id}" has sectionId="${bullet.sectionId}" but resides in section "${section.id}".`
          );
        }
        if (bullet.stableEntryId !== entry.id) {
          violations.push(
            `Bullet "${bullet.id}" has stableEntryId="${bullet.stableEntryId}" but resides in entry "${entry.id}".`
          );
        }

        violations.push(
          ...validateClaimAgainstCatalog({
            text: bullet.text,
            userEditedState: bullet.userEditedState,
            evidenceRefs: bullet.evidenceRefs,
            catalog,
            claimLabel: `bullet "${bullet.id}"`,
          })
        );
      }
    }

    // Check skillGroups evidence refs
    for (const group of section.skillGroups) {
      for (const skillItem of group.items) {
        const expectedSkillKey = makeFactCatalogKey("skill", skillItem.factId);
        if (!catalog.byKey[expectedSkillKey]) {
          violations.push(
            `Skill "${skillItem.name}" in group "${group.id}" references unverified or non-existent skill "${expectedSkillKey}".`
          );
        }
        for (const ref of skillItem.evidenceRefs) {
          const key = makeFactCatalogKey(ref.factType, ref.factId);
          if (!catalog.byKey[key]) {
            violations.push(
              `Skill "${skillItem.name}" in group "${group.id}" cites unverified or non-existent fact "${key}".`
            );
          }
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

interface SensitivePromptRule {
  pattern: RegExp;
  reason: string;
}

const SENSITIVE_PROMPT_RULES: SensitivePromptRule[] = [
  {
    pattern:
      /\b(work\s*authori[sz]ation|authori[sz]ed\s+to\s+work|legally\s+authori[sz]ed|right\s+to\s+work|visa\s*sponsorship|require\s+sponsorship|need\s+sponsorship|immigration\s+status|citizenship|citizen\s+of|nationality|permanent\s+resident|green\s+card|h-?1b|opt\s+status|cpt\s+status|work\s+permit)\b/i,
    reason:
      "Work authorization, visa sponsorship, citizenship, and nationality questions require manual human input.",
  },
  {
    pattern:
      /\b(security\s+clearance|clearance\s+level|top\s+secret|secret\s+clearance|ts\/sci|polygraph|itar\s+eligibility)\b/i,
    reason:
      "Security clearance and export-control eligibility questions require manual human input.",
  },
  {
    pattern:
      /\b(salary\s+expectation|expected\s+salary|desired\s+salary|desired\s+compensation|expected\s+compensation|compensation\s+expectation|current\s+salary|salary\s+history|compensation\s+history|current\s+compensation|expected\s+pay|pay\s+rate\s+expectation|hourly\s+rate\s+expectation)\b/i,
    reason:
      "Salary expectation and compensation history questions require manual human input.",
  },
  {
    pattern:
      /\b(eeo|equal\s+employment\s+opportunity|demographic|gender\s+identity|what\s+is\s+your\s+gender|what\s+is\s+your\s+sex|pronouns|race\s*\/?\s*ethnicity|racial\s+or\s+ethnic|hispanic\s+or\s+latino|veteran\s+status|protected\s+veteran|disability\s+status|have\s+a\s+disability|reasonable\s+accommodation|date\s+of\s+birth|\bdob\b|your\s+age|are\s+you\s+(?:over|at\s+least)\s+18|marital\s+status|family\s+status|pregnant|pregnancy|religious\s+belief|religion|sexual\s+orientation)\b/i,
    reason:
      "Demographic, EEO, age, disability, veteran, and protected-class questions must be answered manually by the candidate.",
  },
  {
    pattern:
      /\b(criminal\s+background|criminal\s+history|criminal\s+record|felony|misdemeanor|convicted\s+of\s+a\s+crime|background\s+check|drug\s+test|drug\s+screen)\b/i,
    reason:
      "Background check and criminal history questions require manual human review.",
  },
  {
    pattern:
      /\b(non-?compete|restrictive\s+covenant|non-?solicitation|legal\s+declaration|arbitration\s+agreement|i\s+certify\s+that|under\s+penalty\s+of\s+perjury|pending\s+litigation)\b/i,
    reason:
      "Legal declarations, non-compete agreements, and certifications require manual human review.",
  },
];

/**
 * Detects application prompts that involve work authorization, legal declarations,
 * compensation expectations, security clearance, criminal background, or demographic/EEO fields.
 */
export function isSensitiveApplicationPrompt(promptText: string): {
  sensitive: boolean;
  reason: string | null;
} {
  const normalized = promptText.normalize("NFKC").trim();
  if (!normalized) {
    return { sensitive: false, reason: null };
  }

  for (const rule of SENSITIVE_PROMPT_RULES) {
    if (rule.pattern.test(normalized)) {
      return { sensitive: true, reason: rule.reason };
    }
  }

  return { sensitive: false, reason: null };
}
