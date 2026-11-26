import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { EVIDENCE_TARGET_TYPES, evidenceLinks, VERIFICATION_STATUSES } from "./career";
import { jobs, searchProfiles } from "./jobs";

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

export const RESUME_DRAFT_STATES = [
  "draft",
  "reviewed",
  "exported",
  "archived",
] as const;
export type ResumeDraftState = (typeof RESUME_DRAFT_STATES)[number];

export const USER_EDITED_STATES = [
  "generated",
  "user_edited",
  "user_verified",
] as const;
export type UserEditedState = (typeof USER_EDITED_STATES)[number];

export const EXPORT_FORMATS = ["docx", "pdf", "txt", "md"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const DOCUMENT_EXPORT_TYPES = [
  "resume",
  "cover_letter",
  "application_answers",
] as const;
export type DocumentExportType = (typeof DOCUMENT_EXPORT_TYPES)[number];

export const resumeDrafts = sqliteTable(
  "resume_drafts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    searchProfileId: text("search_profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "cascade" }),
    careerProfileSnapshotJson: text("career_profile_snapshot_json").notNull(),
    careerProfileHash: text("career_profile_hash").notNull(),
    jobSnapshotJson: text("job_snapshot_json").notNull(),
    jobDescriptionHash: text("job_description_hash").notNull(),
    structuredContentJson: text("structured_content_json").notNull(),
    templateSettingsJson: text("template_settings_json").notNull().default("{}"),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    promptVersion: text("prompt_version"),
    state: text("state", { enum: RESUME_DRAFT_STATES })
      .notNull()
      .default("draft"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("resume_drafts_job_profile_idx").on(t.jobId, t.searchProfileId),
  ]
);

export const resumeClaims = sqliteTable(
  "resume_claims",
  {
    id: text("id").primaryKey(),
    resumeDraftId: text("resume_draft_id")
      .notNull()
      .references(() => resumeDrafts.id, { onDelete: "cascade" }),
    stableClaimId: text("stable_claim_id").notNull(),
    stableEntryId: text("stable_entry_id").notNull(),
    sectionId: text("section_id").notNull(),
    sectionType: text("section_type").notNull(),
    text: text("text").notNull(),
    sortOrder: integer("sort_order").notNull(),
    userEditedState: text("user_edited_state", { enum: USER_EDITED_STATES })
      .notNull()
      .default("generated"),
    verificationStatus: text("verification_status", {
      enum: VERIFICATION_STATUSES,
    })
      .notNull()
      .default("needs_review"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("resume_claims_draft_claim_uidx").on(
      t.resumeDraftId,
      t.stableClaimId
    ),
    index("resume_claims_draft_entry_idx").on(
      t.resumeDraftId,
      t.stableEntryId
    ),
  ]
);

export const resumeClaimEvidence = sqliteTable(
  "resume_claim_evidence",
  {
    id: text("id").primaryKey(),
    resumeClaimId: text("resume_claim_id")
      .notNull()
      .references(() => resumeClaims.id, { onDelete: "cascade" }),
    evidenceLinkId: text("evidence_link_id").references(() => evidenceLinks.id, {
      onDelete: "set null",
    }),
    factType: text("fact_type", { enum: EVIDENCE_TARGET_TYPES }).notNull(),
    factId: text("fact_id").notNull(),
    excerpt: text("excerpt"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("resume_claim_evidence_claim_idx").on(t.resumeClaimId)]
);

export const resumeVersions = sqliteTable(
  "resume_versions",
  {
    id: text("id").primaryKey(),
    resumeDraftId: text("resume_draft_id")
      .notNull()
      .references(() => resumeDrafts.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    searchProfileId: text("search_profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "restrict" }),
    jobDescriptionSnapshotJson: text("job_description_snapshot_json").notNull(),
    jobDescriptionHash: text("job_description_hash").notNull(),
    careerProfileSnapshotJson: text("career_profile_snapshot_json").notNull(),
    careerProfileHash: text("career_profile_hash").notNull(),
    structuredContentJson: text("structured_content_json").notNull(),
    claimEvidenceSnapshotJson: text("claim_evidence_snapshot_json").notNull(),
    templateSettingsJson: text("template_settings_json").notNull().default("{}"),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    promptVersion: text("prompt_version"),
    userEditedState: text("user_edited_state", { enum: USER_EDITED_STATES })
      .notNull()
      .default("generated"),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("resume_versions_draft_version_uidx").on(
      t.resumeDraftId,
      t.versionNumber
    ),
    index("resume_versions_job_idx").on(t.jobId),
  ]
);

export const documentExports = sqliteTable(
  "document_exports",
  {
    id: text("id").primaryKey(),
    resumeVersionId: text("resume_version_id").references(
      () => resumeVersions.id,
      { onDelete: "restrict" }
    ),
    coverLetterId: text("cover_letter_id"),
    documentType: text("document_type", { enum: DOCUMENT_EXPORT_TYPES })
      .notNull()
      .default("resume"),
    format: text("format", { enum: EXPORT_FORMATS }).notNull(),
    filePath: text("file_path").notNull(),
    fileHash: text("file_hash").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    exportedAt: text("exported_at").notNull(),
  },
  (t) => [index("document_exports_version_idx").on(t.resumeVersionId)]
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    searchProfileId: text("search_profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "restrict" }),
    status: text("status", { enum: APPLICATION_STATUSES })
      .notNull()
      .default("preparing"),
    appliedAt: text("applied_at"),
    resumeVersionId: text("resume_version_id").references(
      () => resumeVersions.id,
      { onDelete: "restrict" }
    ),
    originalApplyUrl: text("original_apply_url"),
    submittedMaterialsSnapshotJson: text("submitted_materials_snapshot_json"),
    submittedMaterialsHash: text("submitted_materials_hash"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("applications_job_profile_uidx").on(
      t.jobId,
      t.searchProfileId
    ),
    index("applications_status_idx").on(t.status),
  ]
);

export const applicationEvents = sqliteTable(
  "application_events",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    priorStatus: text("prior_status", { enum: APPLICATION_STATUSES }),
    newStatus: text("new_status", { enum: APPLICATION_STATUSES }).notNull(),
    note: text("note"),
    occurredAt: text("occurred_at").notNull(),
  },
  (t) => [index("application_events_app_idx").on(t.applicationId)]
);

export const coverLetters = sqliteTable(
  "cover_letters",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    searchProfileId: text("search_profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "cascade" }),
    applicationId: text("application_id").references(() => applications.id, {
      onDelete: "set null",
    }),
    structuredContentJson: text("structured_content_json").notNull(),
    evidenceRefsJson: text("evidence_refs_json").notNull().default("[]"),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    promptVersion: text("prompt_version"),
    userEditedState: text("user_edited_state", { enum: USER_EDITED_STATES })
      .notNull()
      .default("generated"),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("cover_letters_job_profile_idx").on(t.jobId, t.searchProfileId),
  ]
);

export const applicationAnswers = sqliteTable(
  "application_answers",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    searchProfileId: text("search_profile_id")
      .notNull()
      .references(() => searchProfiles.id, { onDelete: "cascade" }),
    applicationId: text("application_id").references(() => applications.id, {
      onDelete: "set null",
    }),
    promptKey: text("prompt_key").notNull(),
    promptText: text("prompt_text").notNull(),
    answerText: text("answer_text").notNull(),
    evidenceRefsJson: text("evidence_refs_json").notNull().default("[]"),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    promptVersion: text("prompt_version"),
    userEditedState: text("user_edited_state", { enum: USER_EDITED_STATES })
      .notNull()
      .default("generated"),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("application_answers_job_profile_idx").on(
      t.jobId,
      t.searchProfileId
    ),
  ]
);
