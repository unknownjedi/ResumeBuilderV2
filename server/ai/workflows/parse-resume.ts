import crypto from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "../../db/client";
import {
  achievements,
  certifications,
  education,
  evidenceLinks,
  experiences,
  languages,
  projects,
  skills,
  sourceDocuments,
  type ExtractionStatus,
} from "../../db/schema/career";
import {
  DocumentExtractionError,
  extractDocumentText,
} from "../../documents/extract";
import {
  assertPathWithin,
  ensureAppDirectories,
  writeSecureFile,
  type AppPaths,
} from "../../files/paths";
import { logger } from "../../logging/logger";
import { redactPaths, redactString } from "../../security/redaction";
import { validateResumeUpload } from "../../security/upload-guard";
import { getSettings } from "../../services/settings";
import { generateStructuredWithTracking } from "../providers/index";
import {
  RESUME_IMPORT_PROMPT_VERSION,
  RESUME_IMPORT_SCHEMA_VERSION,
  RESUME_IMPORT_SYSTEM_PROMPT,
  ResumeImportExtractionSchema,
  type ExtractedProfileField,
  type ResumeImportExtraction,
} from "../schemas/resume-import";
import { AiProviderError } from "../types";

export interface SanitizedSourceDocument {
  id: string;
  displayFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  extractionStatus: ExtractionStatus;
  parserVersion: string | null;
  errorMessage: string | null;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedResumeFactCounts {
  experiences: number;
  projects: number;
  achievements: number;
  skills: number;
  education: number;
  certifications: number;
  languages: number;
}

export interface ProfileSuggestions {
  headline: ExtractedProfileField | null;
  summary: ExtractedProfileField | null;
  location: ExtractedProfileField | null;
}

export type ResumeImportAiStatus =
  | "extracted"
  | "failed_raw_preserved"
  | "raw_text_only"
  | "not_applicable";

export interface ImportResumeResult {
  status: "extracted" | "scanned_pdf" | "failed";
  sourceDocument: SanitizedSourceDocument;
  extractedText: string;
  extractionStatus: ExtractionStatus;
  pageCount: number | null;
  aiStatus: ResumeImportAiStatus;
  createdCounts: CreatedResumeFactCounts;
  profileSuggestions: ProfileSuggestions | null;
  aiError: string | null;
}

export interface ImportResumeInput {
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
  useAi?: boolean;
}

export interface ImportResumeDeps {
  db?: AppDatabase;
  appDataDir?: string;
  paths?: AppPaths;
  generateStructured?: typeof generateStructuredWithTracking;
  extractText?: typeof extractDocumentText;
  now?: () => Date;
}

const SCANNED_PDF_MESSAGE =
  "This PDF appears to be scanned or image-only and contains no extractable text. Please upload a text-based PDF, DOCX, TXT, or Markdown file, or enter your profile details manually.";

function createEmptyCounts(): CreatedResumeFactCounts {
  return {
    experiences: 0,
    projects: 0,
    achievements: 0,
    skills: 0,
    education: 0,
    certifications: 0,
    languages: 0,
  };
}

function sanitizeDisplayFilename(rawName: string): string {
  const base = path.posix.basename(rawName.replaceAll("\\", "/")).trim();
  const cleaned = base.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 255);
  return cleaned || "resume";
}

function normalizeSkillKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeAiError(err: unknown): string {
  if (err instanceof AiProviderError) {
    return redactPaths(redactString(err.message));
  }
  if (err instanceof Error && err.message.trim()) {
    return redactPaths(redactString(err.message.trim()));
  }
  return "AI structured extraction failed; raw extracted text was preserved for manual review.";
}

function toSanitizedSourceDocument(row: {
  id: string;
  displayFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  extractionStatus: ExtractionStatus;
  parserVersion: string | null;
  errorMessage: string | null;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}): SanitizedSourceDocument {
  return {
    id: row.id,
    displayFilename: row.displayFilename,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    fileHash: row.fileHash,
    extractionStatus: row.extractionStatus,
    parserVersion: row.parserVersion,
    errorMessage: row.errorMessage,
    importedAt: row.importedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function persistSourceDocumentRow(
  db: AppDatabase,
  row: typeof sourceDocuments.$inferInsert
): SanitizedSourceDocument {
  db.insert(sourceDocuments).values(row).run();
  return toSanitizedSourceDocument({
    id: row.id,
    displayFilename: row.displayFilename,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    fileHash: row.fileHash,
    extractionStatus: row.extractionStatus ?? "pending",
    parserVersion: row.parserVersion ?? null,
    errorMessage: row.errorMessage ?? null,
    importedAt: row.importedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function persistExtractedFacts(
  db: AppDatabase,
  docId: string,
  extracted: ResumeImportExtraction,
  nowIso: string
): { createdCounts: CreatedResumeFactCounts; profileSuggestions: ProfileSuggestions | null } {
  const counts = createEmptyCounts();

  db.transaction((tx) => {
    for (let i = 0; i < extracted.experiences.length; i++) {
      const item = extracted.experiences[i];
      const id = crypto.randomUUID();
      tx.insert(experiences)
        .values({
          id,
          employer: item.employer,
          title: item.title,
          location: item.location ?? null,
          startDate: item.startDate ?? null,
          endDate: item.endDate ?? null,
          isCurrent: Boolean(item.isCurrent),
          employmentType: item.employmentType ?? null,
          description: item.description ?? null,
          sortOrder: i,
          verificationStatus: "needs_review",
          origin: "resume_import",
          verifiedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();

      tx.insert(evidenceLinks)
        .values({
          id: crypto.randomUUID(),
          sourceDocumentId: docId,
          excerpt: item.sourceExcerpt,
          targetType: "experience",
          targetId: id,
          extractionConfidence: clampConfidence(item.confidence),
          verificationStatus: "needs_review",
          origin: "resume_import",
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      counts.experiences++;
    }

    for (let i = 0; i < extracted.projects.length; i++) {
      const item = extracted.projects[i];
      const id = crypto.randomUUID();
      tx.insert(projects)
        .values({
          id,
          experienceId: null,
          name: item.name,
          problem: item.problem ?? null,
          description: item.description ?? null,
          roleContribution: item.roleContribution ?? null,
          architecture: item.architecture ?? null,
          challengesSolved: item.challengesSolved ?? null,
          outcomes: item.outcomes ?? null,
          metricsJson: null,
          startDate: item.startDate ?? null,
          endDate: item.endDate ?? null,
          url: item.url ?? null,
          targetRolesJson: null,
          sortOrder: i,
          verificationStatus: "needs_review",
          origin: "resume_import",
          verifiedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();

      tx.insert(evidenceLinks)
        .values({
          id: crypto.randomUUID(),
          sourceDocumentId: docId,
          excerpt: item.sourceExcerpt,
          targetType: "project",
          targetId: id,
          extractionConfidence: clampConfidence(item.confidence),
          verificationStatus: "needs_review",
          origin: "resume_import",
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      counts.projects++;
    }

    for (let i = 0; i < extracted.achievements.length; i++) {
      const item = extracted.achievements[i];
      const id = crypto.randomUUID();
      tx.insert(achievements)
        .values({
          id,
          experienceId: null,
          projectId: null,
          text: item.text,
          metricValue: item.metricValue ?? null,
          metricUnit: item.metricUnit ?? null,
          metricContext: item.metricContext ?? null,
          sortOrder: i,
          verificationStatus: "needs_review",
          origin: "resume_import",
          verifiedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();

      tx.insert(evidenceLinks)
        .values({
          id: crypto.randomUUID(),
          sourceDocumentId: docId,
          excerpt: item.sourceExcerpt,
          targetType: "achievement",
          targetId: id,
          extractionConfidence: clampConfidence(item.confidence),
          verificationStatus: "needs_review",
          origin: "resume_import",
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      counts.achievements++;
    }

    const seenSkillKeys = new Set<string>();
    for (const item of extracted.skills) {
      const normalizedKey = normalizeSkillKey(item.canonicalName);
      if (!normalizedKey || seenSkillKeys.has(normalizedKey)) {
        continue;
      }
      seenSkillKeys.add(normalizedKey);

      const existing = tx
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.normalizedKey, normalizedKey))
        .get();

      let targetSkillId: string;
      if (existing) {
        targetSkillId = existing.id;
      } else {
        targetSkillId = crypto.randomUUID();
        tx.insert(skills)
          .values({
            id: targetSkillId,
            canonicalName: item.canonicalName,
            normalizedKey,
            aliasesJson: "[]",
            category: item.category ?? null,
            proficiency: item.proficiency ?? null,
            verificationStatus: "needs_review",
            origin: "resume_import",
            verifiedAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .run();
        counts.skills++;
      }

      tx.insert(evidenceLinks)
        .values({
          id: crypto.randomUUID(),
          sourceDocumentId: docId,
          excerpt: item.sourceExcerpt,
          targetType: "skill",
          targetId: targetSkillId,
          extractionConfidence: clampConfidence(item.confidence),
          verificationStatus: "needs_review",
          origin: "resume_import",
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
    }

    for (let i = 0; i < extracted.education.length; i++) {
      const item = extracted.education[i];
      const id = crypto.randomUUID();
      tx.insert(education)
        .values({
          id,
          institution: item.institution,
          qualification: item.qualification,
          fieldOfStudy: item.fieldOfStudy ?? null,
          startDate: item.startDate ?? null,
          endDate: item.endDate ?? null,
          details: item.details ?? null,
          sortOrder: i,
          verificationStatus: "needs_review",
          origin: "resume_import",
          verifiedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();

      tx.insert(evidenceLinks)
        .values({
          id: crypto.randomUUID(),
          sourceDocumentId: docId,
          excerpt: item.sourceExcerpt,
          targetType: "education",
          targetId: id,
          extractionConfidence: clampConfidence(item.confidence),
          verificationStatus: "needs_review",
          origin: "resume_import",
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      counts.education++;
    }

    for (let i = 0; i < extracted.certifications.length; i++) {
      const item = extracted.certifications[i];
      const id = crypto.randomUUID();
      tx.insert(certifications)
        .values({
          id,
          name: item.name,
          issuer: item.issuer ?? null,
          issueDate: item.issueDate ?? null,
          expiryDate: item.expiryDate ?? null,
          credentialUrl: item.credentialUrl ?? null,
          sortOrder: i,
          verificationStatus: "needs_review",
          origin: "resume_import",
          verifiedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();

      tx.insert(evidenceLinks)
        .values({
          id: crypto.randomUUID(),
          sourceDocumentId: docId,
          excerpt: item.sourceExcerpt,
          targetType: "certification",
          targetId: id,
          extractionConfidence: clampConfidence(item.confidence),
          verificationStatus: "needs_review",
          origin: "resume_import",
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      counts.certifications++;
    }

    for (let i = 0; i < extracted.languages.length; i++) {
      const item = extracted.languages[i];
      const id = crypto.randomUUID();
      tx.insert(languages)
        .values({
          id,
          language: item.language,
          proficiency: item.proficiency ?? null,
          sortOrder: i,
          verificationStatus: "needs_review",
          origin: "resume_import",
          verifiedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();

      tx.insert(evidenceLinks)
        .values({
          id: crypto.randomUUID(),
          sourceDocumentId: docId,
          excerpt: item.sourceExcerpt,
          targetType: "language",
          targetId: id,
          extractionConfidence: clampConfidence(item.confidence),
          verificationStatus: "needs_review",
          origin: "resume_import",
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
      counts.languages++;
    }
  });

  const hasProfileSuggestions =
    Boolean(extracted.headline) ||
    Boolean(extracted.summary) ||
    Boolean(extracted.location);

  const profileSuggestions: ProfileSuggestions | null = hasProfileSuggestions
    ? {
        headline: extracted.headline ?? null,
        summary: extracted.summary ?? null,
        location: extracted.location ?? null,
      }
    : null;

  return { createdCounts: counts, profileSuggestions };
}

/**
 * Validates, stores, and extracts text from an uploaded resume/document,
 * optionally structuring facts via the configured AI provider with every
 * generated record starting at `verification_status = "needs_review"`.
 */
export async function importResumeDocument(
  input: ImportResumeInput,
  deps: ImportResumeDeps = {}
): Promise<ImportResumeResult> {
  const displayFilename = sanitizeDisplayFilename(input.fileName);
  const validated = validateResumeUpload(input.buffer, {
    fileName: displayFilename,
    mimeType: input.mimeType,
  });

  const db = deps.db ?? getDb();
  const paths = deps.paths ?? ensureAppDirectories(deps.appDataDir);
  const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
  const docId = crypto.randomUUID();
  const fileHash = crypto.createHash("sha256").update(input.buffer).digest("hex");

  const originalFilePath = assertPathWithin(
    paths.originals,
    `${docId}.${validated.extension}`
  );
  writeSecureFile(originalFilePath, input.buffer);

  const extractFn = deps.extractText ?? extractDocumentText;
  let extraction: Awaited<ReturnType<typeof extractDocumentText>>;

  try {
    extraction = await extractFn(input.buffer, validated.kind);
  } catch (err) {
    const errorMessage =
      err instanceof DocumentExtractionError
        ? err.message
        : "Document text extraction failed.";

    const sourceDocument = persistSourceDocumentRow(db, {
      id: docId,
      displayFilename,
      originalFilePath,
      mimeType: validated.mimeType,
      fileSizeBytes: input.buffer.byteLength,
      fileHash,
      extractedTextPath: null,
      extractionStatus: "failed",
      parserVersion: null,
      errorMessage,
      importedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return {
      status: "failed",
      sourceDocument,
      extractedText: "",
      extractionStatus: "failed",
      pageCount: null,
      aiStatus: "not_applicable",
      createdCounts: createEmptyCounts(),
      profileSuggestions: null,
      aiError: null,
    };
  }

  if (extraction.status === "scanned_pdf") {
    const sourceDocument = persistSourceDocumentRow(db, {
      id: docId,
      displayFilename,
      originalFilePath,
      mimeType: validated.mimeType,
      fileSizeBytes: input.buffer.byteLength,
      fileHash,
      extractedTextPath: null,
      extractionStatus: "scanned_pdf",
      parserVersion: extraction.parserVersion,
      errorMessage: SCANNED_PDF_MESSAGE,
      importedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    return {
      status: "scanned_pdf",
      sourceDocument,
      extractedText: "",
      extractionStatus: "scanned_pdf",
      pageCount: extraction.pageCount,
      aiStatus: "not_applicable",
      createdCounts: createEmptyCounts(),
      profileSuggestions: null,
      aiError: null,
    };
  }

  const extractedTextPath = assertPathWithin(paths.generated, `${docId}.txt`);
  writeSecureFile(extractedTextPath, extraction.text);

  const sourceDocument = persistSourceDocumentRow(db, {
    id: docId,
    displayFilename,
    originalFilePath,
    mimeType: validated.mimeType,
    fileSizeBytes: input.buffer.byteLength,
    fileHash,
    extractedTextPath,
    extractionStatus: "extracted",
    parserVersion: extraction.parserVersion,
    errorMessage: null,
    importedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const aiConfig = getSettings(db).ai;
  const canUseAi =
    input.useAi === true &&
    aiConfig.provider !== "none" &&
    aiConfig.dataSharingAccepted === true &&
    extraction.text.trim().length > 0;

  if (!canUseAi) {
    return {
      status: "extracted",
      sourceDocument,
      extractedText: extraction.text,
      extractionStatus: "extracted",
      pageCount: extraction.pageCount,
      aiStatus: "raw_text_only",
      createdCounts: createEmptyCounts(),
      profileSuggestions: null,
      aiError: null,
    };
  }

  const generateFn = deps.generateStructured ?? generateStructuredWithTracking;

  try {
    const aiResult = await generateFn({
      task: "profile.resume_import",
      systemPrompt: RESUME_IMPORT_SYSTEM_PROMPT,
      userPayload: {
        fileName: displayFilename,
        resumeText: extraction.text,
      },
      schema: ResumeImportExtractionSchema,
      promptVersion: RESUME_IMPORT_PROMPT_VERSION,
      schemaVersion: RESUME_IMPORT_SCHEMA_VERSION,
      db,
    });

    const { createdCounts, profileSuggestions } = persistExtractedFacts(
      db,
      docId,
      aiResult.data,
      nowIso
    );

    return {
      status: "extracted",
      sourceDocument,
      extractedText: extraction.text,
      extractionStatus: "extracted",
      pageCount: extraction.pageCount,
      aiStatus: "extracted",
      createdCounts,
      profileSuggestions,
      aiError: null,
    };
  } catch (err) {
    const errorCode =
      err instanceof AiProviderError ? err.code : "RESUME_IMPORT_AI_FAILED";
    logger.warn(
      "profile.import.ai_failed",
      "Optional AI structuring failed; raw extracted text was preserved.",
      {
        errorCode,
        meta: { sourceDocumentId: docId },
      }
    );

    return {
      status: "extracted",
      sourceDocument,
      extractedText: extraction.text,
      extractionStatus: "extracted",
      pageCount: extraction.pageCount,
      aiStatus: "failed_raw_preserved",
      createdCounts: createEmptyCounts(),
      profileSuggestions: null,
      aiError: sanitizeAiError(err),
    };
  }
}
