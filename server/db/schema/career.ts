import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const VERIFICATION_STATUSES = [
  "needs_review",
  "verified",
  "rejected",
  "archived",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const FACT_ORIGINS = ["manual", "resume_import", "document_import"] as const;
export type FactOrigin = (typeof FACT_ORIGINS)[number];

export const EXTRACTION_STATUSES = [
  "pending",
  "extracted",
  "failed",
  "scanned_pdf",
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const EVIDENCE_TARGET_TYPES = [
  "profile",
  "experience",
  "project",
  "achievement",
  "skill",
  "education",
  "certification",
  "language",
] as const;
export type EvidenceTargetType = (typeof EVIDENCE_TARGET_TYPES)[number];

export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey(),
  fullName: text("full_name").notNull().default(""),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  headline: text("headline"),
  summary: text("summary"),
  websiteUrl: text("website_url"),
  linkedinUrl: text("linkedin_url"),
  githubUrl: text("github_url"),
  noticePeriod: text("notice_period"),
  workAuthorizationSummary: text("work_authorization_summary"),
  additionalDetailsJson: text("additional_details_json"),
  verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
    .notNull()
    .default("needs_review"),
  origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const experiences = sqliteTable(
  "experiences",
  {
    id: text("id").primaryKey(),
    employer: text("employer").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
    employmentType: text("employment_type"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
      .notNull()
      .default("needs_review"),
    origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("experiences_verification_idx").on(t.verificationStatus)]
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    experienceId: text("experience_id").references(() => experiences.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    problem: text("problem"),
    description: text("description"),
    roleContribution: text("role_contribution"),
    architecture: text("architecture"),
    challengesSolved: text("challenges_solved"),
    outcomes: text("outcomes"),
    metricsJson: text("metrics_json"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    url: text("url"),
    targetRolesJson: text("target_roles_json"),
    sortOrder: integer("sort_order").notNull().default(0),
    verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
      .notNull()
      .default("needs_review"),
    origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("projects_experience_idx").on(t.experienceId),
    index("projects_verification_idx").on(t.verificationStatus),
  ]
);

export const achievements = sqliteTable(
  "achievements",
  {
    id: text("id").primaryKey(),
    experienceId: text("experience_id").references(() => experiences.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    text: text("text").notNull(),
    metricValue: real("metric_value"),
    metricUnit: text("metric_unit"),
    metricContext: text("metric_context"),
    sortOrder: integer("sort_order").notNull().default(0),
    verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
      .notNull()
      .default("needs_review"),
    origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("achievements_experience_idx").on(t.experienceId),
    index("achievements_project_idx").on(t.projectId),
    index("achievements_verification_idx").on(t.verificationStatus),
  ]
);

export const skills = sqliteTable(
  "skills",
  {
    id: text("id").primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    category: text("category"),
    proficiency: text("proficiency"),
    verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
      .notNull()
      .default("needs_review"),
    origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("skills_normalized_key_uidx").on(t.normalizedKey),
    index("skills_verification_idx").on(t.verificationStatus),
  ]
);

export const experienceSkills = sqliteTable(
  "experience_skills",
  {
    experienceId: text("experience_id")
      .notNull()
      .references(() => experiences.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.experienceId, t.skillId] })]
);

export const projectSkills = sqliteTable(
  "project_skills",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.skillId] })]
);

export const achievementSkills = sqliteTable(
  "achievement_skills",
  {
    achievementId: text("achievement_id")
      .notNull()
      .references(() => achievements.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.achievementId, t.skillId] })]
);

export const education = sqliteTable("education", {
  id: text("id").primaryKey(),
  institution: text("institution").notNull(),
  qualification: text("qualification").notNull(),
  fieldOfStudy: text("field_of_study"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  details: text("details"),
  sortOrder: integer("sort_order").notNull().default(0),
  verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
    .notNull()
    .default("needs_review"),
  origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const certifications = sqliteTable("certifications", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  issuer: text("issuer"),
  issueDate: text("issue_date"),
  expiryDate: text("expiry_date"),
  credentialUrl: text("credential_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
    .notNull()
    .default("needs_review"),
  origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const languages = sqliteTable("languages", {
  id: text("id").primaryKey(),
  language: text("language").notNull(),
  proficiency: text("proficiency"),
  sortOrder: integer("sort_order").notNull().default(0),
  verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
    .notNull()
    .default("needs_review"),
  origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sourceDocuments = sqliteTable("source_documents", {
  id: text("id").primaryKey(),
  displayFilename: text("display_filename").notNull(),
  originalFilePath: text("original_file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  fileHash: text("file_hash").notNull(),
  extractedTextPath: text("extracted_text_path"),
  extractionStatus: text("extraction_status", { enum: EXTRACTION_STATUSES })
    .notNull()
    .default("pending"),
  parserVersion: text("parser_version"),
  errorMessage: text("error_message"),
  importedAt: text("imported_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const evidenceLinks = sqliteTable(
  "evidence_links",
  {
    id: text("id").primaryKey(),
    sourceDocumentId: text("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "set null" }
    ),
    excerpt: text("excerpt"),
    targetType: text("target_type", { enum: EVIDENCE_TARGET_TYPES }).notNull(),
    targetId: text("target_id").notNull(),
    extractionConfidence: real("extraction_confidence"),
    verificationStatus: text("verification_status", { enum: VERIFICATION_STATUSES })
      .notNull()
      .default("needs_review"),
    origin: text("origin", { enum: FACT_ORIGINS }).notNull().default("manual"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("evidence_links_target_idx").on(t.targetType, t.targetId),
    index("evidence_links_source_doc_idx").on(t.sourceDocumentId),
  ]
);
