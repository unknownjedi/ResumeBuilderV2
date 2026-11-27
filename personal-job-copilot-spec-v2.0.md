# Personal Job Copilot — V2 Product & Technical Specification

**Status:** Finalized Specification (`v2.0` — Development Ready; implementation not yet started)  
**Baseline:** Extends the shipped `v1.4` local-first Next.js 16 + Node Worker + SQLite application cleanly via additive, backwards-compatible schema migrations.

---

## 1. Executive Summary & Goals

V2 upgrades Personal Job Copilot from a single-pass resume tailor into an **ATS-verified, multi-persona career workbench and agent-ready MCP platform** while preserving its core guarantees: **zero API-key lock-in (CLI-first AI + deterministic offline fallback)**, **zero hallucination / zero fabricated experience**, and **calm local-first privacy**.

### Core V2 Additions
1. **Dual-Layer ATS Engine & Bounded Iterative Refinement Loop** — Inspired by HackerRank's open-source `interviewstreet/hiring-agent` rubric plus deterministic ATS parser & JD keyword/requirement scoring, with a configurable score threshold (`settings.ats.threshold`), bounded iterative refinement strictly grounded in Master Resume facts, and transparent **Preference / Qualification Mismatch** callouts when a JD legitimately cannot meet the threshold.
2. **Model Context Protocol (MCP) Server** — Local `stdio` + optional loopback-authenticated Streamable HTTP MCP server exposing resume tailoring, ATS scoring, iterative refinement, cover letter generation, job discovery/analysis, and export tools to external agents (`claude`, `codex`, `opencode`, `agy`, Cursor, etc.) through the exact same factuality & security gates.
3. **Master Resume Vault + Multi-Role Personas (`AI Engineer`, `Full-Stack`, `Frontend`, etc.)** — Single canonical Master Resume holding every verified fact and truthful bullet framing variants, inherited cleanly by 1 or multiple Role Personas (`career_personas`) without duplicating career truth.
4. **Explicit Job Seniority Filtering (`SDE2`, `SDE3`, `Senior SDE` Only)** — First-class seniority taxonomy, experience-year bounds, deterministic + AI JD seniority classification, and hard/soft filtering with clear exclusion explanations.
5. **Theme-Matched Dual Update Studio (Manual Form + AI Instruction Form)** — Cohesive `#F5F4F0` / `#FBFAF7` / `#416653` split forms for structured manual editing (header, role metadata, bullets, Master Resume picker) and AI-guided refinement with **diff preview & cited Master Fact IDs** before applying.
6. **True Generated PDF Preview Before Download (Resume & Cover Letter)** — Inspect the exact Playwright Chromium-rendered PDF page-by-page inside the UI (`pdfjs-dist` canvas preview + zoom + text-extractability audit) before saving/downloading `.pdf` or `.docx`.
7. **High-Leverage Companion Capabilities** — Master Resume Bullet Variants, Keyword/Gap Highlight Overlay, One-Click Application Packet Export (`.zip`), Cover Letter Spotlight Studio, Smart Follow-Up Cadence, and Rejected-Fit Memory.

---

## 2. Architecture & Open-Source ATS Evaluation Findings

### 2.1 Synthesis of Open-Source ATS Strengths (`hiring-agent` + `Resume-Matcher` + `open-resume`)
Research across `interviewstreet/hiring-agent`, `srbhr/Resume-Matcher`, and `xitanggg/open-resume` shows why enterprise systems (Workday, Greenhouse, Lever) cannot be emulated by a single OSS repo alone—and why combining the **pros of all three** yields the closest match:

- **Pro from `interviewstreet/hiring-agent` (Engineering Quality & Impact Rubric):** Evaluates SWE depth rather than blind keyword stuffing—scoring Open Source (`0–35`), Self Projects (`0–30`), Production Experience (`0–25`), Technical Skills (`0–10`), plus bonus/deduction signals (live links/benchmarks, GitHub verification, deductions for vague or tutorial-only work). *Alone, it ignores JD-specific requirements.*
- **Pro from `srbhr/Resume-Matcher` (JD Keyword Gaps + Semantic Similarity):** Compares resume content directly against a target Job Description using lexical overlap + vector cosine similarity, pinpointing missing keywords and conceptual responsibility alignment (mirroring Workday Skills Cloud). *Alone, it misses PDF spatial parsing errors and SWE quality signals.*
- **Pro from `xitanggg/open-resume` (Workday/Greenhouse PDF Parse Integrity):** Simulates deterministic PDF coordinate/line extraction directly via `pdfjs-dist` to prove standard section headers, dates, employers, titles, and skills extract cleanly in linear order.

### 2.2 V2 Workday & Greenhouse Calibrated Hybrid ATS Engine (`server/services/ats/`)
V2 combines the exact strengths of `Resume-Matcher`, `hiring-agent`, and `open-resume` into one unified, reproducible, 100% local TypeScript scoring pipeline (zero required external Python/Qdrant/API-key dependencies):

1. **Stage 1 — Workday/Greenhouse Parse Integrity Audit (`10%` + Hard Parse Gate, `open-resume` pattern):**
   - Runs `pdfjs-dist` X/Y spatial-line extraction on the actual Playwright-rendered PDF bytes (plus `mammoth` on DOCX).
   - Verifies single-column linear reading order, parseable contact block, standard headings (`Summary`, `Experience`, `Projects`, `Skills`, `Education`), role dates/employers/titles extracted accurately, zero multi-column text interleaving, and target page count (`1–2` pages). If critical parsing breaks, flags a hard structural gate warning immediately.
2. **Stage 2 — Greenhouse Lexical BM25 & Hard-Requirement Coverage (`35%` Required + `15%` Preferred, `Resume-Matcher` lexical pattern):**
   - Evaluates exact JD `must_have` and `preferred` terms using normalized token/phrase BM25 scoring plus skill alias expansion (`k8s` ↔ `Kubernetes`, `Postgres` ↔ `PostgreSQL`, etc.)—mirroring how Greenhouse recruiter boolean search and legacy Workday filters work.
3. **Stage 3 — Workday Skills Cloud Semantic Alignment & Seniority Match (`30%`, `Resume-Matcher` semantic pattern):**
   - Computes semantic requirement-to-bullet alignment using optional locally cached offline ONNX embeddings (e.g., `@huggingface/transformers` `bge-small-en-v1.5`, cached once inside `APP_DATA_DIR/runtime/models/`, with deterministic TF-IDF/bigram + local CLI fallback if absent) paired with **Seniority Scope Fit** (`SDE2` / `SDE3` / `Senior SDE` vs JD expectations).
4. **Stage 4 — HackerRank Engineering Quality & Portfolio Rubric (`10%` Composite + Standalone `0–120` Advisory Lens, `hiring-agent` pattern):**
   - Built-in grounded rubric measuring production scale, quantified verified impact, architectural complexity, OSS/project depth, and live portfolio/GitHub evidence links—rewarding strong engineering signal while deducting unsubstantiated fluff.
   - **Optional External Bridge:** If a user locally installs `interviewstreet/hiring-agent` (Python CLI) and enables it in Settings, an optional diagnostic action runs it sandboxed on the exported PDF and displays its raw breakdown alongside Stages 1–4.

- **Strict Factuality Invariant Across All Stages:** Only claims linked to `verification_status === 'verified'` Master Resume facts (or user-confirmed manual edits backed by Master facts) earn positive skill/semantic/quality credit. Uncited claims and invisible text tricks receive zero credit and trigger an integrity warning.

---

## 3. Feature Specifications

### 3.1 Master Resume Vault & Multi-Role Personas

#### Design Philosophy
Users must maintain **one canonical source of truth** (the **Master Resume Vault**) and never manage copy-pasted duplicates of the same job or project across multiple profiles.

#### Data Model Extensions (`SQLite`)
- **Existing v1.4 Career Tables (`profile`, `experiences`, `projects`, `achievements`, `skills`, `education`, `certifications`, `languages`, `evidence_links`, `source_documents`)** remain the **Master Resume Vault**. Every fact ever added lives here with its verification state (`verified`, `needs_review`, `rejected`, `archived`) and provenance (`evidence_links`).
- **New `bullet_variants` Table:**
  - `id` (PK), `parent_type` (`experience` | `project` | `achievement`), `parent_id` (FK-equivalent checked atomically), `variant_label` (e.g., `"Default"`, `"AI / Inference Framing"`, `"Full-Stack Scale Framing"`, `"Frontend Performance Framing"`), `text` (must pass numeric/metric consistency against parent verified fact + `evidence_links`), `focus_tags_json` (`["distributed-systems", "llm-evals"]`), `verification_status`, `created_at`, `updated_at`.
  - **Factuality Rule:** Every variant inherits the parent's `evidence_links` and cannot introduce numeric metrics absent from the parent verified fact or linked source document.
- **New `career_personas` Table (Role Profiles):**
  - `id` (PK), `slug`, `name` (e.g., `"AI Engineer"`, `"Full-Stack Engineer"`, `"Frontend Engineer"`, or single `"Default Profile"`), `is_default` (boolean), `custom_headline`, `custom_summary`, `target_role_focus`, `preferred_section_order_json`, `default_template_settings_json`, `enabled` (boolean), `created_at`, `updated_at`.
  - Supports **Single-Profile Simplicity** (seeded default persona mirroring Master Profile) or **Multi-Persona Switching** via a clean Persona pill selector.
- **New `career_persona_items` Table (Persona Curation & Inheritance):**
  - `id` (PK), `persona_id` (FK `career_personas.id` `ON DELETE CASCADE`), `item_type` (`experience` | `project` | `achievement` | `skill` | `education` | `certification` | `language`), `item_id` (UUID), `included` (boolean, default `true`), `preferred_variant_id` (nullable FK `bullet_variants.id` `ON DELETE SET NULL`), `sort_order` (integer), `priority_boost` (integer `0..10`).
  - **Single-Source-of-Truth Sync:** Editing or rejecting an item in Master Resume immediately reflects across all personas; personas only store inclusion, ordering, headline/summary framing, and preferred truthful bullet variant.

---

### 3.2 Job Search Seniority Engine (`SDE2`, `SDE3`, `Senior SDE` Only)

#### Requirements
- Extend `search_profiles` with structured seniority and years-of-experience controls:
  - `persona_id` (FK `career_personas.id` `ON DELETE SET NULL`) — links a Search Profile (e.g., *"Backend / AI Roles"*) directly to its matching Role Persona (*"AI Engineer"*).
  - `allowed_seniorities_json`: Enum array from canonical levels:
    - `intern`, `entry_sde1`, `sde2`, `sde3`, `senior_sde`, `staff`, `principal`, `lead_architect`, `manager_plus`, `unspecified`
  - Default recommended preset in onboarding/UI: `["sde2", "sde3", "senior_sde"]`.
  - `seniority_hard_filter`: Boolean (when `true`, jobs explicitly classified outside `allowed_seniorities_json` are marked `hard_filter_status = 'excluded'` with human-readable explanation).
  - `treat_unspecified_seniority_as`: `"allow_soft_review" | "exclude"` (default `"allow_soft_review"` so ambiguously titled `"Software Engineer"` roles aren't silently dropped before inspection, while `Intern`/`New Grad`/`Staff`/`Principal`/`Director` ARE caught cleanly!).
  - `experience_min_years` & `experience_max_years` (e.g., `2` to `8` years), plus `experience_hard_filter` boolean.

#### Classification Logic (`analyze-job.ts` & `matching.ts`)
- Deterministic regex + normalized title taxonomy:
  - Recognizes aliases:
    - `sde2` ← `SDE 2`, `SDE-2`, `SDE II`, `Software Engineer II`, `L4`/`L5` context, `IC2`/`IC3`
    - `sde3` ← `SDE 3`, `SDE-3`, `SDE III`, `Software Engineer III`, `L5`
    - `senior_sde` ← `Senior Software Engineer`, `Sr. Software Engineer`, `Senior SDE`, `Senior Full-Stack/Frontend/AI Engineer`
    - Exclusions: `Intern`, `Co-op`, `New Grad`, `Junior`, `SDE I`, `Staff`, `Principal`, `Distinguished`, `Engineering Manager`, `VP`
  - When excluded, matching records explicit rationale in `match_runs.inputs_snapshot_json`, surfaced cleanly in **Discover**, **Job Detail**, **Overview**, and the **ATS Engine mismatch report**.

---

### 3.3 ATS Engine, Configurable Threshold & Zero-Hallucination Refinement Loop

#### Settings Configuration (`app_settings` -> `ats`)
In **Settings → Resume & ATS Defaults**, users configure:
- **`atsThreshold`** (`number`, `50–95`, default `78`): Target composite JD-ATS score required before tailoring considers a resume "threshold-met".
- **`maxRefinementPasses`** (`integer`, `1–5`, default `3`): Maximum refinement iterations after Pass 0.
- **`minImprovementDelta`** (`number`, `1–10`, default `2`): Minimum score gain required to continue iterating (prevents endless churn on non-improving JDs).
- **`autoRefineOnTailor`** (`boolean`, default `true`): Automatically run refinement loop whenever tailoring a resume from a Job or MCP tool.
- **`atsLayerWeights`**: Default Workday/Greenhouse calibrated preset (`requiredSkillsLexical: 35`, `semanticAndSeniorityFit: 30`, `preferredSkills: 15`, `pdfParseIntegrity: 10`, `engineeringQualityRubric: 10` — strictly summing to `100%`).
- **`enableLocalEmbeddings`** (`boolean`, default `true`): Uses cached offline ONNX semantic embeddings (`bge-small-en-v1.5`) when downloaded, falling back cleanly to TF-IDF/CLI alignment without blocking.
- **`enableHiringAgentRubric`** (`boolean`, default `true`): Computes built-in HackerRank `hiring-agent`-style Portfolio Strength rubric (`0–120` advisory scorecard + `10%` composite signal).

#### Iterative Tailoring & Refinement Algorithm (`server/services/ats/refine.ts`)
1. **Inputs:** Canonical `job` + `job_requirements`, `search_profile` (with seniority & skill preferences), `career_persona` + full **Master Resume Vault** (ONLY `verification_status === 'verified'` items & `bullet_variants`).
2. **Pre-Flight Preference Check:** If JD fails `seniority_hard_filter` or `excluded` hard skill filters, still run Pass 0 if explicitly requested, and pre-record the preference mismatch reason cleanly.
3. **Pass `0` (Initial Tailored Draft):**
   - Selects top relevant Master experiences, projects, achievements, and skills matching the persona & JD.
   - Scores Pass `0` via ATS Engine (`scoreDraftAts()` -> creates `ats_evaluations` row with pass number `0`, composite score, layer breakdown, matched keywords, missing required/preferred keywords, structural checks, and portfolio rubric).
   - **Fast exit:** If `score >= atsThreshold`, status = `threshold_met`.
4. **Refinement Passes `k = 1 .. maxRefinementPasses` (Only While `score < atsThreshold`):**
   - Identifies **top actionable missing JD keywords / requirements** (e.g., JD asks for `"Redis caching"`, `"latency optimization"`, `"RAG evaluation"`, `"SDE3 ownership scope"`).
   - **Step 4a (Zero-Hallucination Master Retrieval):** Searches the user's **untried Master Resume Vault** (`experiences`, `projects`, `achievements`, `skills`, `bullet_variants`, `evidence_links`) for verified facts supporting those gaps!
   - **Step 4b (Grounded Selection / Rephrasing):**
     - Swaps in a higher-relevance verified `bullet_variant`, promotes a relevant verified project/achievement from Master Resume, or (in AI mode) rewrites an existing cited bullet using the exact verified fact corpus while keeping every `stableClaimId` and `evidenceRef` intact.
     - Runs **`validateStructuredResumeFactuality`** immediately after every candidate pass! Any pass introducing uncited assertions, banned unverified metrics (`"50%"` not in Master Vault), or unverified skills is **strictly rejected and rolled back** before scoring.
   - **Step 4c (Re-Score & Convergence Check):** Re-runs ATS Engine. Saves best-scoring valid draft (`bestDraft`) so refinement can **never regress score**. Stops early if `score >= atsThreshold` (`threshold_met`) OR if `gain < minImprovementDelta` or zero untried Master facts map to remaining gaps (`converged_below_threshold`).
5. **Genuine Unmet-Threshold Diagnosis (`status: 'below_threshold'`):**
   - Never inflates scores or pads invisible keywords.
   - Computes structured `mismatchDiagnosis`:
     - `primaryReason`: `"seniority_mismatch" | "hard_skill_gap" | "domain_experience_gap" | "insufficient_master_evidence" | "structural_constraint"`
     - `plainLanguageSummary`: e.g., *"Reached ATS 64 / 78 (2 passes). This JD prefers Staff/8+ yrs distributed Go & Kafka experience, whereas your Search Profile targets SDE2/SDE3/Senior SDE and your verified Master Resume has no Go or Kafka facts."*
     - `unmatchedRequiredKeywords`: Exact missing JD requirements + whether any unverified `needs_review` fact exists in Master Profile (`"Found unverified mention in your profile — verify it if real"`) vs completely absent.
     - `recommendation`: `"mismatch_skip" | "verify_existing_facts" | "add_real_project_to_master"`
   - Persisted in `ats_evaluations` and prominently displayed as a calm amber diagnostic banner in **Resume Studio**, **Job Detail**, and **Overview**, plus returned verbatim in MCP tool outputs.

---

### 3.4 MCP Server Specification (`server/mcp/`)

Any local coding or desktop agent (`Claude Desktop`, `Claude Code`, `Codex`, `OpenCode`, `Antigravity`, `Cursor`) can connect to Personal Job Copilot as an **MCP Server**.

#### Transport & Packaging
- **Primary Transport:** Standard `stdio` (`@modelcontextprotocol/sdk`, entrypoint `scripts/mcp-server.mjs` / `npm run mcp`) — runs locally over pipes with zero open network ports and inherits `APP_DATA_DIR`.
- **Optional Local HTTP Transport:** Streamable HTTP/SSE on `127.0.0.1` (default port `3105`, configurable in Settings, disabled by default) protected by `validateHostAndOrigin` + a locally generated random bearer token stored with `0600` perms in `APP_DATA_DIR/secrets/mcp.token` (never packed in `.tar.gz` backups!).
- **Settings UI:** Dedicated **Settings → MCP Server** section showing copy-ready JSON snippets for Claude Desktop / Codex / Cursor (`stdio` command + `APP_DATA_DIR`), HTTP toggle + token rotation, and a live `mcp_tool_runs` audit log.

#### Exposed MCP Tools (Strict Parity With Local Services & Security Gates)

| Tool Name | Purpose | Key Guardrails |
|---|---|---|
| `list_personas` / `get_master_profile` | Read Role Personas (`AI Engineer`, `Full-Stack`, etc.) and **verified-only** Master Resume facts. | Excludes `rejected` / unverified sensitive legal data unless explicitly requested with flag. |
| `list_search_profiles` | List search targets, seniority rules (`SDE2`/`SDE3`/`Senior SDE`), and ATS threshold settings. | Read-only safe metadata. |
| `search_jobs` / `get_job_detail` | Query FTS5 job index with seniority/workplace/status filters and match evidence. | Read-only; canonicalizes merged jobs. |
| `import_job` | Manually ingest a JD (`title`, `company`, `descriptionText`, optional `applyUrl`). | Blocks automated LinkedIn/Naukri scraping; enforces `http:`/`https:` URL check. |
| `analyze_job` / `compute_job_match` | Extract JD requirements, classify seniority, and score fit against Persona + Search Profile. | Respects daily AI budget cap; falls back deterministically. |
| `tailor_resume` | Create/tailor a draft for `(jobId, personaId?, searchProfileId?)`, automatically running the ATS refinement loop up to `settings.ats.threshold`. | Strictly grounds every bullet in Master Resume (`validateStructuredResumeFactuality`); returns genuine mismatch report if below threshold. |
| `score_resume_ats` | Run the 3-layer ATS Engine (Parser + JD Alignment + HackerRank Portfolio Rubric) on a draft or pasted text. | Deterministic scoring; returns exact unmet requirements & structural audit. |
| `refine_resume` | Run another bounded refinement pass on a draft with optional user/agent instruction (e.g., `"Focus on Frontend Web Vitals"`). | Rejects fabricated metrics/skills; preserves immutable prior `resume_versions`. |
| `update_resume_manually` | Apply structured updates (`headline`, `summary`, `bullets`, reordering, template paper size) preserving `stableClaimId`. | Rejects references to unverified/non-existent Master facts. |
| `preview_resume_pdf` / `export_resume` | Render real Chromium PDF (`A4`/`Letter`) or DOCX/MD/TXT, create immutable `resume_version`, and return file metadata + extracted PDF verification text. | Enforces zero external network during PDF render (`about:blank`/`data:` only); files written cleanly inside `exports/`. |
| `generate_cover_letter` / `export_cover_letter` | Draft & export a grounded Cover Letter tied to Master facts + JD, or render PDF preview. | Fact-cited only; rejects unverified claims. |
| `draft_application_answers` | Prepare grounded answers for non-sensitive application prompts. | **Hard Block:** Sensitive legal, visa, work-auth, EEO/demographic questions always return `requiresHumanInput: true`, empty answer. |
| `prepare_application` / `list_applications` | Create application workspace (`preparing` / `ready_to_apply`). | **Safety Lock:** MCP tools **cannot** set `status = 'applied'` autonomously (`CONFIRMATION_REQUIRED — human submission required in UI`). |

#### Exposed MCP Resources
- `pjc://profile/master` (Verified Master Resume summary JSON)
- `pjc://personas/{slug}` (Role Persona curated configuration)
- `pjc://jobs/{id}` (Canonical JD + seniority classification + requirements)
- `pjc://resumes/{id}` (Current `StructuredResumeDocument` + ATS evaluation summary)
- `pjc://resumes/{id}/rendered.html` (ATS-safe HTML view)

---

### 3.5 Theme-Matched Dual Resume Update Forms (Manual + AI)

Inside **Resume Studio (`/resumes/[id]`)**, the left `44%` Editor Rail features a clean segmented switcher matching the Stone & Evergreen palette (`#F5F4F0` canvas, `#FBFAF7` raised cards, `1px` `#DAD9D2` hairline borders, `#416653` evergreen active states, `Geist Sans` + `Geist Mono` `tabular-nums`):

#### Tab 1: **Manual Editor Form**
1. **Persona & Paper Strip:** Switch active Role Persona inheritance (`AI Engineer` / `Full-Stack` / `Frontend`), toggle `A4` vs `US Letter`, margin preset, font/line scale, and visible sections.
2. **Structured Contact & Header Card:** Clean form fields (`Full Name`, `Target Headline`, `Email`, `Phone`, `Location`, validated `http/https` portfolio/GitHub/LinkedIn links) — synced cleanly back or overridden locally for this tailored draft.
3. **Section & Entry Editor Cards (`@dnd-kit/react` + Keyboard `↑`/`↓`):**
   - Drag or move sections & entries cleanly.
   - Edit `Heading`, `Subheading`, `Location`, `Date Range` directly in clean compact inputs.
   - **Bullet Bank Drawer / Inline Picker:** Each entry has **`+ Add bullet from Master Resume`** (opens searchable verified Master bullets + truthful `bullet_variants` for that role/project so you can insert verified wording in 1 click) AND **`+ Write custom bullet`** (autosaved + prompts to attach >=1 verified Master fact via `Evidence (N)`).
4. **Skills Group Organizer:** Toggle/reorder curated verified skills highlighting those matching JD keywords in subtle evergreen accent pills.

#### Tab 2: **AI Update Form**
Designed specifically so updating a resume with AI feels fast, transparent, and strictly controllable (never a black-box overwrite!):
1. **Scoped Update Form:**
   - **Target Scope selector:** `Whole Resume`, `Summary Only`, `Selected Role/Project`, or `Address Unmet ATS Gaps`.
   - **Instruction / Guidance box:** Free-text instruction (e.g., *"Tighten bullets for SDE3 scalability scope and surface PyTorch eval benchmarks from Master Resume"*) + 1-click quick chips (`Hit ATS Threshold`, `Shorten to 1 Page`, `Emphasize System Design`, `Highlight Frontend Metrics`).
   - **Gap Checkboxes:** Pre-populated list of exact unmet ATS keywords/requirements for this JD; check which gaps the AI should search your Master Resume Vault for.
   - **Model & Provider Pill:** Displays configured local CLI (`claude`, `codex`, `opencode`, etc.) + model name cleanly (read-only link to Settings if `none`).
2. **Side-by-Side Grounded Diff Review Card (Before Applying!):**
   - Runs AI generation + `validateStructuredResumeFactuality` on a candidate buffer (never clobbering the live draft!).
   - Renders clean inline green/amber diff lines (`Old text` → `Proposed text`) paired with:
     - Exact cited **`[Master Fact: ...]`** provenance chips
     - **Projected ATS Score delta** (e.g., `71 → 82 (+11)`)
   - User clicks **`Apply accepted changes`** (pushes to Undo stack + autosaves) or **`Discard`** (zero mutation). If the AI returns an ungrounded hallucination, the validator rejects it and shows a clear warning explaining which metric/skill lacked Master Resume verification.

---

### 3.6 Live Generated PDF Preview Before Download (Resume & Cover Letter)

To ensure what the user sees on screen matches the downloaded `.pdf` pixel-for-pixel (catching awkward page breaks, widow lines, font wrapping, and overflow *before* downloading):

1. **Preview Mode Switcher (Both Resume Studio & Cover Letter Studio):**
   - Segmented pill on the right `56%` preview header: **`Fast Live Draft`** (instant DOM/HTML paper preview at 60fps while typing) vs **`Generated PDF Preview`** (exact Playwright Chromium-rendered PDF!).
2. **Backend On-Demand Preview Endpoints (No Export Bloat):**
   - `POST /api/resumes/[id]/preview-pdf` and `POST /api/cover-letters/[id]/preview-pdf` (or cached by `contentHash + templateSettingsHash` inside `APP_DATA_DIR/tmp/preview-cache/` with `0600` permissions — NEVER polluting immutable `resume_versions` or `document_exports` until the user explicitly clicks **Snapshot Version** or **Export / Download**!).
   - Streams `application/pdf` with `X-Content-Type-Options: nosniff` + `Cache-Control: no-store`.
3. **In-App `pdfjs-dist` Canvas PDF Viewer Component (`components/documents/pdf-preview-viewer.tsx`):**
   - Fetches the preview PDF binary cleanly (`fetch` → `Uint8Array`), renders crisp high-DPI (`devicePixelRatio`) canvases per page with:
     - Multi-page continuous scroll with exact `Page 1 of 2` indicator and subtle page-shadow framing on `#EEEDE7` canvas.
     - Zoom presets (`Fit Width`, `100%`, `125%`).
     - **`ATS Text Check` badge** showing live `pdfjs-dist` extracted-text confirmation (`"2,418 chars extracted cleanly · 0 layout warnings"`) right on the preview!
     - **`Download this exact PDF`** primary action button right in the viewer footer (promotes cached/verified PDF cleanly into an immutable `resume_version` + `document_export` record if unchanged).
   - **Works seamlessly with strict CSP (`frame-ancestors 'none'`):** Canvas rendering inside React uses zero `<embed>`/`<object>`/plugin issues across Chrome, Safari, Firefox, and Electron-like WebViews.
4. **Cover Letter Dedicated Preview Pane:**
   - Upgrades the Cover Letter section inside **Applications** (and standalone modal/drawer from **Resumes / Job Detail**) into a clean 2-pane mini-studio: Left pane (`Tone`, `Length`, **Master Story Spotlight picker**, inline paragraph editor + **AI Polish form**), Right pane (**Fast HTML / Exact Generated PDF Preview** toggle + one-click `.pdf` / `.docx` download).

---

### 3.7 Additional High-Value Features Recommended for V2

1. **Application Packet Bundler (`Export Packet .zip`)**
   - From any Application or Job Detail page, export a single clean ZIP named `<CandidateName>_<Company>_<Role>_Packet.zip` containing:
     - Cleanly named Resume PDF + DOCX (`Morgan_Rivera_Stripe_Senior_SDE_Resume.pdf`)
     - Tailored Cover Letter PDF + DOCX
     - Application Answers Markdown/TXT summary (excluding unfilled sensitive prompts)
2. **Pre-Submission ATS Keyword & Gap Overlay in Preview**
   - Optional subtle highlight toggle inside Live Draft preview coloring matched JD `must_have` terms in soft sage (`#E8EFEA`) and listing unaddressed `must_have` gaps cleanly in the side margin.
3. **Master Resume Bullet Strength & Duplicate Detector**
   - On **Career Profile**, gently flags weak/generic bullets (missing action verb, missing scope/scale, duplicate wording across projects) and offers 1-click **"Add variants for Personas"** without fabricating numbers.
4. **Smart Follow-Up & Stale Pipeline Reminders**
   - Local-only rule settings (e.g., flag `applied` rows untouched for `7` days or `ready_to_apply` > `3` days) surfaced cleanly in **Overview → Needs attention** with quick 1-click status note presets (`"Sent LinkedIn/recruiter follow-up"`, `"Recruiter screen scheduled"`).
5. **Rejected-Fit Memory & One-Click Seniority Mute**
   - When a JD fails ATS threshold due to mismatched seniority (e.g., `Staff` / `Principal` / `Intern`) or excluded skills, saving **"Remember mismatch"** keeps it hidden from Top-10 **Overview** recommendations across future source scans unless reopened manually.
6. **ATS Score Trajectory & Export Audit Drawer**
   - Inside **Resume Studio → Versions**, shows each tailoring/refinement run (`Pass 0: 61 → Pass 1: 73 → Pass 2: 81`), which Master facts resolved which JD keywords, and which immutable PDF/DOCX exports were generated for that snapshot.

---

## 4. Updated Data Model & API Summary

### 4.1 New & Extended Tables (`server/db/schema/`)
- **New tables:** `career_personas`, `career_persona_items`, `bullet_variants`, `ats_evaluations`, `mcp_tool_runs`, `application_followups`
- **Extended columns (additive migrations on existing v1.4 SQLite DBs):**
  - `search_profiles`: `persona_id`, `allowed_seniorities_json`, `seniority_hard_filter`, `treat_unspecified_seniority_as`, `experience_min_years`, `experience_max_years`, `experience_hard_filter`
  - `jobs`: `detected_seniority`, `detected_min_years`, `detected_max_years`
  - `resume_drafts`: `persona_id`, `latest_ats_score`, `ats_status` (`pending` | `threshold_met` | `below_threshold` | `mismatch`), `ats_evaluation_id`
  - `app_settings` (`app_settings_v1` JSON): `ats` config block (`threshold`, `maxRefinementPasses`, `minImprovementDelta`, `weights`, `enableLocalEmbeddings`, `localEmbeddingModelDownloaded`, `enableHiringAgentRubric`, `hiringAgentCommand`) + `mcp` config block (`httpEnabled`, `httpPort`)
- **Non-Destructive Migration & Backup Compatibility:** Existing `v1.4` data migrates in-place without resetting SQLite; one default `"Default Profile"` `career_persona` is auto-seeded inheriting verified Master items so single-profile workflows keep working seamlessly. New runtime embedding models under `APP_DATA_DIR/runtime/models/` and `APP_DATA_DIR/secrets/mcp.token` remain strictly excluded from `.tar.gz` backups.

### 4.2 New Internal API Routes (`app/api/`)
- **Personas & Master Variants:**
  - `GET / POST /api/personas`, `GET / PATCH / DELETE /api/personas/[id]`
  - `PUT /api/personas/[id]/items` (inclusion, ordering, variant selection)
  - `GET / POST /api/profile/bullet-variants`, `PATCH / DELETE /api/profile/bullet-variants/[id]`
- **ATS & AI Resume Studio Updates:**
  - `POST /api/resumes/[id]/ats-evaluate` (score current draft + rendered PDF check)
  - `POST /api/resumes/[id]/refine` (run bounded refinement loop toward `settings.ats.threshold`)
  - `POST /api/resumes/[id]/ai-update` (propose grounded diff + projected ATS delta WITHOUT mutating until confirmed)
  - `POST /api/resumes/[id]/preview-pdf` (inline PDF bytes cached by content hash for `pdfjs-dist` canvas preview)
  - `POST /api/cover-letters/[id]/preview-pdf` (inline PDF bytes for Cover Letter preview)
  - `POST /api/applications/[id]/packet` (bundle `.zip` application packet safely)
- **MCP Management:**
  - `GET /api/mcp/status`, `POST /api/mcp/token/rotate`, `GET /api/mcp/logs`

### 4.3 Core Schemas, Offline Model Policy & Verification Gates
- **`ats_evaluations` Payload Contract:**
  - Tracks `pass_number` (`0..5`), `composite_score` (`0..100`), `threshold_target`, `status` (`threshold_met` | `below_threshold` | `mismatch`), sub-scores (`parse_integrity_score`, `lexical_bm25_score`, `semantic_seniority_score`, `preferred_skills_score`, `engineering_quality_score`, `hiring_agent_score_120`), `matched_keywords_json`, `missing_required_json`, `missing_preferred_json`, `parse_warnings_json`, and `mismatch_diagnosis_json`.
- **Zero-Surprise Offline Embeddings Policy:**
  - Optional local ONNX embeddings (`Xenova/bge-small-en-v1.5`) download into `APP_DATA_DIR/runtime/models/` **only** when the user clicks an explicit setup/download button in Settings (matching the Chromium `setup:pdf-browser` pattern). Normal tailoring/matching never triggers silent background model downloads and falls back deterministically to TF-IDF/BM25 + configured CLI alignment when offline.
- **Required Verification Gates (Before Marking V2 Done):**
  - Unit + eval suites verifying: (1) Workday PDF spatial-parse detector flags column bleed/missing headers; (2) ATS refinement monotonically saves highest valid score, triggers `validateStructuredResumeFactuality` on every pass, and emits genuine `mismatch_diagnosis` when threshold is unreachable; (3) `SDE2`/`SDE3`/`Senior SDE` seniority taxonomy filters `Intern`/`Staff`/`Principal` accurately; (4) MCP server enforces factuality, blocks autonomous `applied` transitions, and rejects missing/invalid bearer tokens over HTTP.
  - Playwright E2E verifying Persona switching, Manual & AI Diff Studio forms, `pdfjs-dist` Generated PDF Preview before download (both Resume & Cover Letter), and Application Packet `.zip` export.

---

## 5. UX Flows & Design Guardrails

- **No Dead Ends When Threshold Fails:** If `atsScore < settings.ats.threshold` after `maxRefinementPasses`, never block the user silently or lower quality; display the **Preference / Mismatch Diagnostic Banner** cleanly alongside the best verified draft so the user immediately sees whether to skip the role, switch Role Persona, or verify/add real missing Master experience.
- **No Unreviewed AI Overwrites:** The AI Update Form always presents a **diff + cited Master fact badges** first; Manual Form edits and accepted AI updates share the exact same Undo stack and `500ms` autosave pipeline.
- **Zero MCP Auth Leaks or Auto-Applies:** MCP `stdio` needs no open port; optional loopback HTTP requires `Origin` + bearer token (`APP_DATA_DIR/secrets/mcp.token`), excluded from backups; `mark_applied` remains human-only in the UI.
- **Consistent Quiet Workbench Aesthetic:** Every new form, diff view, ATS meter, and PDF canvas viewer strictly uses existing tokens (`#F5F4F0`, `#FBFAF7`, `#22231F`, `#416653`, `1px` borders, `Geist Mono` `tabular-nums`, `motion/react` honoring `prefers-reduced-motion`).

---

## 6. Phased Implementation Plan (When Development Starts)

1. **V2 Phase 1 — Master Bullet Variants, Role Personas & Seniority Engine:** Schema migrations, persona/variant CRUD, JD seniority classifier (`SDE2`/`SDE3`/`Senior SDE`), UI persona switcher + Search Profile seniority controls.
2. **V2 Phase 2 — Dual-Layer ATS Engine & Bounded Refinement Loop:** `server/services/ats/` (Parser + JD Alignment + HackerRank Portfolio Rubric), `refine_resume` zero-hallucination loop, Settings ATS threshold controls, mismatch diagnosis UI.
3. **V2 Phase 3 — Dual Manual/AI Studio Forms & `pdfjs-dist` PDF Preview:** Theme-matched Manual + AI diff Studio forms, Cover Letter studio upgrade, hash-cached `/preview-pdf` endpoints, shared `<PdfPreviewViewer />`, and Application Packet `.zip` exporter.
4. **V2 Phase 4 — MCP Server & Audit Logs:** `scripts/mcp-server.mjs` (`@modelcontextprotocol/sdk`), full tool/resource catalog, loopback HTTP + token auth option, Settings MCP inspector & `mcp_tool_runs` log.
5. **V2 Phase 5 — Verification & Release Gates:** Unit + security + ATS-loop evals (confirming 0 fabricated metrics across refinement iterations, seniority filter accuracy, MCP confirmation locks) + Playwright E2E across all new V2 flows.

---

## 7. Acceptance Criteria

- [ ] **ATS Threshold & Honest Mismatch:** Setting threshold to e.g. `80` in Settings triggers bounded refinement on tailoring; when verified Master facts support `>= 80`, the loop hits `threshold_met` with 0 unverified claims; when a JD requires missing skills or Staff/Intern seniority, refinement halts cleanly and explains the exact mismatch.
- [ ] **Master Resume Single Source of Truth:** Editing/verifying a fact in Master Profile updates/re-validates inherited Role Personas (`AI Engineer`, `Full-Stack`, `Frontend`) without duplicate storage; single-profile users work seamlessly with 1 default persona.
- [ ] **Strict Seniority Filtering:** With `SDE2, SDE3, Senior SDE` selected (`hardFilter: true`), `Intern`, `New Grad`, `Staff`, and `Principal` postings are deterministically excluded with clear diagnostic reasons.
- [ ] **Manual + AI Forms & Diff Safety:** Users can edit resumes cleanly via the structured Manual Form OR submit scoped instructions in the AI Form, inspect a grounded diff + projected ATS score, and accept/discard safely.
- [ ] **True Generated PDF Preview:** Both Resume Studio and Cover Letter Studio render the exact Playwright-generated PDF page-by-page inside the UI (`pdfjs-dist` canvas + extracted text verification) prior to download.
- [ ] **MCP Server End-to-End:** External MCP clients (`claude`, `codex`, `cursor`, `agy`) can connect via `stdio`, list personas/jobs, tailor & refine a resume to ATS threshold, score ATS, generate cover letters, and export PDFs while strictly respecting factuality checks and human-only `applied` confirmation locks.
