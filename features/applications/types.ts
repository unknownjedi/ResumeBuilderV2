import type { BadgeTone } from "@/components/ui/badge";
import {
  asRecord,
  normalizeDocumentExport,
  normalizeEvidenceRef,
  type DocumentExportRecord,
  type ExportFormat,
  type ResumeEvidenceRef,
  type UserEditedState,
} from "@/features/resume-builder/types";

export const APPLICATION_STATUSES = [
  "preparing",
  "ready_to_apply",
  "applied",
  "response_received",
  "rejected",
  "withdrawn",
  "archived",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_META: Record<
  ApplicationStatus,
  { label: string; tone: BadgeTone; description: string }
> = {
  preparing: {
    label: "Preparing",
    tone: "neutral",
    description: "Drafting tailored resume, cover letter, and answers.",
  },
  ready_to_apply: {
    label: "Ready to apply",
    tone: "warning",
    description: "Materials reviewed and ready for manual submission.",
  },
  applied: {
    label: "Applied",
    tone: "accent",
    description: "Submitted directly on the employer portal.",
  },
  response_received: {
    label: "Response received",
    tone: "accent",
    description: "Employer replied or scheduled next step.",
  },
  rejected: {
    label: "Rejected",
    tone: "danger",
    description: "Application closed by employer.",
  },
  withdrawn: {
    label: "Withdrawn",
    tone: "neutral",
    description: "Withdrawn by candidate.",
  },
  archived: {
    label: "Archived",
    tone: "neutral",
    description: "Archived from active pipeline.",
  },
};

export const STANDARD_APPLICATION_PROMPTS = [
  {
    key: "why_interested",
    label: "Why are you interested in this role?",
  },
  {
    key: "why_company",
    label: "Why this company?",
  },
  {
    key: "why_good_fit",
    label: "Why are you a good fit?",
  },
  {
    key: "relevant_experience",
    label: "Describe relevant experience",
  },
] as const;

export const COVER_LETTER_TONES = ["balanced", "concise", "direct"] as const;
export type CoverLetterTone = (typeof COVER_LETTER_TONES)[number];

export const COVER_LETTER_LENGTHS = ["short", "medium", "detailed"] as const;
export type CoverLetterLength = (typeof COVER_LETTER_LENGTHS)[number];

export interface ApplicationEventItem {
  id: string;
  applicationId: string;
  priorStatus: ApplicationStatus | null;
  newStatus: ApplicationStatus;
  note: string | null;
  occurredAt: string;
}

export interface ResumeVersionOption {
  id: string;
  resumeDraftId: string;
  versionNumber: number;
  contentHash: string;
  createdAt: string;
}

export interface CoverLetterParagraphItem {
  id: string;
  text: string;
  evidenceRefs: ResumeEvidenceRef[];
}

export interface CoverLetterStructuredContent {
  greeting: string;
  paragraphs: CoverLetterParagraphItem[];
  closing: string;
  signature: string;
}

export interface CoverLetterRecord {
  id: string;
  jobId: string;
  searchProfileId: string;
  applicationId: string | null;
  structuredContent: CoverLetterStructuredContent;
  text: string;
  evidenceRefs: ResumeEvidenceRef[];
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  userEditedState: UserEditedState;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  exports: DocumentExportRecord[];
}

export interface ApplicationAnswerRecord {
  id: string;
  jobId: string;
  searchProfileId: string;
  applicationId: string | null;
  promptKey: string;
  promptText: string;
  answerText: string;
  evidenceRefs: ResumeEvidenceRef[];
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  userEditedState: UserEditedState;
  requiresManualInput: boolean;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubmittedMaterialsSnapshot {
  resumeVersionId: string | null;
  resumeVersionNumber: number | null;
  resumeContentHash: string | null;
  coverLetterId: string | null;
  coverLetterContentHash: string | null;
  coverLetterText: string | null;
  answerIds: string[];
  answers: Array<{
    id: string;
    promptKey: string;
    promptText: string;
    answerText: string;
    contentHash: string | null;
  }>;
  appliedAt: string | null;
  originalApplyUrl: string | null;
}

export interface ApplicationRecord {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  locationText: string | null;
  workplaceType: string | null;
  searchProfileId: string;
  searchProfileName: string | null;
  status: ApplicationStatus;
  appliedAt: string | null;
  resumeVersionId: string | null;
  resumeVersionNumber: number | null;
  originalApplyUrl: string | null;
  submittedMaterialsSnapshot: SubmittedMaterialsSnapshot | null;
  submittedMaterialsHash: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  events: ApplicationEventItem[];
  resumeVersions: ResumeVersionOption[];
  coverLetter: CoverLetterRecord | null;
  answers: ApplicationAnswerRecord[];
}

export type { ExportFormat };

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const SENSITIVE_QUESTION_PATTERN =
  /\b(work\s*auth|authoriz|visa|sponsor|citizenship|citizen|resident|green\s*card|permit|demograph|gender|pronoun|race|ethnic|veteran|disability|eeo|equal\s*opportunity|criminal|felony|conviction|background\s*check|legal\s*declar|relocat|salary\s*expectation|compensation\s*expectation)\b/i;

/**
 * Identifies work-authorization, visa, legal, and demographic questions that must
 * always be flagged as requiring manual input and never auto-filled.
 */
export function isSensitiveApplicationPrompt(
  promptKey: string,
  promptText: string
): boolean {
  return (
    SENSITIVE_QUESTION_PATTERN.test(promptKey) ||
    SENSITIVE_QUESTION_PATTERN.test(promptText)
  );
}

export function coverLetterToPlainText(
  content: CoverLetterStructuredContent
): string {
  const parts: string[] = [];
  if (content.greeting?.trim()) parts.push(content.greeting.trim());
  for (const p of content.paragraphs) {
    if (p.text.trim()) parts.push(p.text.trim());
  }
  if (content.closing?.trim()) parts.push(content.closing.trim());
  if (content.signature?.trim()) parts.push(content.signature.trim());
  return parts.join("\n\n");
}

export function plainTextToCoverLetterContent(
  text: string,
  existing?: CoverLetterStructuredContent | null
): CoverLetterStructuredContent {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length === 0) {
    return {
      greeting: existing?.greeting ?? "Dear Hiring Team,",
      paragraphs: [{ id: "p-1", text: "", evidenceRefs: [] }],
      closing: existing?.closing ?? "Sincerely,",
      signature: existing?.signature ?? "Candidate",
    };
  }
  if (blocks.length === 1) {
    return {
      greeting: existing?.greeting ?? "Dear Hiring Team,",
      paragraphs: [
        {
          id: existing?.paragraphs[0]?.id ?? "p-1",
          text: blocks[0],
          evidenceRefs: existing?.paragraphs[0]?.evidenceRefs ?? [],
        },
      ],
      closing: existing?.closing ?? "Sincerely,",
      signature: existing?.signature ?? "Candidate",
    };
  }
  const first = blocks[0];
  const hasGreeting = /^(dear|hello|hi)\b/i.test(first);
  const last = blocks[blocks.length - 1];
  const prevLast = blocks.length >= 2 ? blocks[blocks.length - 2] : "";
  const hasClosing =
    /^(sincerely|regards|best|warmly|thank you|respectfully)/i.test(prevLast) ||
    /^(sincerely|regards|best|warmly|thank you|respectfully)/i.test(last);

  let start = 0;
  let greeting = existing?.greeting ?? "Dear Hiring Team,";
  if (hasGreeting) {
    greeting = first;
    start = 1;
  }
  let end = blocks.length;
  let closing = existing?.closing ?? "Sincerely,";
  let signature = existing?.signature ?? "Candidate";
  if (hasClosing && blocks.length - start >= 2) {
    if (
      /^(sincerely|regards|best|warmly|thank you|respectfully)/i.test(prevLast)
    ) {
      closing = prevLast;
      signature = last;
      end = blocks.length - 2;
    } else {
      closing = last;
      end = blocks.length - 1;
    }
  }
  const bodyBlocks = blocks.slice(start, end);
  return {
    greeting,
    paragraphs: bodyBlocks.map((pText, idx) => ({
      id: existing?.paragraphs[idx]?.id ?? `p-${idx + 1}`,
      text: pText,
      evidenceRefs: existing?.paragraphs[idx]?.evidenceRefs ?? [],
    })),
    closing,
    signature,
  };
}

export function normalizeCoverLetter(raw: unknown): CoverLetterRecord | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;

  let scRaw: unknown = obj.structuredContent ?? obj.structuredContentJson;
  if (typeof scRaw === "string") {
    try {
      scRaw = JSON.parse(scRaw);
    } catch {
      scRaw = {};
    }
  }
  const scObj = asRecord(scRaw) ?? {};
  const rawParagraphs = Array.isArray(scObj.paragraphs) ? scObj.paragraphs : [];
  const paragraphs: CoverLetterParagraphItem[] = rawParagraphs
    .map((p, idx): CoverLetterParagraphItem | null => {
      if (typeof p === "string") {
        return { id: `p-${idx + 1}`, text: p, evidenceRefs: [] };
      }
      const pObj = asRecord(p);
      if (!pObj) return null;
      const pText = asString(pObj.text);
      if (!pText) return null;
      const pRefs = Array.isArray(pObj.evidenceRefs)
        ? pObj.evidenceRefs
            .map(normalizeEvidenceRef)
            .filter((r): r is ResumeEvidenceRef => r !== null)
        : [];
      return {
        id: asString(pObj.id, `p-${idx + 1}`),
        text: pText,
        evidenceRefs: pRefs,
      };
    })
    .filter((p): p is CoverLetterParagraphItem => p !== null);

  const structuredContent: CoverLetterStructuredContent = {
    greeting: asString(scObj.greeting, "Dear Hiring Team,"),
    paragraphs,
    closing: asString(scObj.closing, "Sincerely,"),
    signature: asString(scObj.signature, "Candidate"),
  };
  const explicitText =
    asNullableString(obj.text) ?? asNullableString(scObj.fullText);
  const text = explicitText ?? coverLetterToPlainText(structuredContent);
  if (structuredContent.paragraphs.length === 0 && text.trim().length > 0) {
    Object.assign(
      structuredContent,
      plainTextToCoverLetterContent(text, structuredContent)
    );
  }

  let refsRaw: unknown = obj.evidenceRefs ?? obj.evidenceRefsJson;
  if (typeof refsRaw === "string") {
    try {
      refsRaw = JSON.parse(refsRaw);
    } catch {
      refsRaw = [];
    }
  }
  const evidenceRefs = Array.isArray(refsRaw)
    ? refsRaw
        .map(normalizeEvidenceRef)
        .filter((r): r is ResumeEvidenceRef => r !== null)
    : [];

  const exportsRaw = Array.isArray(obj.exports) ? obj.exports : [];

  return {
    id,
    jobId: asString(obj.jobId),
    searchProfileId: asString(obj.searchProfileId),
    applicationId: asNullableString(obj.applicationId),
    structuredContent,
    text,
    evidenceRefs,
    modelProvider: asNullableString(obj.modelProvider),
    modelName: asNullableString(obj.modelName),
    promptVersion: asNullableString(obj.promptVersion),
    userEditedState: asString(obj.userEditedState, "generated") as UserEditedState,
    contentHash: asString(obj.contentHash),
    createdAt: asString(obj.createdAt),
    updatedAt: asString(obj.updatedAt),
    exports: exportsRaw
      .map(normalizeDocumentExport)
      .filter((e): e is DocumentExportRecord => e !== null),
  };
}

export function normalizeApplicationAnswer(
  raw: unknown
): ApplicationAnswerRecord | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;

  let refsRaw: unknown = obj.evidenceRefs ?? obj.evidenceRefsJson;
  if (typeof refsRaw === "string") {
    try {
      refsRaw = JSON.parse(refsRaw);
    } catch {
      refsRaw = [];
    }
  }
  const evidenceRefs = Array.isArray(refsRaw)
    ? refsRaw
        .map(normalizeEvidenceRef)
        .filter((r): r is ResumeEvidenceRef => r !== null)
    : [];

  const promptKey = asString(obj.promptKey, "custom");
  const promptText = asString(obj.promptText);
  const sensitive =
    Boolean(obj.requiresHumanInput) ||
    Boolean(obj.requiresManualInput) ||
    Boolean(obj.isSensitive) ||
    isSensitiveApplicationPrompt(promptKey, promptText);

  return {
    id,
    jobId: asString(obj.jobId),
    searchProfileId: asString(obj.searchProfileId),
    applicationId: asNullableString(obj.applicationId),
    promptKey,
    promptText,
    answerText: sensitive && asString(obj.userEditedState) !== "user_edited" && asString(obj.userEditedState) !== "user_verified"
      ? ""
      : asString(obj.answerText),
    evidenceRefs,
    modelProvider: asNullableString(obj.modelProvider),
    modelName: asNullableString(obj.modelName),
    promptVersion: asNullableString(obj.promptVersion),
    userEditedState: asString(obj.userEditedState, "generated") as UserEditedState,
    requiresManualInput: sensitive,
    contentHash: asString(obj.contentHash),
    createdAt: asString(obj.createdAt),
    updatedAt: asString(obj.updatedAt),
  };
}

export function normalizeApplicationEvent(
  raw: unknown
): ApplicationEventItem | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;
  return {
    id,
    applicationId: asString(obj.applicationId),
    priorStatus: asNullableString(obj.priorStatus) as ApplicationStatus | null,
    newStatus: asString(obj.newStatus, "preparing") as ApplicationStatus,
    note: asNullableString(obj.note),
    occurredAt: asString(obj.occurredAt),
  };
}

export function normalizeResumeVersionOption(
  raw: unknown
): ResumeVersionOption | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;
  return {
    id,
    resumeDraftId: asString(obj.resumeDraftId),
    versionNumber: asNumber(obj.versionNumber, 1),
    contentHash: asString(obj.contentHash),
    createdAt: asString(obj.createdAt),
  };
}

export function normalizeSubmittedSnapshot(
  raw: unknown
): SubmittedMaterialsSnapshot | null {
  let target = raw;
  if (typeof target === "string") {
    try {
      target = JSON.parse(target);
    } catch {
      return null;
    }
  }
  const obj = asRecord(target);
  if (!obj) return null;
  const answersRaw = Array.isArray(obj.answers) ? obj.answers : [];
  return {
    resumeVersionId: asNullableString(obj.resumeVersionId),
    resumeVersionNumber:
      typeof obj.resumeVersionNumber === "number"
        ? obj.resumeVersionNumber
        : null,
    resumeContentHash: asNullableString(obj.resumeContentHash),
    coverLetterId: asNullableString(obj.coverLetterId),
    coverLetterContentHash: asNullableString(obj.coverLetterContentHash),
    coverLetterText: asNullableString(obj.coverLetterText),
    answerIds: Array.isArray(obj.answerIds)
      ? obj.answerIds.filter((x): x is string => typeof x === "string")
      : [],
    answers: answersRaw
      .map((a) => {
        const aObj = asRecord(a);
        if (!aObj) return null;
        return {
          id: asString(aObj.id),
          promptKey: asString(aObj.promptKey),
          promptText: asString(aObj.promptText),
          answerText: asString(aObj.answerText),
          contentHash: asNullableString(aObj.contentHash),
        };
      })
      .filter(
        (
          a
        ): a is {
          id: string;
          promptKey: string;
          promptText: string;
          answerText: string;
          contentHash: string | null;
        } => a !== null
      ),
    appliedAt: asNullableString(obj.appliedAt),
    originalApplyUrl: asNullableString(obj.originalApplyUrl),
  };
}

export function normalizeApplicationRecord(
  raw: unknown
): ApplicationRecord | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const id = asString(obj.id);
  if (!id) return null;

  const jobObj = asRecord(obj.job);
  const eventsRaw = Array.isArray(obj.events) ? obj.events : [];
  const versionsRaw = Array.isArray(obj.resumeVersions)
    ? obj.resumeVersions
    : [];
  const answersRaw = Array.isArray(obj.answers) ? obj.answers : [];

  const coverLetterCandidate =
    obj.coverLetter ??
    (Array.isArray(obj.coverLetters) ? obj.coverLetters[0] : null);

  return {
    id,
    jobId: asString(obj.jobId),
    jobTitle: asString(obj.jobTitle || jobObj?.title, "Untitled role"),
    companyName: asString(
      obj.companyName || jobObj?.companyName,
      "Unknown company"
    ),
    locationText: asNullableString(obj.locationText ?? jobObj?.locationText),
    workplaceType: asNullableString(obj.workplaceType ?? jobObj?.workplaceType),
    searchProfileId: asString(obj.searchProfileId),
    searchProfileName: asNullableString(obj.searchProfileName),
    status: asString(obj.status, "preparing") as ApplicationStatus,
    appliedAt: asNullableString(obj.appliedAt),
    resumeVersionId: asNullableString(obj.resumeVersionId),
    resumeVersionNumber:
      typeof obj.resumeVersionNumber === "number"
        ? obj.resumeVersionNumber
        : null,
    originalApplyUrl: asNullableString(
      obj.originalApplyUrl ?? jobObj?.applyUrl ?? jobObj?.canonicalUrl
    ),
    submittedMaterialsSnapshot: normalizeSubmittedSnapshot(
      obj.submittedMaterialsSnapshot ?? obj.submittedMaterialsSnapshotJson
    ),
    submittedMaterialsHash: asNullableString(obj.submittedMaterialsHash),
    notes: asNullableString(obj.notes),
    createdAt: asString(obj.createdAt),
    updatedAt: asString(obj.updatedAt),
    events: eventsRaw
      .map(normalizeApplicationEvent)
      .filter((e): e is ApplicationEventItem => e !== null),
    resumeVersions: versionsRaw
      .map(normalizeResumeVersionOption)
      .filter((v): v is ResumeVersionOption => v !== null),
    coverLetter: normalizeCoverLetter(coverLetterCandidate),
    answers: answersRaw
      .map(normalizeApplicationAnswer)
      .filter((a): a is ApplicationAnswerRecord => a !== null),
  };
}
