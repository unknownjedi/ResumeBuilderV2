import fs from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { ensureAppDirectories } from "../files/paths";
import * as schema from "./schema/index";

export type SqliteDatabase = InstanceType<typeof BetterSqlite3>;
export type AppDatabase = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  jobCopilotDb?: SqliteDatabase;
  jobCopilotDrizzle?: AppDatabase;
};

let productionSqlite: SqliteDatabase | undefined;
let productionDrizzle: AppDatabase | undefined;

const SCHEMA_DDL = `
-- 14.1 Career data
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  location TEXT,
  headline TEXT,
  summary TEXT,
  website_url TEXT,
  linkedin_url TEXT,
  github_url TEXT,
  notice_period TEXT,
  work_authorization_summary TEXT,
  additional_details_json TEXT,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiences (
  id TEXT PRIMARY KEY,
  employer TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  employment_type TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  experience_id TEXT REFERENCES experiences(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  problem TEXT,
  description TEXT,
  role_contribution TEXT,
  architecture TEXT,
  challenges_solved TEXT,
  outcomes TEXT,
  metrics_json TEXT,
  start_date TEXT,
  end_date TEXT,
  url TEXT,
  target_roles_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  experience_id TEXT REFERENCES experiences(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  metric_value REAL,
  metric_unit TEXT,
  metric_context TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  proficiency TEXT,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experience_skills (
  experience_id TEXT NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (experience_id, skill_id)
);

CREATE TABLE IF NOT EXISTS project_skills (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, skill_id)
);

CREATE TABLE IF NOT EXISTS achievement_skills (
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (achievement_id, skill_id)
);

CREATE TABLE IF NOT EXISTS education (
  id TEXT PRIMARY KEY,
  institution TEXT NOT NULL,
  qualification TEXT NOT NULL,
  field_of_study TEXT,
  start_date TEXT,
  end_date TEXT,
  details TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS certifications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issuer TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  credential_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS languages (
  id TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  proficiency TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  display_filename TEXT NOT NULL,
  original_file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  extracted_text_path TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  parser_version TEXT,
  error_message TEXT,
  imported_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_links (
  id TEXT PRIMARY KEY,
  source_document_id TEXT REFERENCES source_documents(id) ON DELETE SET NULL,
  excerpt TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  extraction_confidence REAL,
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  origin TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 14.2 Search and job data
CREATE TABLE IF NOT EXISTS search_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_titles_json TEXT NOT NULL DEFAULT '[]',
  target_seniority_json TEXT NOT NULL DEFAULT '[]',
  min_years_experience INTEGER,
  max_years_experience INTEGER,
  locations_json TEXT NOT NULL DEFAULT '[]',
  remote_eligible_countries_json TEXT NOT NULL DEFAULT '[]',
  workplace_types_json TEXT NOT NULL DEFAULT '[]',
  employment_types_json TEXT NOT NULL DEFAULT '[]',
  relocation_allowed INTEGER,
  max_job_age_days INTEGER,
  hard_filters_json TEXT NOT NULL DEFAULT '{}',
  ranking_weights_json TEXT NOT NULL DEFAULT '{}',
  resume_preferences_json TEXT NOT NULL DEFAULT '{}',
  fail_closed_on_unknown INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_profile_skills (
  id TEXT PRIMARY KEY,
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
  normalized_skill_key TEXT NOT NULL,
  display_label TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  preference TEXT NOT NULL,
  filter_mode TEXT NOT NULL,
  weight REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  website TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  industry_tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  source_identifier TEXT,
  base_url TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  refresh_interval_minutes INTEGER NOT NULL DEFAULT 360,
  health_state TEXT NOT NULL DEFAULT 'untested',
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_successful_full_scan_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_detail TEXT,
  last_etag TEXT,
  last_modified TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  task_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  closed_count INTEGER NOT NULL DEFAULT 0,
  is_complete_snapshot INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'running',
  error_code TEXT,
  error_detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  primary_source_id TEXT REFERENCES job_sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description_text TEXT NOT NULL,
  description_html_sanitized TEXT,
  description_hash TEXT NOT NULL,
  location_text TEXT,
  country_code TEXT,
  workplace_type TEXT NOT NULL DEFAULT 'unspecified',
  employment_type TEXT,
  seniority_level TEXT,
  seniority_min_years REAL,
  seniority_max_years REAL,
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT,
  salary_period TEXT,
  salary_source_type TEXT,
  employer_posted_at TEXT,
  date_conflict_json TEXT,
  source_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  canonical_url TEXT,
  apply_url TEXT,
  merged_into_job_id TEXT,
  merged_at TEXT,
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  analysis_version TEXT,
  analyzed_description_hash TEXT,
  analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_source_records (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  source_url TEXT,
  apply_url TEXT,
  raw_json TEXT NOT NULL,
  source_posted_at_text TEXT,
  source_posted_at TEXT,
  source_updated_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missing_run_count INTEGER NOT NULL DEFAULT 0,
  record_status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_requirements (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  requirement_key TEXT NOT NULL,
  requirement_text TEXT NOT NULL,
  normalized_skill TEXT,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'unspecified',
  machine_support_state TEXT NOT NULL DEFAULT 'not_found_in_profile',
  candidate_response TEXT NOT NULL DEFAULT 'not_reviewed',
  extraction_confidence REAL,
  analysis_source TEXT NOT NULL DEFAULT 'deterministic',
  analysis_version TEXT NOT NULL,
  stable_signature TEXT NOT NULL,
  user_priority_override TEXT,
  override_state TEXT NOT NULL DEFAULT 'active',
  override_updated_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_compensation_overrides (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  min_amount REAL,
  max_amount REAL,
  currency TEXT,
  period TEXT,
  provenance TEXT NOT NULL DEFAULT 'user_supplied',
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_duplicate_candidates (
  id TEXT PRIMARY KEY,
  job_a_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_b_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  match_method TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  similarity_score REAL NOT NULL,
  state TEXT NOT NULL DEFAULT 'proposed',
  job_a_description_hash TEXT,
  job_b_description_hash TEXT,
  created_at TEXT NOT NULL,
  dismissed_at TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS match_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
  documented_fit_score REAL,
  search_skill_alignment_score REAL,
  priority_score REAL,
  hard_filter_passed INTEGER NOT NULL DEFAULT 1,
  hard_filter_status TEXT NOT NULL DEFAULT 'eligible',
  included_factors_json TEXT NOT NULL DEFAULT '{}',
  inputs_snapshot_json TEXT NOT NULL DEFAULT '{}',
  weight_version TEXT NOT NULL,
  calculation_version TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_evidence (
  id TEXT PRIMARY KEY,
  match_run_id TEXT NOT NULL REFERENCES match_runs(id) ON DELETE CASCADE,
  job_requirement_id TEXT NOT NULL REFERENCES job_requirements(id) ON DELETE CASCADE,
  support_state TEXT NOT NULL,
  linked_fact_type TEXT,
  linked_fact_id TEXT,
  evidence_link_id TEXT REFERENCES evidence_links(id) ON DELETE SET NULL,
  explanation TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_job_states (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
  discovery_state TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 14.3 Application and document data
CREATE TABLE IF NOT EXISTS resume_drafts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
  career_profile_snapshot_json TEXT NOT NULL,
  career_profile_hash TEXT NOT NULL,
  job_snapshot_json TEXT NOT NULL,
  job_description_hash TEXT NOT NULL,
  structured_content_json TEXT NOT NULL,
  template_settings_json TEXT NOT NULL DEFAULT '{}',
  model_provider TEXT,
  model_name TEXT,
  prompt_version TEXT,
  state TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resume_claims (
  id TEXT PRIMARY KEY,
  resume_draft_id TEXT NOT NULL REFERENCES resume_drafts(id) ON DELETE CASCADE,
  stable_claim_id TEXT NOT NULL,
  stable_entry_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  section_type TEXT NOT NULL,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  user_edited_state TEXT NOT NULL DEFAULT 'generated',
  verification_status TEXT NOT NULL DEFAULT 'needs_review',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resume_claim_evidence (
  id TEXT PRIMARY KEY,
  resume_claim_id TEXT NOT NULL REFERENCES resume_claims(id) ON DELETE CASCADE,
  evidence_link_id TEXT REFERENCES evidence_links(id) ON DELETE SET NULL,
  fact_type TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  excerpt TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resume_versions (
  id TEXT PRIMARY KEY,
  resume_draft_id TEXT NOT NULL REFERENCES resume_drafts(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE RESTRICT,
  job_description_snapshot_json TEXT NOT NULL,
  job_description_hash TEXT NOT NULL,
  career_profile_snapshot_json TEXT NOT NULL,
  career_profile_hash TEXT NOT NULL,
  structured_content_json TEXT NOT NULL,
  claim_evidence_snapshot_json TEXT NOT NULL,
  template_settings_json TEXT NOT NULL DEFAULT '{}',
  model_provider TEXT,
  model_name TEXT,
  prompt_version TEXT,
  user_edited_state TEXT NOT NULL DEFAULT 'generated',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_exports (
  id TEXT PRIMARY KEY,
  resume_version_id TEXT REFERENCES resume_versions(id) ON DELETE RESTRICT,
  cover_letter_id TEXT,
  document_type TEXT NOT NULL DEFAULT 'resume',
  format TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  exported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'preparing',
  applied_at TEXT,
  resume_version_id TEXT REFERENCES resume_versions(id) ON DELETE RESTRICT,
  original_apply_url TEXT,
  submitted_materials_snapshot_json TEXT,
  submitted_materials_hash TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  prior_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cover_letters (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  structured_content_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  model_provider TEXT,
  model_name TEXT,
  prompt_version TEXT,
  user_edited_state TEXT NOT NULL DEFAULT 'generated',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application_answers (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  search_profile_id TEXT NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  prompt_key TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  model_provider TEXT,
  model_name TEXT,
  prompt_version TEXT,
  user_edited_state TEXT NOT NULL DEFAULT 'generated',
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 14.4 System data
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS background_tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  run_after TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  cancel_requested_at TEXT,
  progress_stage TEXT,
  progress_percent INTEGER,
  resource_type TEXT,
  resource_id TEXT,
  result_summary_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES background_tasks(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_stage TEXT,
  progress_percent INTEGER,
  resource_type TEXT,
  resource_id TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES background_tasks(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd REAL,
  validation_outcome TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_tokens (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gmail_sync_state (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL DEFAULT '',
  label TEXT,
  history_id TEXT,
  last_sync_at TEXT,
  connection_state TEXT NOT NULL DEFAULT 'disconnected',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_maintenance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL DEFAULT 'normal',
  request_id TEXT,
  request_type TEXT,
  requested_at TEXT,
  worker_ack_at TEXT,
  worker_heartbeat_at TEXT,
  journal_json TEXT,
  updated_at TEXT NOT NULL
);

-- Indexes & Uniqueness Constraints
CREATE INDEX IF NOT EXISTS experiences_verification_idx ON experiences (verification_status);
CREATE INDEX IF NOT EXISTS projects_experience_idx ON projects (experience_id);
CREATE INDEX IF NOT EXISTS projects_verification_idx ON projects (verification_status);
CREATE INDEX IF NOT EXISTS achievements_experience_idx ON achievements (experience_id);
CREATE INDEX IF NOT EXISTS achievements_project_idx ON achievements (project_id);
CREATE INDEX IF NOT EXISTS achievements_verification_idx ON achievements (verification_status);
CREATE UNIQUE INDEX IF NOT EXISTS skills_normalized_key_uidx ON skills (normalized_key);
CREATE INDEX IF NOT EXISTS skills_verification_idx ON skills (verification_status);
CREATE INDEX IF NOT EXISTS evidence_links_target_idx ON evidence_links (target_type, target_id);
CREATE INDEX IF NOT EXISTS evidence_links_source_doc_idx ON evidence_links (source_document_id);

CREATE UNIQUE INDEX IF NOT EXISTS search_profile_skills_profile_key_uidx ON search_profile_skills (search_profile_id, normalized_skill_key);
CREATE INDEX IF NOT EXISTS companies_normalized_name_idx ON companies (normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS job_sources_type_identifier_uidx ON job_sources (source_type, source_identifier) WHERE source_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_sources_enabled_idx ON job_sources (enabled);
CREATE INDEX IF NOT EXISTS source_runs_source_started_idx ON source_runs (source_id, started_at);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_employer_posted_at_idx ON jobs (employer_posted_at);
CREATE INDEX IF NOT EXISTS jobs_first_seen_at_idx ON jobs (first_seen_at);
CREATE INDEX IF NOT EXISTS jobs_primary_source_id_idx ON jobs (primary_source_id);
CREATE INDEX IF NOT EXISTS jobs_company_id_idx ON jobs (company_id);
CREATE INDEX IF NOT EXISTS jobs_merged_into_idx ON jobs (merged_into_job_id);

CREATE UNIQUE INDEX IF NOT EXISTS job_source_records_source_external_uidx ON job_source_records (source_id, external_id);
CREATE INDEX IF NOT EXISTS job_source_records_job_id_idx ON job_source_records (job_id);
CREATE INDEX IF NOT EXISTS job_requirements_job_id_idx ON job_requirements (job_id);
CREATE INDEX IF NOT EXISTS job_requirements_signature_idx ON job_requirements (job_id, stable_signature);
CREATE UNIQUE INDEX IF NOT EXISTS job_compensation_overrides_job_uidx ON job_compensation_overrides (job_id);
CREATE UNIQUE INDEX IF NOT EXISTS job_duplicate_candidates_pair_uidx ON job_duplicate_candidates (job_a_id, job_b_id);
CREATE INDEX IF NOT EXISTS job_duplicate_candidates_state_idx ON job_duplicate_candidates (state);
CREATE INDEX IF NOT EXISTS match_runs_job_profile_idx ON match_runs (job_id, search_profile_id);
CREATE INDEX IF NOT EXISTS match_runs_profile_priority_idx ON match_runs (search_profile_id, priority_score);
CREATE INDEX IF NOT EXISTS match_evidence_run_idx ON match_evidence (match_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_job_states_job_profile_uidx ON user_job_states (job_id, search_profile_id);
CREATE INDEX IF NOT EXISTS user_job_states_profile_state_idx ON user_job_states (search_profile_id, discovery_state);

CREATE INDEX IF NOT EXISTS resume_drafts_job_profile_idx ON resume_drafts (job_id, search_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS resume_claims_draft_claim_uidx ON resume_claims (resume_draft_id, stable_claim_id);
CREATE INDEX IF NOT EXISTS resume_claims_draft_entry_idx ON resume_claims (resume_draft_id, stable_entry_id);
CREATE INDEX IF NOT EXISTS resume_claim_evidence_claim_idx ON resume_claim_evidence (resume_claim_id);
CREATE UNIQUE INDEX IF NOT EXISTS resume_versions_draft_version_uidx ON resume_versions (resume_draft_id, version_number);
CREATE INDEX IF NOT EXISTS resume_versions_job_idx ON resume_versions (job_id);
CREATE INDEX IF NOT EXISTS document_exports_version_idx ON document_exports (resume_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS applications_job_profile_uidx ON applications (job_id, search_profile_id);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status);
CREATE INDEX IF NOT EXISTS application_events_app_idx ON application_events (application_id);
CREATE INDEX IF NOT EXISTS cover_letters_job_profile_idx ON cover_letters (job_id, search_profile_id);
CREATE INDEX IF NOT EXISTS application_answers_job_profile_idx ON application_answers (job_id, search_profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS background_tasks_active_idempotency_uidx ON background_tasks (task_type, idempotency_key) WHERE idempotency_key IS NOT NULL AND status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS background_tasks_claim_idx ON background_tasks (status, run_after, priority);
CREATE INDEX IF NOT EXISTS task_events_task_id_idx ON task_events (task_id);
CREATE INDEX IF NOT EXISTS task_events_occurred_at_idx ON task_events (occurred_at);
CREATE INDEX IF NOT EXISTS ai_runs_task_id_idx ON ai_runs (task_id);
CREATE INDEX IF NOT EXISTS ai_runs_created_at_idx ON ai_runs (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS integration_tokens_provider_uidx ON integration_tokens (provider);

-- FTS5 virtual table and sync triggers for jobs
CREATE VIRTUAL TABLE IF NOT EXISTS job_fts USING fts5(
  id UNINDEXED,
  title,
  company_name,
  location_text,
  description_text,
  content='jobs',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS jobs_fts_ai AFTER INSERT ON jobs BEGIN
  INSERT INTO job_fts(rowid, id, title, company_name, location_text, description_text)
  VALUES (new.rowid, new.id, new.title, new.company_name, COALESCE(new.location_text, ''), new.description_text);
END;

CREATE TRIGGER IF NOT EXISTS jobs_fts_ad AFTER DELETE ON jobs BEGIN
  INSERT INTO job_fts(job_fts, rowid, id, title, company_name, location_text, description_text)
  VALUES ('delete', old.rowid, old.id, old.title, old.company_name, COALESCE(old.location_text, ''), old.description_text);
END;

CREATE TRIGGER IF NOT EXISTS jobs_fts_au AFTER UPDATE ON jobs BEGIN
  INSERT INTO job_fts(job_fts, rowid, id, title, company_name, location_text, description_text)
  VALUES ('delete', old.rowid, old.id, old.title, old.company_name, COALESCE(old.location_text, ''), old.description_text);
  INSERT INTO job_fts(rowid, id, title, company_name, location_text, description_text)
  VALUES (new.rowid, new.id, new.title, new.company_name, COALESCE(new.location_text, ''), new.description_text);
END;
`;

function applyConnectionPragmas(sqlite: SqliteDatabase, isMemory: boolean): void {
  sqlite.pragma("foreign_keys = ON");
  if (!isMemory) {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("busy_timeout = 5000");
}

/**
 * Idempotently creates all tables, unique/query indexes, FTS5 table + triggers,
 * and the default system_maintenance singleton row.
 */
export function ensureDatabaseInitialized(sqlite: SqliteDatabase): void {
  sqlite.exec(SCHEMA_DDL);
  const nowIso = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO system_maintenance (id, state, updated_at) VALUES (1, 'normal', ?)`
    )
    .run(nowIso);
}

/**
 * Opens a configured SQLite connection with required PRAGMAs and initialized schema.
 */
export function createSqliteConnection(dbPath?: string): SqliteDatabase {
  let targetPath = dbPath;
  if (!targetPath) {
    const paths = ensureAppDirectories();
    targetPath = paths.databaseFile;
  }

  const isMemory = targetPath === ":memory:";
  if (!isMemory) {
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), {
      recursive: true,
      ...(process.platform !== "win32" ? { mode: 0o700 } : {}),
    });
    targetPath = resolved;
  }

  const sqlite = new BetterSqlite3(targetPath);
  applyConnectionPragmas(sqlite, isMemory);
  ensureDatabaseInitialized(sqlite);

  if (!isMemory && process.platform !== "win32" && fs.existsSync(targetPath)) {
    fs.chmodSync(targetPath, 0o600);
  }

  return sqlite;
}

/**
 * Returns the process-appropriate SQLite singleton (globalThis cached in development).
 */
export function getSqlite(): SqliteDatabase {
  if (process.env.NODE_ENV === "development") {
    return (globalForDb.jobCopilotDb ??= createSqliteConnection());
  }
  if (!productionSqlite) {
    productionSqlite = createSqliteConnection();
  }
  return productionSqlite;
}

/**
 * Returns the Drizzle ORM instance bound to the process SQLite singleton.
 */
export function getDb(): AppDatabase {
  const sqlite = getSqlite();
  if (process.env.NODE_ENV === "development") {
    return (globalForDb.jobCopilotDrizzle ??= drizzle(sqlite, { schema }));
  }
  if (!productionDrizzle) {
    productionDrizzle = drizzle(sqlite, { schema });
  }
  return productionDrizzle;
}

/**
 * Closes the cached SQLite connection if open.
 */
export function closeDatabase(): void {
  if (globalForDb.jobCopilotDb) {
    if (globalForDb.jobCopilotDb.open) {
      globalForDb.jobCopilotDb.close();
    }
    globalForDb.jobCopilotDb = undefined;
    globalForDb.jobCopilotDrizzle = undefined;
  }
  if (productionSqlite) {
    if (productionSqlite.open) {
      productionSqlite.close();
    }
    productionSqlite = undefined;
    productionDrizzle = undefined;
  }
}

/**
 * Creates an isolated SQLite + Drizzle database instance for unit and integration tests.
 */
export function createTestDatabase(options?: { filePath?: string }): {
  sqlite: SqliteDatabase;
  db: AppDatabase;
  cleanup: () => void;
} {
  const sqlite = createSqliteConnection(options?.filePath ?? ":memory:");
  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    db,
    cleanup: () => {
      if (sqlite.open) {
        sqlite.close();
      }
    },
  };
}
