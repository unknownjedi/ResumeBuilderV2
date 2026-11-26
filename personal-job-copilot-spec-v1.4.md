# Personal Job Copilot — Product & Technical Specification

**Document status:** Revised implementation specification — product, design, runtime, data model, API, and operational decisions reconciled; runtime verification still required  
**Version:** 1.4  
**Date:** 25 November 2026  
**Product type:** Single-user, local-first web application  
**Primary runtime:** Browser UI served from `http://127.0.0.1:3000` by a local Node.js process (port configurable)

**Revision 1.4:** Resolves the v1.3 review gaps: pins HTML parsing/sanitization and backup archive dependencies; specifies OpenAI and OpenAI-compatible adapters using built-in `fetch`; connects search-profile skills to matching and ranking; defines a useful no-AI mode and bounded AI-analysis policy; fixes worker compilation paths; specifies coordinated restore/reset; separates saved-job state from application lifecycle; makes resume claims entry-aware; completes missing schema/API workflows; and defines location, date, queue, upload, CSP, and resume-paper behavior.

---

## 1. Product definition

### 1.1 Vision

Personal Job Copilot is a private, locally run web application that helps one person manage a focused job search. It maintains a verified career profile, discovers relevant public job postings from user-selected sources, explains how well each role matches the person's documented experience and preferences, and prepares accurate job-specific application materials.

The application is a personal tool, not a hosted service. It has no accounts, registration, multi-tenancy, billing, subscriptions, public user profiles, or shared user data.

### 1.2 Primary outcome

Reduce the time and manual effort between discovering a suitable job and submitting a complete, high-quality application—without fabricating candidate experience or misrepresenting job freshness, salary, or application status.

### 1.3 Product principles

1. **Local-first:** The application, database, documents, preferences, and application history are stored on the user's machine.
2. **One person per installation:** One career identity and one local workspace. Multiple job-search strategies may share that identity.
3. **Evidence before generation:** A generated resume claim must be traceable to information in the verified career profile.
4. **Freshness with provenance:** Distinguish an employer-provided posting date from the date the local app first discovered a job.
5. **Explainable recommendations:** Show the evidence behind fit and ranking; do not present scores as hiring probabilities.
6. **Human-controlled applications:** Prepare and organize application materials. The user reviews and submits applications on the employer's site.
7. **Small, reliable core:** Use deterministic code for ingestion, filtering, scoring, validation, and state transitions. Use an LLM only where language understanding or generation adds value.
8. **Customizable, not opaque:** Search strategies, hard filters, scoring weights, resume preferences, sources, and schedules are configurable.
9. **Graceful degradation:** Job discovery and profile management must remain usable when an AI provider or optional integration is unavailable.

### 1.4 Explicitly out of scope

The following are not part of this product:

- User accounts, login, registration, multiple users, cloud sync, or multi-tenancy.
- Monetization, subscriptions, billing, analytics for product operators, or an admin console.
- Interview preparation, mock interviews, interview question banks, or interview coaching.
- HR/recruiter networking, connection requests, messaging, outreach sequences, or contact discovery.
- LinkedIn scraping, browser automation, profile scraping, post scraping, or automated engagement.
- Naukri scraping or automated access unless a supported, authorized integration is identified and separately approved.
- Automatically submitting job applications or answering legally significant application questions without user review.
- Bypassing job-board rate limits, application limits, CAPTCHAs, authentication, or other access controls.
- A global job marketplace or a centrally maintained, exhaustive company directory.
- An autonomous multi-agent system that can take unreviewed actions.
- A mobile application or desktop wrapper. This is a local web app only.

---

## 2. Target user and operating assumptions

### 2.1 Target user

One individual actively searching for employment and willing to configure their own career information, job preferences, source list, and AI provider credentials.

The product must not assume a particular country, industry, seniority, salary currency, job title, or technology stack. Those are user-configurable data.

### 2.2 Runtime assumptions

- The user starts the local application on their own computer and opens it in a browser.
- The app binds to loopback only by default (`127.0.0.1`), not to the LAN or public internet. The default port is `3000`; the actual local URL is printed at startup. A custom port may be configured without changing the bind address.
- The local Node.js server and background worker must remain running for scheduled discovery and synchronization. Closing the browser tab does not stop them; stopping the local process does.
- The app assumes the current operating-system user account is trusted. Anyone who can use the same OS account and reach the local browser can access the workspace; there is intentionally no in-app password or account boundary.
- On restart, the scheduler performs a catch-up check for tasks that became due while the app was stopped. It must not launch an unbounded backlog of missed runs.
- Job-source fetching, Gmail synchronization, and cloud LLM calls require an internet connection. A local model can be used if the configured model endpoint supports the provider interface.
- Local storage does not mean all processing is offline. Before sending personal profile or resume content to a remote model provider, the app must identify the provider and make the data-sharing behavior clear.

### 2.3 First-run configuration

The first-run flow must guide the user through the minimum useful setup:

1. Import an existing resume or create a career profile manually.
2. Review and verify extracted career facts.
3. Create the first job-search profile (target role, geography/work mode, experience, and preferences).
4. Configure an AI provider if AI parsing and generation are desired.
5. Add at least one job source or import a job URL / job description manually.
6. Run a first discovery and matching cycle.

The user may skip optional integrations and return to them later. The app must not require Gmail, an AI API key, or an initial list of company sources to open the workspace.

---

## 3. Scope and release priorities

### 3.1 MVP — required for the first usable release

| ID | Capability | MVP requirement |
|---|---|---|
| MVP-01 | Local workspace | Single-user local web app, no login, SQLite persistence |
| MVP-02 | Career profile | Structured profile, project and achievement library, resume import, user verification |
| MVP-03 | Search profiles | Multiple role-search strategies sharing the same career identity |
| MVP-04 | Source registry | Add, pause, edit, test, and remove job sources |
| MVP-05 | Job ingestion | Greenhouse, Lever, Ashby public job-board connectors; manual URL/JD import |
| MVP-06 | Generic career pages | User-added public career URLs, with conservative and configurable fetching; unsupported pages remain manually importable |
| MVP-07 | Normalization and deduplication | Canonical job records with source lineage and conservative duplicate handling |
| MVP-08 | Freshness tracking | Separate source-posted date, first-seen time, last-seen time, and last-verified time |
| MVP-09 | Discovery and search | Job list, filters, saved/dismissed state, full-text search |
| MVP-10 | Matching | Explainable documented-fit score and user-configurable ranking weights |
| MVP-11 | Home page | Up to 10 recommended opportunities, with freshness and match explanations |
| MVP-12 | Resume tailoring | Job-specific resume draft generated from verified profile facts only |
| MVP-13 | Resume review/export | Structured editing, ATS-safe preview, DOCX and PDF export |
| MVP-14 | Application materials | On-demand cover letter and common application-answer drafts |
| MVP-15 | Application tracking | Minimal manual pipeline, submitted resume/version association, notes and status history |
| MVP-16 | Local operations | Background worker, source-run history, error visibility, backups and restore |
| MVP-17 | Quality controls | Unit, integration, AI evaluation, crawler fixture, and end-to-end tests |

### 3.2 Later release — only after MVP quality is proven

| ID | Capability | Reason to defer / entry condition |
|---|---|---|
| LATER-01 | Gmail job-alert import | Useful additional source, but requires user-owned Google OAuth setup and ongoing token handling. Add after core ingestion and manual import are reliable. |
| LATER-02 | Compensation estimation | Do not guess salary with an LLM. Add only when a credible, permitted salary dataset or sufficient user-supplied comparable observations exist. |
| LATER-03 | Browser-assisted form autofill | Adds website-specific fragility and sensitive form handling. Consider only after manual application workflow is stable; always require user review and submission. |
| LATER-04 | Rich notification delivery | Local dashboard indicators are sufficient initially. Add OS/browser notifications only if the user requests them. |
| LATER-05 | Embedding-based retrieval | SQLite FTS5 plus structured matching is sufficient initially. Add embeddings only if evaluation demonstrates meaningful retrieval failures. |

### 3.3 Deliberately excluded even from the roadmap

- LinkedIn automated searching, scraping, or engagement.
- Automated recruiter outreach or HR networking.
- Interview preparation features.
- Unreviewed automatic application submission.
- Public job-search profiles or cloud collaboration.
- Generic AI chat unrelated to the job-search workflow.

---

## 4. User experience and navigation

### 4.1 Primary navigation

Keep the navigation compact:

1. **Overview** — recommended jobs and pending actions.
2. **Discover jobs** — search, filter, source, and inspect jobs.
3. **Career profile** — work history, projects, achievements, skills, education, and evidence.
4. **Search profiles** — role-specific preferences and ranking rules.
5. **Applications** — saved, preparing, ready, applied, and outcome tracking.
6. **Resumes** — generated drafts and exports.
7. **Settings** — sources, AI provider, Gmail (when implemented), schedules, backup, and privacy.

Do not create separate top-level areas for cover letters, ATS scores, AI chat, or job alerts. Make these capabilities available in the relevant job or resume workflow.

### 4.2 Overview page

The overview is an action-oriented workspace, not a vanity analytics dashboard.

It must show:

- The active search profile selector.
- Up to 10 recommended open jobs ranked for that profile.
- For each recommendation: title, company, location/work mode, source, posted-date status, first-discovered time, documented-fit score, priority rank, salary only when supplied by a reliable source, and a short reason for the match.
- A clear indication when the posted date is unknown.
- A small “needs attention” section for jobs with a draft awaiting review, applications ready to submit, or source failures requiring user action.
- The last successful source scan and next scheduled scan.

The app must not generate ten resumes automatically. It should generate a tailored resume only when the user opens a job and requests it. A batch action may be considered later, but it is not part of MVP.

### 4.3 Discover jobs page

Required capabilities:

- Search by title, company, location, description, and skills.
- Filters for search profile, source, company, location, remote/hybrid/onsite, job type, experience range, salary when present, posted date when known, first-seen date, fit score, and application state.
- Sort by recommended, documented fit, employer-posted date (only when known), first discovered, and company/title.
- Save, dismiss, reopen, or mark a job as applied.
- Open the original posting in a new browser tab.
- Import a job from a URL or pasted job description.

A missing salary, location, experience range, or posted date must be shown as unknown—not silently interpreted as zero or as a negative match.

### 4.4 Job detail page

Display:

- Canonical title, company, location, workplace type, employment type, and job description.
- Original source and original application URL(s).
- Source-provided posted date, if available.
- First-seen and last-verified timestamps.
- Duplicate/source lineage where multiple source records point to the same canonical job.
- Extracted requirements grouped into must-have, preferred, responsibilities, and other constraints.
- Documented-fit score with criterion-by-criterion evidence mapping.
- Profile gaps split into “not found in profile”, “partially demonstrated”, and “supported”.
- Declared compensation details and source, if present.
- Actions: save, dismiss, tailor resume, generate cover letter, prepare application answers, and mark applied.

### 4.5 Career profile page

Sections:

- Contact and professional headline.
- Summary / career objective (optional).
- Work experience.
- Projects.
- Achievements and measurable impact.
- Skills and proficiency (optional proficiency is user-entered; do not infer it as fact).
- Education.
- Certifications.
- Languages (optional).
- Source documents and evidence.

Every extracted item starts as **Needs review**. Only user-approved facts become **Verified**. The user can edit, merge, reject, archive, or add facts manually.

### 4.6 Search profile page

A search profile represents one job-search strategy, not a second person. Its skills describe the skills a target job should contain—not a claim that the candidate already possesses them. A skill marked `must_have` is weighted by default; the user may explicitly promote it to a hard filter. Search-profile skill entries are independent of the candidate’s `skills` table so the user can target or exclude technologies not yet present in their career profile.

Examples include “Backend Engineer”, “AI Engineer”, and “Remote Full Stack”. Each search profile has:

- Name and target job titles / title aliases.
- Target seniority and years-of-experience range.
- Skills with a preference (`must_have`, `preferred`, or `excluded`) and a separate filter mode (`hard` or `weighted`). `must_have` is weighted by default until the user explicitly marks it as a hard filter.
- Preferred and excluded locations.
- Remote, hybrid, onsite preferences.
- Employment types.
- Minimum acceptable and optional target compensation, currency, and pay period (optional).
- Company or industry preferences (optional).
- Included and excluded job sources / companies.
- Hard filters and soft preferences.
- Recommendation-ranking weights.
- Resume-generation preferences.
- Maximum job age for recommendation (optional), and whether jobs with unknown employer-posted dates remain eligible (default: include, clearly labeled unknown). For unknown posted dates, compare maximum age against local `first_seen_at`; do not infer an employer-posted date.

The shared career profile remains the single source of candidate facts. A search profile must not copy or fork work history. `search_profile_skills` stores a normalized skill key, display label, aliases, preference, filter mode, and optional weight; it must not require a foreign key to `skills.id`.

### 4.7 Resume review page

Resume settings include `paper_size: "A4" | "Letter"`. The first export setup must ask the user to select the paper size; do not infer it from country, IP address, or system locale. Store the choice on the resume draft/search profile and render the editor preview at that exact page geometry. PDF export uses the same HTML/CSS preview template and Chromium print settings (`preferCSSPageSize: true`) so page size, margins, typography, and page-break controls match. DOCX uses the same structured content and named styles but may paginate differently in Word/LibreOffice; the app must not promise pixel-identical pagination across file formats or Word versions.

The generated resume must be editable before export.

Required operations:

- Reorder sections and bullets.
- Edit wording without losing evidence links.
- Remove a bullet.
- Add a bullet manually and associate it with one or more verified profile facts.
- Choose which projects and achievements to include.
- Preview in an ATS-safe one-column layout.
- Export DOCX and PDF.
- Keep the working draft editable. Each export creates an immutable resume version associated with the job, search profile, career-profile snapshot, and job-description snapshot; later edits must not mutate that exported version.

If the user edits a generated statement, keep its existing evidence references but mark the claim `user_edited_needs_review` until the user confirms that the edited wording is still supported. Do not describe a generated or edited sentence as independently verified merely because it has a source link. The editor interaction model, layout, drag-and-drop behavior, autosave, and evidence-link invariants are specified in Section 4.10.

### 4.8 Application tracking page

Keep the application pipeline simple:

- Preparing
- Ready to apply
- Applied
- Response received
- Rejected
- Withdrawn
- Archived

**Saved is not an application status.** Saving a job creates or updates a `user_job_states` row. An `applications` row is created only when the user chooses “Start application” or “Prepare application”, and its initial status is `preparing`. This prevents two tables from representing the same `Saved` state. The user can manually change application status and add a short note. The app records the timestamp and preserves the exact resume version and materials associated with the application. There is no recruiter CRM or interview-preparation workflow.

### 4.9 Design and interaction system

#### 4.9.1 Design intent

Use a restrained **quiet workbench** visual identity: editorial, precise, calm, and information-led. It should feel like a well-made personal research tool, not a generic SaaS admin template. The interface should prioritize readable job information, evidence, and editing over decorative dashboard furniture.

The design system is an implementation requirement, not optional styling guidance. Build shared tokens and primitives before implementing the seven primary views. Do not independently style each page.

#### 4.9.2 Color and surface hierarchy

MVP ships with one carefully tuned light theme. A second theme is not required for MVP.

| Token | Value | Use |
|---|---|---|
| `--canvas` | `#F5F4F0` | Main application background |
| `--surface` | `#FBFAF7` | Primary content surfaces |
| `--surface-raised` | `#FFFFFF` | Dialogs, popovers, focused editor panels |
| `--surface-muted` | `#ECEBE6` | Selected rows, quiet inset regions |
| `--text-primary` | `#22231F` | Headings and primary content |
| `--text-secondary` | `#55584F` | Supporting text; deliberately darker than tertiary text |
| `--text-tertiary` | `#64675F` | Lower-emphasis metadata; remains above 4.5:1 on muted surfaces |
| `--border` | `#DAD9D2` | Default 1 px dividers and outlines |
| `--border-strong` | `#B9BAB1` | Subtle emphasis dividers; not the sole boundary for interactive controls |
| `--control-border` | `#81847B` | Input/select boundaries with sufficient non-text contrast |
| `--accent` | `#416653` | Primary action, selected state, links, and focus treatment |
| `--accent-soft` | `#E7EEE9` | Quiet selected/active backgrounds |
| `--danger` | `#A33B32` | Destructive/error states only |
| `--warning` | `#855F1B` | Warnings only |
| `--on-accent` | `#FFFFFF` | Text/icons on the evergreen accent |
| `--on-danger` | `#FFFFFF` | Text/icons on destructive controls |
| `--disabled-text` | `#777970` | Disabled labels; verify contrast on each disabled surface |
| `--disabled-surface` | `#E4E3DD` | Disabled control backgrounds |

The evergreen accent is the only brand accent. Danger and warning colors are reserved for their semantic meanings and must not become decorative accents. Use `--control-border` or the accent focus ring for interactive control boundaries; the lighter `--border` token is for non-interactive dividers only. The selected secondary and tertiary text colors have approximate contrast ratios of 6.08:1 and 4.82:1 respectively against `--surface-muted` (`#ECEBE6`), leaving a clearer hierarchy and a margin above the 4.5:1 normal-text threshold. These calculated ratios are a design-token baseline, not a substitute for checking actual rendered font sizes, opacity, disabled states, hover states, and composited colors in the browser. Validate every text, focus, and control combination against WCAG 2.2 AA at every permitted surface pairing; do not reduce text opacity in a way that breaks contrast.

Use 1 px hairline borders and spacing to establish hierarchy. Do not use heavy card shadows. Shadows are permitted only for floating overlays when needed to distinguish them from the page. Use restrained radii: 4 px for compact controls, 6–8 px for inputs and small panels, and 10–12 px for dialogs. Do not place every piece of content inside a rounded card; use rows, section headings, whitespace, and dividers.

#### 4.9.3 Typography and data presentation

Resume exports are separate from the application UI typography. Do not use Geist as the required document font in exported DOCX files because the recipient may not have it installed. The resume template uses a selectable ATS-safe document font (default: Arial-compatible sans serif), with the exact font family and size stored in resume settings. The PDF renderer uses an explicitly tested local font mapping. DOCX and Chromium PDF must share the same structured content, section order, font intent, margins, and paragraph styles; Word pagination is not guaranteed to be pixel-identical to Chromium pagination.

- UI typeface: **Geist Sans**, bundled with the application so the interface does not depend on a remote font request.
- Data/metadata typeface: **Geist Mono**, also bundled locally.
- Use Geist Mono for timestamps, salary figures, fit/priority scores, source identifiers, IDs, and compact technical metadata. Use tabular numerals for aligned numeric columns.
- Body text defaults to 14–15 px with comfortable line height. Metadata uses 12 px or larger and must remain legible and meet contrast requirements.
- Use a small, consistent type scale: 12, 13, 14, 16, 20, 24, and 32 px. Avoid arbitrary one-off font sizes.
- Job titles and section titles should establish hierarchy through weight and spacing rather than oversized typography.

#### 4.9.4 Application shell and layout density

- Desktop-first layout; primary design target is a 1440 × 900 viewport. The desktop layout is optimized down to 1024 px wide. Below that, progressively switch to compact navigation and single-column/full-page patterns; the app must remain usable at 390 px mobile width, but mobile is not the primary authoring surface.
- Use a persistent left navigation rail, 216–224 px expanded and 64 px collapsed. It contains the seven views already listed in Section 4.1; do not add more top-level destinations. The collapsed preference may be remembered locally.
- Use a compact 56 px top bar for page context, active search-profile selection where relevant, and the command-palette trigger.
- Main content uses a maximum width of approximately 1440 px and 24–32 px desktop padding. Use a consistent 4/8 px spacing scale. Do not compress information to fit more cards above the fold.
- Job lists should be clean, scannable rows rather than a wall of cards. Target 48–56 px for compact rows and allow taller rows only when they contain a useful secondary line. Each row should prioritize title/company, location, freshness, fit, and one or two relevant actions. Use compact secondary metadata, not nested card layouts.
- Job inspection opens a right-side detail drawer at viewport widths of 1280 px and above (approximately 440–520 px wide). The list remains mounted and retains its scroll position and filters. The drawer has its own scroll region, a clear close affordance, Escape-to-close behavior, and focus returns to the invoking row. Below 1280 px, open a full-page job detail view rather than squeezing the list and drawer together.
- Evidence details use inline expansion/accordion sections within job detail and resume review; do not open a chain of nested modal dialogs.
- Overview must remain an actionable list, not a metrics dashboard. Do not add charts, large statistic tiles, or filler empty states.
- At viewport widths below 1280 px, default the left rail to its 64 px icon-only state while keeping an explicit expand/collapse control and accessible names. At widths below 768 px, replace it with an accessible navigation drawer. Job details and the resume editor become full-screen views with clear back navigation.

#### 4.9.5 Command palette and keyboard behavior

Provide a command palette opened by `Cmd+K` on macOS and `Ctrl+K` on Windows/Linux. It must support:

- Navigate to any of the seven primary views.
- Switch between existing search profiles.
- Search jobs by title/company.
- Run clearly named local actions such as “Add job URL” or “Create backup”.

The palette must not expose destructive actions without a confirmation step. It must have a visible keyboard hint, focus management, Escape-to-close, arrow-key navigation, Enter-to-select, and an accessible screen-reader label. Do not intercept the shortcut while focus is inside an input, textarea, select, or contenteditable region. Do not create a separate global chat interface.

#### 4.9.6 Iconography and control language

Use one consistent outline icon family (Lucide) at 16–20 px. Icons supplement visible text; important actions must not rely on an icon alone. Use no emoji as interface icons. Buttons must use specific action labels (“Tailor resume”, “Save job”, “Export PDF”), not vague labels (“Magic”, “Enhance”, “AI”). Each panel or drawer should have at most one visually primary action; use quiet text actions for secondary actions and reserve destructive styling for destructive actions. Standard buttons and form controls should be 36–40 px high, with compact icon-only controls at least 32 × 32 px and accessible names. Inputs and controls use clear labels, restrained borders, and a visible 2 px evergreen focus ring with a 2 px offset; never remove the browser focus indicator without an equally visible replacement. Status badges are neutral by default and use color only for a meaningful semantic state. Loading, success, warning, and error states must reflect actual operation state; never fabricate progress or success.

#### 4.9.7 Motion and micro-interactions

Use the **Motion for React** package (`motion`, imported from `motion/react`) for purposeful UI transitions and layout animation. Do not use the legacy `framer-motion` package alongside it. Pin the package through the lockfile and upgrade intentionally.

Motion rules:

- Primary view content transition: opacity from 0 to 1 with a 4–6 px vertical offset, 160–200 ms, using `cubic-bezier(0.22, 1, 0.36, 1)`. Implement this once in a shared client-side workspace page-transition boundary keyed to the active route. Animate the content region only; keep the application shell stable. Navigation must never wait for an animation to finish, and do not layer CSS View Transitions on top of Motion for the same route change.
- Drawers and popovers: opacity plus a small 4–8 px movement, 140–180 ms. Keep focus behavior independent of animation.
- List insertion/removal and filter/sort reordering within the same result set: use restrained layout transitions around 160–220 ms. Do not make the entire list bounce or stagger item-by-item.
- Search-profile switches may produce a substantially different result set; do not animate unrelated jobs as though they were reordered. Use a short content opacity transition for a profile switch, then render the new result set.
- Selected tabs/filter controls: animate a restrained shared indicator using Motion `layoutId`; keep labels and controls stable.
- Save/dismiss: immediate optimistic state change with a subtle icon/background response. On dismissal, collapse the row smoothly and provide an Undo action. Persist the action immediately and restore the prior state if persistence fails.
- Requirement-to-evidence accordions: animate height and opacity over approximately 140–180 ms; keep the expanded content readable and avoid large movement.
- Loading skeletons: match the geometry of the eventual row or panel. Use a subtle, low-contrast shimmer only for genuinely asynchronous waits; do not animate unrelated page regions.
- Do not animate every hover, number, or decorative element. Avoid bounce, elastic easing, parallax, scroll-linked movement, and long entrance choreography.

Keep Motion wrappers and the shared `MotionConfig` provider in isolated Client Components; do not import the client Motion entry from Server Components. Use `MotionConfig` with `reducedMotion="user"` and `useReducedMotion` for bespoke cases. When `prefers-reduced-motion: reduce` is enabled, disable layout/position transforms and skeleton shimmer; preserve only immediate state changes or short opacity changes where useful. The CSS reduced-motion media query must cover non-Motion CSS animations too.

#### 4.9.8 Explicit visual anti-patterns

The following are prohibited in MVP:

- Decorative gradients, glassmorphism, glowing borders, or large blurred backgrounds.
- Bright blue/purple brand palettes or multiple competing accent colors.
- Emoji icons, fake “AI sparkle” buttons, or ornamental AI badges.
- Circular/radial progress rings for job-fit scores. Use a clear numeric score with a horizontal evidence bar and requirement breakdown.
- Unrequested analytics charts, gamification, streaks, confetti, or vanity metrics.
- Heavy drop shadows, excessive nested rounded cards, or arbitrary card grids.
- Fake progress percentages, simulated activity, or generic “AI is thinking” animations when no task is running.
- Large empty hero sections that push useful job content below the fold.

#### 4.9.9 Accessibility and interaction quality

Target WCAG 2.2 AA for the core workflows. All actions must be keyboard operable; focus must be visible; dialogs/drawers must manage focus correctly; labels and error messages must be programmatically associated with fields; status changes must be announced through an appropriate live region; and color must never be the only indicator of state. Provide non-drag alternatives for all reordering actions. Test the command palette, drawer, filters, resume editor, and reduced-motion behavior with keyboard-only interaction.

### 4.10 Resume editor interaction model

The resume editor is a structured document editor, not a form-heavy wizard and not an unrestricted rich-text canvas.

**Desktop layout:** use a persistent split pane with the structured content editor on the left (approximately 44% width) and a live ATS-safe preview using the selected A4 or US Letter page geometry on the right (approximately 56%). Both panes scroll independently. Keep the job title, draft status, undo/redo where supported, and export controls in a compact sticky header. The preview must update from the same structured resume data used for export. At widths below 1100 px, replace the split view with clear “Edit” and “Preview” tabs; do not shrink either pane until it becomes unusable.

**Editing model:**

- Use structured fields for header, summary, experience, projects, education, skills, and achievements. Edit bullet text inline in its own textarea/input; do not introduce a general-purpose rich-text editor in MVP.
- Use `useSortable` from `@dnd-kit/react/sortable` and the `move` utility from `@dnd-kit/helpers` for section and bullet reordering. Attach the returned `ref` to the sortable row and `handleRef` to a dedicated drag-handle button. Use the `DragDropProvider` defaults for pointer and keyboard sensors, and retain the default accessibility plugin while configuring context-specific screen-reader instructions/announcements. Provide explicit Move up / Move down actions as an alternative to dragging. Do not start a new implementation on the legacy `@dnd-kit/core`, `@dnd-kit/sortable`, or `@dnd-kit/utilities` packages.
- Keep stable IDs for resume claims and sections. Reordering updates only `sort_order`; it must not recreate the claim or detach `resume_claim_evidence` rows.
- Editing a generated claim preserves its evidence references but changes its state to `user_edited_needs_review`. The user must confirm the edited wording remains supported before export. Removing a claim removes it from the draft but must not delete its source career facts or evidence records. Provide Undo after removal.
- A manually added factual bullet must be linked to at least one verified career fact before it can be treated as verified or exported as a verified claim. If the user explicitly retains an unverified draft, display a clear warning and require a final confirmation; never mark it verified automatically.
- Save edits automatically with a short debounce (approximately 400–600 ms) and show a quiet “Saving”, “Saved”, or actionable error state. Do not lose edits when a task/event connection drops.
- The preview must show page boundaries and page count but must not add ATS-hostile visual layout features. PDF export is generated from the structured document using the dedicated PDF renderer, not by screenshotting the visible preview.

**Drag-and-drop and motion interaction:** use `useSortable` from `@dnd-kit/react/sortable` for the active drag interaction and keyboard semantics. Retain its default keyboard sensor and accessibility plugin, and use `move` from `@dnd-kit/helpers` for item movement. Do not apply Motion layout transforms to the same active sortable element while dnd-kit is controlling its transform; use Motion only for post-drop list settling or non-drag list changes. Evidence chips/links are not separate draggable items.

---

## 5. Personalization model

### 5.1 What is customizable

Personalization must affect recommendations and generated documents, not merely the appearance of the settings page.

| Area | User-controlled settings |
|---|---|
| Role strategy | Titles, aliases, seniority, experience range, must-have and preferred skills |
| Geography | Countries, cities, radius if applicable, remote/hybrid/onsite, relocation willingness |
| Compensation | Currency, minimum, target, period, whether missing salary should be a hard exclusion or simply unknown |
| Company strategy | Include/exclude companies and user-maintained industry tags |
| Source strategy | Enabled sources and source-specific refresh intervals |
| Freshness | Maximum acceptable age and preferred recency window |
| Ranking | Weight of fit, freshness, location, compensation, and company preference |
| Resume style | One or two page preference, section order, concise/descriptive wording, chosen template, font and spacing within ATS-safe constraints |
| Cover letter style | Tone, length, first-person preference, and whether company-specific research may be used |
| AI behavior | Provider, model, temperature where supported, and data-sharing choice |
| Workflow | Review requirements and which actions require explicit confirmation |

### 5.2 Hard filters versus soft preferences

The UI must distinguish:

- **Hard filter:** Excludes a job from recommendations. Example: “Remote only” or “Exclude Company X”.
- **Soft preference:** Affects rank but does not exclude. Example: “Prefer remote” or “Prefer product companies”.

No user preference should become a hard filter by inference. The user must explicitly mark it as hard.

**Skill-specific semantics are job-centric:**

- `must_have` + `hard`: every configured skill must be detected in the job title, normalized requirements, or description before the job is eligible. If analysis has not completed, the job remains `pending_skill_filter_evaluation` and is not falsely treated as a mismatch; it is temporarily withheld from the recommended list until evaluated.
- `must_have` + `weighted`: the skill contributes to Search-profile skill alignment (Section 5.3) but does not exclude the job.
- `preferred` + `weighted`: the skill contributes a lower positive weight. `preferred` + `hard` requires at least one match for that entry.
- `excluded` + `hard`: any confirmed match excludes the job. `excluded` + `weighted`: the job remains eligible but receives the stated penalty.

Skill matching uses normalized strings and aliases, not candidate `skills.id`. A search profile can therefore target a skill the candidate has not yet documented, and an exclusion remains meaningful even when that skill is absent from the career profile. `Not assessed` is distinct from `Not present in job`.

### 5.3 Search-profile ranking weights

Default ranking weights:

| Factor | Default |
|---|---:|
| Candidate documented role/experience fit | 45% |
| Search-profile skill alignment | 15% |
| Freshness | 15% |
| Location/work-mode preference | 10% |
| Compensation fit | 10% |
| Company/industry preference | 5% |
| **Total** | **100%** |

The user may change weights. The UI must validate that enabled ranking weights total 100% before saving. When a factor has no trustworthy data for a job (for example, no salary is published), omit that factor for that job and renormalize the remaining active weights. Show which factors were included so the ranking is explainable.

MVP factor normalization:

- **Candidate documented fit:** use the documented-fit score from Section 8.2. This measures whether verified candidate facts support the job requirements. It does not measure whether the job contains the skills the user wants.
- **Search-profile skill alignment:** compare each `search_profile_skills` entry with normalized requirements, title, and description terms from the job. `must_have` contributes weight 2 and `preferred` contributes weight 1; a matched skill contributes 1, a partially matched/ambiguous skill contributes 0.5, and a confirmed absent skill contributes 0. Calculate `round(100 * weighted_matched / weighted_assessable)`. Do not count a skill as absent while its job analysis is pending or incomplete; omit it until assessed. A weighted `excluded` entry applies a 25-point penalty per match, capped at 100 points total. A hard `excluded` entry is filtered before ranking. If no positive skills are configured or assessable, omit this factor.
- **Freshness:** when the employer-posted date is reliable, score under 24 hours = 100, 1–3 days = 80, 4–7 days = 60, 8–14 days = 30, and over 14 days = 0. If the employer-posted date is unknown, use `first_seen_at` only for the user-configured maximum-job-age eligibility check; omit freshness from the weighted calculation and label discovery age separately. Never describe first-seen time as the employer-posted date.
- **Location/work mode:** exact match to a configured preference = 100; acceptable alternative = 75; known soft-preference mismatch = 0. Hard mismatches are filtered before ranking. If no preference is configured or the job location/work mode is unknown, omit the factor. An unknown value is not a mismatch. Country-level remote eligibility is evaluated separately from the city shown in the posting.
- **Compensation:** compare only an employer-disclosed or user-entered range to the user's configured thresholds. The user must configure a minimum acceptable amount and currency to enable this factor; target compensation is optional and defaults to the minimum acceptable amount. Validate that target is not below the minimum. Score only when both job bounds, currency, and pay period match the user's settings. MVP performs no currency or pay-period conversion. If the range is partial, currency/period differs, or no threshold exists, omit the factor. If the disclosed minimum meets/exceeds target = 100; if the range overlaps target = 75; if maximum reaches the user's minimum but does not overlap target = 50; if maximum is below the minimum = 0.
- **Company/industry:** explicit preferred company or industry = 100; neutral relative to configured preferences = 50; known soft dispreference = 0. A hard exclusion is filtered before ranking. If preferences or trustworthy company/industry data are absent, omit the factor.

For each job, calculate `priority_score = round(sum(weight_percent * factor_score for available factors) / sum(weight_percent for available factors))`. Omit unavailable factors and renormalize the remaining weights. If no numeric factors are available, do not invent a score: sort eligible jobs by deterministic title/alias relevance, skill evidence, and first-seen recency, label the ordering “Basic relevance (AI analysis unavailable/not run)”, and show “Not analyzed” rather than a numeric fit. The displayed priority score must state which factors were included and whether weights were renormalized.

### 5.4 No silent behavioral learning in MVP

MVP may record saves, dismissals, and user edits for history, but it must not silently change ranking weights or career facts based on behavior. Later versions may offer suggested preference adjustments with an explanation and explicit approval.

---

## 6. Career profile and evidence model

### 6.1 Core principle

A resume is an output document. The **Career Profile** is the source of truth.

Store career facts as structured, editable records. Do not depend on repeatedly parsing the latest PDF resume to understand the user's experience.

### 6.2 Project record

Each project should support:

- Name and short description.
- Problem or goal.
- User's role and individual contribution.
- Architecture and technical decisions.
- Technologies and tools.
- Challenges solved.
- Outcomes and business impact.
- Metrics, including units and measurement context when known.
- Dates or duration when known.
- Related skills and target roles.
- Evidence/source references.
- Verification state.

One project may have several verified accomplishment bullets. The system may generate role-specific phrasings from the same fact, but it may not create different facts for different job descriptions.

### 6.3 Evidence and verification states

Each extracted or manually added fact must have:

- `verification_status`: `needs_review`, `verified`, `rejected`, or `archived`.
- `origin`: `manual`, `resume_import`, `document_import`, or another explicitly supported source.
- Source document ID and excerpt when available.
- Extraction confidence, if machine-extracted; this is a parser confidence, not truth.
- Created and updated timestamps.

Only `verified` facts may be used as factual source material in generated resume claims. The user may explicitly choose to use a new, unverified manual draft, but the UI must label it as unverified and require confirmation before export.

### 6.4 Resume import

MVP supported formats:

- PDF with extractable text.
- DOCX.
- TXT / Markdown.

Scanned/image-only PDF support is not required for MVP. Detect it and explain that the user should provide a text-based PDF or DOCX. Do not silently return an empty profile.

The import pipeline:

1. Store the original document locally.
2. Extract text and document metadata.
3. If an AI provider is configured and the user has enabled data sharing for this task, optionally parse the extracted text into a typed structured representation. If AI is unavailable or declined, do not attempt ambitious deterministic resume understanding; retain the extracted text and let the user create profile facts manually.
4. Show AI-extracted fields alongside the source text, or show the raw extracted text with manual entry controls when AI is unavailable.
5. Require user verification before promoting any extracted facts into the verified profile.
6. Preserve the source file and source excerpts for traceability.

No-AI import is therefore text extraction plus manual profile entry—not automatic classification of arbitrary resumes. The import must never invent metrics, responsibilities, seniority, dates, or technology use. Show extraction failure and scanned/image-only PDF state explicitly.

---

## 7. Job discovery and source ingestion

### 7.1 Source strategy

Use a controlled source registry. The user chooses which company career pages and job boards to monitor. Do not attempt to crawl the whole internet or create an unmaintainable global directory.

MVP connector types:

1. **Greenhouse public job board** — user supplies the board token or public board URL. Use the public listing endpoint and request content where supported.
2. **Lever public postings** — user supplies the site identifier or public job-board URL. Fetch the public postings feed as JSON.
3. **Ashby public job postings** — user supplies the job-board identifier or public job-board URL. Use the public job-posting endpoint.
4. **Generic public career page** — user supplies a public URL. MVP supports pages with Schema.org `JobPosting` JSON-LD and RSS 2.0 / Atom feeds that expose stable job links. Parse only these explicit structures. Arbitrary HTML selectors, heuristic page scraping, JavaScript-rendered career portals, and bespoke ATS templates are not MVP support; mark them unsupported and offer manual URL/JD import.
5. **Manual import** — user pastes a job description and/or a public job URL. This must work even when no connector exists.

The initial release must not scrape LinkedIn or Naukri. For these sites, manual import means the user pastes the job description and stores the original URL as a reference; the app must not automatically fetch the restricted page. Job-alert email import may be added later. Naukri may be handled the same way unless an authorized supported integration is identified. Engagement counts such as likes and comments must not be treated as reliable estimates of applicant competition or used as a core ranking signal.

### 7.2 Source registry fields

Each source record includes:

- `id`
- `source_type` (`greenhouse`, `lever`, `ashby`, `generic_career_page`, `manual`, later `gmail`)
- `display_name`
- `company_id` (optional)
- `source_identifier` (board token/site name/board name, where applicable)
- `base_url`
- `enabled`
- `refresh_interval_minutes`
- `last_attempt_at`
- `last_success_at`
- `last_successful_full_scan_at`
- `consecutive_failures`
- `last_error_code` and safe, sanitized error detail
- `created_at`, `updated_at`

The settings UI must allow the user to test a source before enabling scheduled scans. Refresh intervals must respect source-specific minimums and cannot be configured faster than the fetching rules permit.

### 7.3 Fetching rules

- Only fetch public pages or documented public posting endpoints.
- Do not log in, bypass access controls, solve CAPTCHAs, evade rate limits, or reuse a user's authenticated browser session.
- Respect source terms, robots directives where applicable, and rate limits. If the permitted access method is unclear, leave the connector disabled pending review.
- Use source-specific request intervals, conditional requests (ETag / Last-Modified) when supported, request timeouts, bounded retries, and exponential backoff. Never let a user-configured interval override a source's published rate limit or terms. Where no source-specific minimum is documented, use at least the conservative defaults below; manual scans must obey the same per-source cooldown. Run no more than one fetch at a time per source.
- Identify the application with a descriptive user-agent where appropriate.
- Do not fetch arbitrary URLs from job description content.
- Validate and normalize every redirect destination. Block loopback, private, link-local, multicast, and reserved IP ranges to reduce SSRF risk. Revalidate DNS results and redirects before following them.
- Do not execute scripts from crawled pages. Treat fetched HTML as untrusted input and sanitize before rendering.

Default refresh intervals should be conservative and editable. Suggested defaults: 6 hours for documented ATS feeds and 12 hours for generic career pages. The user may run a source manually. Do not promise minute-by-minute discovery.

### 7.4 Connector contract

Every connector must implement the same typed interface:

```ts
interface JobSourceConnector {
  validate(config: SourceConfig): Promise<ValidationResult>;
  fetch(config: SourceConfig, cursor?: string): Promise<FetchBatch>;
  normalize(raw: unknown, config: SourceConfig): NormalizedJob[];
}

interface FetchBatch {
  jobs: unknown[];
  nextCursor?: string;
  isCompleteSnapshot: boolean;
  fetchedAt: string; // ISO-8601 UTC
  sourceEtag?: string;
  sourceLastModified?: string;
}
```

The connector must preserve source IDs, original URLs, and the raw response (or a bounded, sanitized raw representation) for debugging. A connector must not report a complete snapshot if the source response was paginated incompletely or partially failed.

### 7.5 Normalized job schema

Required canonical fields:

- `id`
- `title`
- `company_id` / company name
- `description_text`
- `description_html_sanitized` (optional)
- `location_text`
- `country_code` (nullable)
- `workplace_type` (`remote`, `hybrid`, `onsite`, `unspecified`)
- `employment_type` (nullable)
- `seniority_min` / `seniority_max` (nullable; only if reasonably extractable)
- `salary_min`, `salary_max`, `salary_currency`, `salary_period`, `salary_source_type` (nullable)
- `employer_posted_at` (nullable; only after reliable source-date selection)
- `source_updated_at` (nullable; never substituted for posted date)
- `first_seen_at`
- `last_seen_at`
- `last_verified_at`
- `status` (`open`, `possibly_closed`, `closed`, `unknown`)
- `canonical_url`
- `created_at`, `updated_at`

Keep separate source records in `job_source_records`, each with connector/source ID, source job ID, source URL, raw metadata, source-specific posted-date value/text, source-specific timestamps, and last-seen state. Never overwrite source lineage when canonical jobs are merged. The canonical employer-posted date must come from a clearly identified source field. If reliable sources disagree materially, preserve both values and show a date conflict instead of silently choosing one. A source update timestamp must never be substituted for a posting date.

### 7.6 Freshness rules

The UI must distinguish these timestamps:

- **Employer posted:** A date explicitly supplied by the source and interpreted as the original posting date.
- **First discovered:** The first timestamp this local app successfully observed the job.
- **Last seen:** The most recent successful source fetch that included the job.
- **Last verified:** The last successful confirmation that the job is still published.
- **Source updated:** A source update timestamp, if provided; it is not automatically equivalent to a new posting date.

Never label `first_seen_at` as “posted”. If `employer_posted_at` is absent, show “Posting date not provided; first discovered [time]”.

Freshness labels based on employer-posted date:

- Under 24 hours: Very recent
- 1–3 days: Recent
- 4–7 days: This week
- More than 7 days: Older
- No reliable employer date: Date unknown

The user may choose a stricter maximum job age per search profile. If a posting date is unknown, the app may still recommend it according to first-seen recency, but it must label that basis explicitly.

### 7.7 Closing and reopening jobs

- A network or parser failure must never mark a job closed.
- A job missing from one successful complete source snapshot becomes `possibly_closed`.
- A job may become `closed` only after it is absent from at least two consecutive successful complete snapshots separated by the source's normal refresh interval, or when the source explicitly marks it closed.
- When a job reappears, set its source record to active and preserve historical timestamps and source records.
- A canonical job remains `open` while at least one linked source record is confirmed published. Mark the canonical job `closed` only when all tracked source records are explicitly closed or meet the two-complete-snapshot removal rule.
- Jobs linked to an application must remain in the local database even after the posting closes.

### 7.8 Duplicate detection

Deduplication must favor precision over aggressive merging.

Matching order:

1. Exact source + source job ID.
2. Exact canonicalized, job-specific application URL (not a generic company application portal URL).
3. Exact company + normalized title + compatible location as a candidate duplicate.
4. Fuzzy title/description similarity as a candidate duplicate only.

Rules:

- Only an exact source identifier within the same source, or an exact canonicalized application URL, may be merged automatically.
- Company + title + location matching is not sufficient to auto-merge because a company may have multiple distinct requisitions with identical titles and locations. Show these matches for review.
- Fuzzy matches must not be auto-merged in MVP. Show a merge suggestion for review, with the evidence used to suggest the match.
- If two jobs might be distinct requisitions, keep them separate.

Each candidate pair is persisted in `job_duplicate_candidates`; a dismissed pair is not re-suggested unless one side's normalized content hash changes materially. Merge is one transaction: re-parent source records, requirements, matches, and discovery states; keep the older/most-linked canonical job ID unless a stable source identifier requires the other; retain a soft-merged alias row. If both jobs have `user_job_states` for the same search profile, merge states by precedence `saved` over `hidden` over `dismissed` and preserve both notes in the audit record. If both have an `applications` row for the same profile, do not auto-delete or collapse either application. Abort the merge and require manual resolution because they may represent distinct requisitions. If there are separate application rows, preserve both and update the canonical job reference only after the user confirms that the jobs are the same requisition.
- Preserve every source URL and original posting ID after a merge. Re-parent linked source records and dependent job-state/match records transactionally; retain a soft-merged old job ID as an alias so historical links resolve to the canonical job. Never hard-delete a job that has application or document history.

---

## 8. Job analysis, matching, and ranking

### 8.1 Job description analysis

Parse each job description into a validated structure:

```ts
interface JobAnalysis {
  roleTitle: string;
  seniority?: { minYears?: number; maxYears?: number; level?: string };
  locations: string[];
  workplaceType: "remote" | "hybrid" | "onsite" | "unspecified";
  employmentType?: string[];
  requirements: Array<{
    id: string;
    text: string;
    normalizedSkill?: string;
    category: "skill" | "experience" | "education" | "responsibility" | "domain" | "other";
    priority: "must_have" | "preferred" | "responsibility" | "unspecified";
    extractionConfidence: number;
  }>;
  compensation?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: "hour" | "month" | "year" | "unknown";
    evidenceText: string;
  };
  explicitConstraints: string[];
  analysisVersion: string;
}
```

The extraction model must not invent an employer, location, salary, experience requirement, or posting date. Ambiguous details remain unknown and are shown as such.

### 8.2 Documented-fit score

The score describes how well the candidate's **documented career profile** supports the requirements in the job description. It is not an ATS score, probability of interview, probability of hiring, or guarantee of qualification.

For each clear requirement, the matcher assigns one state:

- `supported` = 1.0
- `partially_supported` = 0.5
- `not_found_in_profile` = 0.0
- `ambiguous` = excluded from the score denominator and shown for review

Requirement weights:

- Must-have = 3
- Responsibility = 2
- Preferred = 1
- Unspecified = 1

Formula:

`documented_fit = round(100 * sum(requirement_weight * support_value) / sum(requirement_weight for non_ambiguous requirements))`

If there are no assessable requirements, do not display a numeric score. Display “Not enough information to score”. The user must be able to correct requirement extraction and priority labels before relying on a score. Search-profile skill alignment is calculated separately under Section 5.3 and must not be silently substituted for candidate documented fit. Overview and job detail must show these as distinct dimensions: (1) documented candidate evidence fit and (2) alignment with the skills this search profile is targeting or excluding. The combined priority score uses both through their separate, explicit weights; do not collapse them into one opaque “fit” number.

“Not found in profile” means the profile does not currently contain supporting evidence. It does **not** assert that the candidate lacks the skill. The detail view must let the user record a distinct candidate response: `not_reviewed`, `candidate_confirms_has`, or `candidate_confirms_does_not_have`. If the user confirms they have the experience, they must link or add a career-profile fact; after verification, the matcher may move the requirement to `supported` or `partially_supported`. If the user confirms they do not have it, retain that explicit response separately from the original profile-search result. Both `not_found_in_profile` and `candidate_confirms_does_not_have` contribute zero to documented fit, but the UI must label them differently and must never infer one from the other. A fresh AI analysis must preserve a still-matching user response/assessment override; unmatched overrides become `orphaned` and require review.

The persisted requirement model must therefore distinguish the machine assessment (`supported`, `partially_supported`, `not_found_in_profile`, `ambiguous`) from the user response (`not_reviewed`, `candidate_confirms_has`, `candidate_confirms_does_not_have`) and any manual priority override. Do not overload one enum for all three concepts.

Show:

- Score and plain-language label.
- Requirement-by-requirement match state.
- Supporting career-profile facts and project links.
- Requirements not found in the profile.
- Ambiguous requirements excluded from scoring.
- Analysis timestamp and model/version.

### 8.3 Recommendation ranking

Apply hard filters first. Jobs failing an explicit hard filter are excluded from the recommended list but remain searchable unless the user chooses to hide them. A job whose hard skill filter cannot yet be evaluated remains visible in Discover with a “Pending analysis” label and is withheld from the ranked recommendation set until evaluated.

For eligible jobs, calculate a personal priority score from the configurable weights in Section 5.3. Store the score inputs, weight version, analysis version, and calculation version. Recalculate when the job description, verified profile, or search profile changes. Explain the top factors contributing to the result.

Location, seniority, years of experience, and employment type follow these rules:

- **Location hierarchy:** a city preference is more specific than a region/state, which is more specific than a country. An explicitly permitted remote country can satisfy a remote preference even when the employer headquarters is elsewhere. Compare the job's actual work location/eligibility, not just company headquarters.
- **Remote/hybrid/onsite:** a hard preference rejects only a known incompatible workplace type. A remote role with an explicit country restriction must satisfy the user's configured remote-eligible countries. Hybrid and onsite roles must satisfy the configured commute/location region.
- **Relocation:** never infer willingness. If relocation is required and the user has not enabled relocation, mark the requirement unknown and do not auto-reject unless the user has configured relocation as a hard `no`.
- **Seniority/years of experience:** compare explicit JD level/range to configured target level/range. A known incompatibility can be hard-filtered only when the user explicitly marks it hard. Do not infer seniority solely from title when the JD is ambiguous.
- **Employment type:** when a preferred type is configured, a known different type is a soft mismatch or a hard exclusion according to the user setting. A missing type is unknown, not a mismatch.
- **Missing fields:** unknown location, seniority, years, workplace type, or employment type remains eligible by default and is labeled “Not specified”. Provide an explicit optional fail-closed setting for users who prefer hard filters to reject unknowns.

For all scores, use deterministic calculations after structured extraction; store inputs and version identifiers; and never compare different scoring versions without identifying the version.

### 8.4 Search ranking and AI boundary

Use SQLite FTS5 for local full-text search. Use deterministic normalization and aliases for common skills. LLM extraction improves semantic requirement classification, but it is optional. If no provider is configured, create a deterministic analysis from source-provided structured fields, explicit skill aliases, and simple text/phrase rules; mark its method as `deterministic` and expose confidence/unknown states. This fallback does not claim to understand arbitrary language. The user can edit requirements manually or rerun analysis after configuring AI.

In no-AI mode, manual profile entry, resume text extraction, job discovery, exact/alias skill matching, hard filters, priority ranking from available structured factors, saving, dismissing, and application tracking remain usable. Do not show fabricated averages or a numeric fit score when no assessable evidence exists. The Overview shows an “Analysis needed” state and orders unscored jobs by deterministic title/alias relevance, assessed search-skill alignment, and local first-seen time. The UI must identify this ordering as basic relevance, not an AI match.

---

## 9. Resume generation and application materials

### 9.1 Resume tailoring workflow

1. User opens a job and requests “Tailor resume”.
2. App retrieves the job analysis and relevant verified career facts.
3. App shows which projects, achievements, and skills it proposes to emphasize.
4. The generator produces a structured resume draft using the selected evidence.
5. A validator checks that every generated factual bullet has one or more valid verified evidence references.
6. The user reviews and edits the draft.
7. The user exports DOCX and/or PDF.
8. The version is saved and associated with the job and the job-description snapshot.

### 9.2 Factuality requirements

The generator must never:

- Invent numbers, percentages, scale, revenue, traffic, time savings, team size, or performance improvements.
- Claim ownership of work not supported by the profile.
- Add a technology merely because it appears in the JD.
- Change dates, titles, employers, qualifications, or seniority.
- Turn “familiar with” into “expert in”.
- Claim a project was production-scale unless the source facts support it.

If a useful requirement has no supporting evidence, show it in the gap analysis rather than manufacturing a resume bullet.

Every generated bullet must include internal `source_item_ids`. The UI need not print those IDs, but the user must be able to inspect the supporting profile facts. A structural validator must reject claims with no valid evidence reference and flag newly introduced numbers, dates, employers, or technologies that are not supported by the cited facts. These checks reduce risk but cannot prove semantic truth; user review remains mandatory.

### 9.3 Resume format

MVP provides one ATS-safe, one-column template. Allow limited safe customization:

- Font family from a small readable set.
- Font size and line spacing within validated bounds.
- Page margins.
- Section order.
- Accent color for headings, without color-only meaning.

Avoid multi-column layouts, text boxes, icons in place of text, charts, skill bars, and tables in the exported resume. These can reduce parsing reliability.

Export formats:

- DOCX as the editable source document.
- PDF as a shareable final document.

The PDF and DOCX must be generated from the same structured resume data. Do not use a screenshot of the preview as the exported PDF.

### 9.4 Cover letter

Generate on demand from:

- The job description.
- Company and role details actually available in the job record.
- Relevant verified career facts.
- The search profile's tone and length preferences.

Do not invent company culture, products, hiring-manager names, or company achievements. If company-specific information is unavailable, write a role-focused letter without pretending research was done.

### 9.5 Application answer drafts

Support a small set of common application prompts, such as:

- Why are you interested in this role?
- Why this company?
- Why are you a good fit?
- Describe relevant experience.

These are application materials, not interview preparation. Each answer must be based on verified profile facts and be editable. The app must not answer work authorization, legal declarations, demographic questions, or other sensitive/mandatory form questions on the user's behalf.

### 9.6 Resume versioning

The working `resume_drafts` row is mutable and autosaved. MVP supports job-specific resume drafts only; general resumes are reserved for a later release. Each successful export creates an immutable `resume_versions` snapshot containing:

- Search profile ID.
- Job ID (required in MVP; standalone/general resume creation is not an MVP workflow).
- Job-description snapshot and hash.
- Career-profile snapshot and hash.
- Generator/model and prompt version.
- Structured resume content and evidence references for every claim.
- User-edit/verification state at export time.
- Monotonic version number and creation timestamp.

`document_exports` records the generated DOCX/PDF file and file hash against that immutable version. An application must reference the exact `resume_version_id` and preserve an immutable snapshot/hash of the cover letter and application answers confirmed as submitted. Editing a working draft or regenerating materials must never mutate an exported version or a submitted application snapshot. If the current draft content hash is identical to the latest version, the app may reuse that version instead of creating a duplicate. Exported files must remain available even if the job or source posting is later removed.

---

## 10. Compensation handling

### 10.1 MVP behavior

Display compensation only when a source explicitly provides it or the user manually enters it. Store currency, minimum, maximum, pay period, and source.

Label it as:

- **Employer/source disclosed** when supplied in the job posting.
- **User supplied** when entered manually.
- **Unknown** when no reliable information exists.

Do not ask an LLM to guess a salary range.

### 10.2 Future estimation gate

Compensation estimation is not enabled in MVP. It may be added only after a permitted, credible salary dataset or enough explicitly sourced comparable observations are available. An estimate must include sample size, recency, geography, role/seniority comparability, source, calculation method, and confidence. If evidence is insufficient, show “No reliable estimate” rather than a fabricated range.

---

## 11. Application workflow and tracking

### 11.1 Manual application workflow

- User saves a job in `user_job_states`; no `applications` row is created yet.
- User chooses “Start application” or “Prepare application”, creating one application row in `preparing`.
- User prepares a tailored resume and optional cover letter/answers.
- User opens the original application URL.
- User completes and submits the employer's application directly.
- User returns to the app and marks the job as applied, then confirms which resume, cover letter, and application answers were actually submitted.
- App records the applied date and freezes the exact confirmed materials in an immutable submitted-material snapshot; generated but unused drafts are not treated as submitted.

The app does not submit applications through employer APIs in MVP. Public job-board listing APIs do not imply permission or credentials to submit an application. For example, Greenhouse's public listing API and its application submission endpoint have different authentication requirements.

### 11.2 Application record

One application record should be associated with one canonical job and one search profile. Saving a job alone does not create this row; the row is created when preparation begins. Its status enum excludes `saved` and starts at `preparing`. It should include:

- Current status.
- Applied date.
- Resume version ID, if any.
- Cover letter and application-answer references, if any.
- On transition to `applied`, an immutable `submitted_materials_snapshot_json` and content hash containing the exact resume version ID and copies/hashes of the cover letter and answer text the user confirms were submitted.
- Original apply URL.
- User notes.
- Status-change history.

Do not automatically infer that an application was submitted merely because the user opened the employer URL.

---

## 12. Gmail integration — later release

Gmail is not required to use the MVP. When implemented, it must be optional and read-only.

Requirements:

- User configures their own Google OAuth client credentials.
- Request the narrowest practical read-only Gmail scope (`gmail.readonly` where full message retrieval is needed).
- Let the user configure a search query and/or label so the app does not scan the entire mailbox indiscriminately.
- Retrieve only matching messages and only the minimum required message content.
- Extract job title, company, description, source, link, and salary when present.
- Deduplicate against existing jobs.
- Store source message ID/thread ID and sync timestamp, not a full mailbox mirror.
- Never send, delete, archive, label, or modify Gmail messages.
- Provide a clear disconnect action and delete stored OAuth tokens when disconnected.
- Encrypt refresh tokens at rest and never expose them to browser JavaScript or logs.

Google OAuth has setup and lifecycle constraints. In particular, an external OAuth project left in Testing mode can issue refresh tokens that expire after seven days for scopes beyond basic identity scopes. The setup guide must explain this limitation and the user must be able to reconnect if authorization expires. Do not represent Gmail synchronization as permanently reliable until the OAuth project is configured appropriately.

---

## 13. Technical architecture

### 13.1 Recommended stack

Use the exact stable baseline below as the initial implementation target. Versions were checked against current package release metadata and the framework/package compatibility notes linked in Section 26 on **25 November 2026**. Do not use `latest`, `canary`, `beta`, `alpha`, or floating semver ranges in the initial manifest. Exact direct-dependency pins plus a committed lockfile make the bootstrap reproducible.

| Layer | Technology and pinned version | Reason / compatibility rule |
|---|---|---|
| Web application | `next@16.4.6` | Next.js 16 App Router; exact patch aligned with `eslint-config-next` |
| UI framework | `react@19.3.1`, `react-dom@19.3.1` | Keep React and React DOM on the exact same stable version; Next 16's install guide recommends the current React packages |
| Styling | `tailwindcss@4.3.5`, `@tailwindcss/postcss@4.3.5`, `postcss@8.5.33` | Tailwind v4 PostCSS integration; Tailwind core and its PostCSS adapter must have the same exact version |
| Accessible primitives | `radix-ui@1.8.1` | Custom-designed accessible primitives; keep visual styling in the product's own components and tokens |
| Motion | `motion@14.14.0`, imported from `motion/react` | React 19-compatible Motion package; do not install legacy `framer-motion` alongside it |
| Drag and drop | `@dnd-kit/react@0.5.3`, `@dnd-kit/helpers@0.5.3` | Matched dnd-kit release pair; React adapter peer range supports React 18 and 19 |
| Icons | `lucide-react@1.78.0` | Consistent outline icons; no emoji icons |
| Fonts | `geist@1.9.2` | Bundled Geist Sans + Geist Mono; no remote font request |
| Runtime | Node.js `24.22.3` LTS; npm `11.19.1` | Exact local development/runtime baseline. Accept later Node 24 security patches after smoke tests; do not use a non-LTS/odd release line |
| Database | `better-sqlite3@13.2.0` | Local SQLite storage; native module must be installed/built for the selected Node 24 runtime |
| Database access | `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11` | Stable Drizzle ORM + stable migration CLI; do not use the 1.0 release-candidate line for MVP |
| Full-text search | SQLite FTS5 | Local search without a separate search service |
| Background work | Dedicated local Node worker + SQLite-backed task queue and event log | Jobs continue when browser tab is closed; no Redis required |
| Browser updates | Server-Sent Events (SSE) via a Next.js Node.js Route Handler | Push task/source progress from the separate worker to the browser |
| Validation | `zod@4.6.7` | Runtime validation for APIs, source data, events, and LLM structured output |
| Document parsing | `pdfjs-dist@6.5.438`, `mammoth@1.13.0` | Local processing of text PDFs and DOCX files |
| HTML parsing/sanitization | `cheerio@1.2.0`, `sanitize-html@2.18.2` | Parse supported generic career-page HTML and sanitize untrusted job-description fragments before rendering |
| Backup archive | `tar@7.5.23` | Produce/validate portable `.tar.gz` backups with path and extraction limits |
| LLM client | Node built-in `fetch` | OpenAI Responses API and OpenAI-compatible adapter; no provider SDK dependency in MVP |
| Document export | `docx@9.16.0` and `playwright@1.65.1` | DOCX generation and Playwright-managed Chromium for PDF export |
| Browser test runner | `@playwright/test@1.65.1` | Must match the production `playwright` package exactly so the browser revision remains aligned |
| Unit/integration testing | `vitest@5.1.1` | Unit and service-level tests; keep browser E2E tests in Playwright |
| Local process runner | `concurrently@10.0.7` | Starts/stops web and worker processes together on supported operating systems |
| Development TypeScript runner | `tsx@4.23.15` | Runs/watches the TypeScript worker during development |
| TypeScript compiler | `typescript@5.9.3` | Conservative, widely supported TypeScript line; exceeds Next 16's 5.1 minimum without adopting the newer TypeScript 7 ecosystem prematurely |
| React/Node/native-module types | `@types/react@19.3.1`, `@types/react-dom@19.3.0`, `@types/node@24.19.2`, `@types/better-sqlite3@9.6.0` | Types align to React 19 and Node 24; React DOM types must retain their `@types/react` peer dependency |
| Linting | `eslint@10.15.0`, `eslint-config-next@16.4.6` | Next 16.4.0+ supports ESLint 10; keep the Next config package on the same patch as Next |

Do not add PostgreSQL, Redis, a hosted vector database, microservices, Kubernetes, a desktop wrapper, or a general-purpose rich-text editor. Do not add a charting library for the MVP dashboard. The local workload does not justify them.

#### 13.1.1 Runtime and package-manager baseline

The repository must include:

- `.nvmrc` containing `24.22.3`.
- `package.json` with `"engines": { "node": ">=24.22.3 <25" }` and `"packageManager": "npm@11.19.1"`.
- `.npmrc` containing `save-exact=true` so future direct dependencies are saved without `^` or `~` ranges.
- A committed `package-lock.json` generated by the pinned npm version.
- `engines-strict=true` in `.npmrc` so unsupported Node versions fail early.

Node 24 is selected because it is an LTS line supported by the current Playwright release and satisfies Next.js 16, ESLint 10, and the selected native SQLite package baseline. Do not silently change the runtime to Node 26 just because it is a newer LTS line; treat a runtime-major change as a dependency upgrade requiring native-module, PDF, build, and E2E verification.

#### 13.1.2 Exact initial dependency manifest

Use this as the dependency portion of the initial `package.json`. Keep all direct dependency versions exact; the lockfile pins transitive dependencies. `playwright` is a production dependency because PDF export is a production feature. `@playwright/test` is a development dependency, but both must remain on the same exact version.

```json
{
  "private": true,
  "engines": {
    "node": ">=24.22.3 <25"
  },
  "packageManager": "npm@11.19.1",
  "dependencies": {
    "@dnd-kit/helpers": "0.5.3",
    "@dnd-kit/react": "0.5.3",
    "concurrently": "10.0.7",
    "cheerio": "1.2.0",
    "docx": "9.16.0",
    "drizzle-orm": "0.45.4",
    "geist": "1.9.2",
    "lucide-react": "1.78.0",
    "mammoth": "1.13.0",
    "motion": "14.14.0",
    "next": "16.4.6",
    "pdfjs-dist": "6.5.438",
    "playwright": "1.65.1",
    "radix-ui": "1.8.1",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "sanitize-html": "2.18.2",
    "better-sqlite3": "13.2.0",
    "tar": "7.5.23",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@playwright/test": "1.65.1",
    "@tailwindcss/postcss": "4.3.5",
    "@types/better-sqlite3": "9.6.0",
    "@types/node": "24.19.2",
    "@types/react": "19.3.1",
    "@types/react-dom": "19.3.0",
    "@types/sanitize-html": "2.16.2",
    "drizzle-kit": "0.31.11",
    "eslint": "10.15.0",
    "eslint-config-next": "16.4.6",
    "postcss": "8.5.33",
    "tailwindcss": "4.3.5",
    "tsx": "4.23.15",
    "typescript": "5.9.3",
    "vitest": "5.1.1"
  }
}
```

The `package.json` scripts remain as defined in Section 13.2. The direct dependency additions are `cheerio@1.2.0` and `sanitize-html@2.18.2` for supported HTML parsing/sanitization, and `tar@7.5.23` for `.tar.gz` backups. `sanitize-html` typings are pinned as `@types/sanitize-html@2.16.2`. The LLM adapters use the built-in Node `fetch`; do not add an SDK solely for the two initial HTTP adapters. Add `"lint": "eslint ."`, `"typecheck": "tsc --noEmit && tsc -p worker/tsconfig.json --noEmit"`, and `"test": "vitest run"`. The root typecheck and the worker typecheck are both required because the worker has a separate TypeScript compilation boundary. Next.js 16 no longer provides the `next lint` command; invoke ESLint directly. Keep `next dev` and `next build` without a `--turbopack` flag: Turbopack is the default in Next.js 16. Do not add a custom Webpack configuration unless a documented dependency requirement forces it.

#### 13.1.3 Compatibility invariants

These pairs must not drift independently:

1. `next` and `eslint-config-next` stay on the same exact patch version (`16.4.6` for this baseline). `eslint-config-next@16.4.0` and later supports ESLint 10; keep `eslint@10.15.0` and do not downgrade ESLint to an unsupported line.
2. `react` and `react-dom` must be exactly the same version (`19.3.1`). Keep their type packages on the React 19.3 type line (`@types/react@19.3.1`, `@types/react-dom@19.3.0`).
3. `tailwindcss` and `@tailwindcss/postcss` must be exactly the same version (`4.3.5`). Do not mix Tailwind v3 setup instructions or the old `tailwindcss` PostCSS plugin configuration with v4.
4. `@dnd-kit/react` and `@dnd-kit/helpers` are pinned to the matching `0.5.3` release. The React adapter declares React 18/19 peer support. Keep the Section 4.10 imports and `useSortable`/`handleRef`/`move` usage aligned with the 0.5.3 documentation and type declarations.
5. `playwright` and `@playwright/test` must both be exactly `1.65.1`; reinstall the managed Chromium revision whenever either is upgraded.
6. `drizzle-orm@0.45.4` and `drizzle-kit@0.31.11` are the stable release pair for this baseline. Do not substitute an unrelated Drizzle 1.0 release candidate.
7. `typescript@5.9.3` is intentional. Next.js 16 requires TypeScript 5.1 or later; React 19.3 type packages publish a TypeScript 5.9-compatible line. Do not upgrade TypeScript independently without a full typecheck/build.
8. Native modules must be installed under the selected Node 24 runtime. Rebuild/reinstall dependencies after changing Node versions; do not copy `node_modules` between different operating systems, CPU architectures, or Node major versions.

#### 13.1.4 Initial dependency verification gate

A version table and peer ranges do not replace an actual install on the target machine. Before Slice 1, create the repository with the manifest above, run `npm install`, and commit the generated lockfile only after these checks pass:

```bash
node --version                 # must be v24.22.3 (or a verified later 24.x patch)
npm --version                  # must be 11.19.1 (or a verified later 11.x patch)
npm ci
npm ls next react react-dom eslint eslint-config-next motion @dnd-kit/react @dnd-kit/helpers better-sqlite3 drizzle-orm drizzle-kit playwright @playwright/test
npm run lint
npm run typecheck
npm test
npm run build
npm run setup:pdf-browser
npm run test:e2e
```

The dependency gate passes only when `npm ls` reports no invalid/missing peer dependencies, the native `better-sqlite3` binding loads from both web and worker processes, the production Next build succeeds under Turbopack, the worker starts and shuts down cleanly, PDF export succeeds using the managed Chromium binary, and the Playwright E2E suite passes. If an upstream package release changes peer requirements after this dated baseline, update the entire affected compatibility group together and document the reason; do not use `--force` or `--legacy-peer-deps` to hide conflicts.

### 13.2 Application processes and local runner

Run two local Node processes from one documented command:

1. **Web process:** Next.js serves the UI and local API on `127.0.0.1`, default port `3000` (overridable with `PORT`). Print the actual bound URL at startup. Never bind to `0.0.0.0` by default.
2. **Worker process:** a dedicated Node process polls the SQLite task queue, fetches sources, processes jobs, and runs scheduled tasks.

Use `concurrently` as the cross-platform process supervisor. The package scripts must follow this behavior (exact quoting may be adapted to the selected package manager):

```json
{
  "dev": "concurrently --kill-others --names web,worker \"next dev --hostname 127.0.0.1\" \"tsx watch worker/bootstrap.ts\"",
  "build:worker": "tsc -p worker/tsconfig.json",
  "build": "next build && npm run build:worker",
  "setup:pdf-browser": "node scripts/setup-pdf-browser.mjs",
  "test:e2e": "node scripts/run-playwright-tests.mjs",
  "start:local": "concurrently --kill-others --names web,worker \"next start --hostname 127.0.0.1\" \"node worker/dist/worker/bootstrap.js\""
}
```

`concurrently` is a runtime dependency because `start:local` uses it. `tsx` may remain a development dependency. The production build compiles with `worker/tsconfig.json` using `rootDir: ".."` and `outDir: "./dist"`. The bootstrap therefore emits to `worker/dist/worker/bootstrap.js`, worker modules emit under `worker/dist/worker/`, and imported shared server modules emit under `worker/dist/server/`. `start:local` must execute `node worker/dist/worker/bootstrap.js`. This output layout is intentional and must be covered by a build-and-start smoke test.

Process lifecycle requirements:

- Use Next.js 16 App Router APIs. Route `params`, page `searchParams`, `cookies()`, `headers()`, and `draftMode()` are asynchronous; always await them. Do not copy synchronous Next.js 15 compatibility examples into this codebase.
- Next.js 16 uses Turbopack by default for `next dev` and `next build`. Keep the application configuration Turbopack-compatible; do not add custom Webpack-only plugins or flags by habit.

- Ctrl+C, SIGINT, or SIGTERM must be forwarded so both child processes terminate. Because both commands are long-running, the supervisor must terminate the other process whenever either child exits (including an unexpected clean exit) rather than leaving a half-running app.
- The worker entry is `worker/bootstrap.ts`. It must have no static imports of application modules: first resolve `APP_DATA_DIR` and set `PLAYWRIGHT_BROWSERS_PATH`, then dynamically import `worker/index.ts`. This guarantees the managed browser path is established before any task handler or PDF module can load Playwright. The worker handles SIGINT and SIGTERM: stop claiming tasks, stop scheduling new work, allow active work a bounded shutdown window, release/requeue unfinished task leases, close the SQLite connection, and exit. A hard crash is recovered through lease expiry.

**Worker TypeScript compilation contract:** `worker/tsconfig.json` must set `rootDir` to the repository root (`".."` relative to the config), `outDir` to `"./dist"` (relative to `worker/tsconfig.json`), `module` to `"CommonJS"`, `moduleResolution` to `"Node"`, and `target` to `"ES2022"`. Its include set must cover `worker/**/*.ts` and the shared `server/**/*.ts` modules imported by the worker. With this layout, `worker/bootstrap.ts` emits to `worker/dist/worker/bootstrap.js` and `server/services` emits under `worker/dist/server/services`. The package root must not set `"type": "module"` for this build; worker-shared modules must use relative imports and must not rely on Next.js `@/` aliases. Keep Next.js app imports under its separate bundler configuration. The `build:worker` gate must assert the emitted path exists and run a worker boot/shutdown smoke test against a temporary database.
- Test shutdown on the supported operating systems. Do not rely on an orphaned worker process.
- The worker and web server are separate processes and therefore use separate SQLite connections to the same database file. They do not share a JavaScript connection object. WAL mode, a busy timeout, short transactions, and lease-based queue claims coordinate access.
- In the pinned Next.js 16 configuration, explicitly set `serverExternalPackages: ["better-sqlite3", "playwright", "pdfjs-dist"]` in `next.config.ts`. These Node-only packages must remain behind server-only modules; verify PDF text extraction and export in the production build. These are Node-only runtime dependencies and must never enter client bundles. Verify the production build and PDF export rather than relying only on development behavior. Keep every database/PDF import behind server-only modules and lazy-load Playwright after `PLAYWRIGHT_BROWSERS_PATH` is set.
- Never keep a SQLite transaction open while awaiting a network request or LLM call.

**Next.js development HMR and SQLite:** the server-side `better-sqlite3` connection must be cached on `globalThis` in development so module hot reload does not repeatedly open connections or retain stale file handles. Production uses one module-level connection per web process. The worker owns one separate connection per worker process. Do not import the database module into Client Components or Edge Runtime routes. Database-backed Route Handlers must use the Node.js runtime.

Use a single server-only database module, for example `server/db/client.ts`, to create/configure the connection and apply `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, and a bounded `busy_timeout` on every process connection. The development cache should follow this pattern (with the actual connection factory and path validation supplied by the app):

```ts
import BetterSqlite3 from "better-sqlite3";

type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

const globalForDb = globalThis as typeof globalThis & {
  jobCopilotDb?: SqliteDatabase;
};

export const db =
  process.env.NODE_ENV === "development"
    ? (globalForDb.jobCopilotDb ??= createSqliteConnection())
    : createSqliteConnection();
```

If tests need isolated databases, inject a test connection; do not reuse the dev global connection in parallel test workers.

### 13.3 Background task queue and live UI events

Task types:

- `source.validate`
- `source.fetch`
- `job.normalize`
- `job.deduplicate`
- `job.analyze`
- `job.match`
- `resume.generate`
- `document.export`
- `backup.create`
- Later: `gmail.sync`

Queue fields:

- ID and task type.
- JSON payload validated by task-specific schema.
- Status (`queued`, `running`, `succeeded`, `failed`, `cancelled`).
- Priority.
- Attempts and maximum attempts.
- `run_after`.
- Lease owner and lease expiry.
- Optional `progress_stage` and `progress_percent` (nullable; percent is only set when the task has measurable steps).
- Created, started, updated, and completed timestamps.
- Safe error code/message.

Tasks must be idempotent. Retrying a source fetch must not create duplicate canonical jobs or duplicate applications. Exponential backoff applies to retryable errors; invalid source configuration and permanent parse failures must not retry forever. Queue claims and task-state transitions must use short atomic transactions.

**Operational defaults:** lease duration is 60 seconds; active handlers renew every 20 seconds; a handler that cannot renew must stop before the lease can be claimed elsewhere. Maximum attempts default to 4. Retry delays are 5 seconds, 30 seconds, 2 minutes, and 10 minutes with ±20% jitter; non-retryable validation/authentication/unsupported-format errors fail immediately. Only one `source.fetch` task may be running per source. Add a stable `idempotency_key` and a partial unique index preventing duplicate queued/running tasks with the same task type and key. A source restart catch-up creates at most one fetch for each overdue enabled source; it does not replay every missed schedule interval.

**Cancellation:** a cancellation request sets `cancel_requested_at`; handlers check it at safe checkpoints, stop starting new external work, and finish as `cancelled`. A task that cannot be interrupted mid-request is allowed to finish that bounded request before cancellation. Completed tasks cannot be cancelled.

**AI analysis budget:** ingest and normalize all allowed postings without an LLM call. Do not automatically run `job.analyze` for every imported posting. Use deterministic title/alias, location, employment-type, seniority, and search-profile-skill prefilters to identify candidates. In MVP, automatic AI analysis is off by default. User-triggered “Analyze this job” or “Analyze top candidates” may enqueue analysis for at most 10 unique job-description hashes per action and 25 per local calendar day by default. The user may lower these limits; raising the daily cap requires an explicit settings change with a cost warning. Deduplicate analysis by canonical job ID + normalized description hash + analysis version, and reuse a successful analysis across search profiles. Failed or unchanged jobs must not be reanalyzed on each source scan. `job.match` is deterministic and does not invoke an LLM. Record provider/model, token usage, and cost metadata where the provider exposes it.

**Worker-to-browser delivery:** use Server-Sent Events (SSE), not client-side polling as the primary update mechanism. Add one application-wide `EventSource` connection per open browser tab to `GET /api/events`. The Next.js Route Handler must run in the Node.js runtime, be dynamic/non-cacheable, and stream `text/event-stream` using a `ReadableStream`.

Because the worker is a separate process, do not rely on an in-memory event emitter. Persist events in a `task_events` SQLite table. The worker and web process both write/read this table through their own SQLite connection.

Each event contains only safe, minimal fields:

```ts
interface TaskEvent {
  id: number; // monotonic SQLite sequence
  taskId: string;
  taskType: string;
  eventType: "task.queued" | "task.started" | "task.progress" | "task.succeeded" | "task.failed" | "task.cancelled" | "resource.updated";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progressStage?: string;
  progressPercent?: number;
  resourceType?: "job" | "resume" | "application" | "source";
  resourceId?: string;
  occurredAt: string;
}
```

Do not include job-description text, resume content, profile facts, email bodies, prompts, file paths, provider response bodies, or secrets in SSE payloads or event rows. Write a task-state change and its corresponding event in the same transaction so the UI cannot observe an event for a state that was not committed.

SSE behavior:

- `TaskEvent.eventType` describes persisted task/resource events only. `ready` and `reset` are SSE protocol control events with their own payload shape; they are not rows in `task_events` and are not included in the persisted event-type union.
- On a new connection, begin after the latest retained event and send a `ready` event whose SSE `id` field is that latest sequence. This establishes the reconnect cursor even if the connection drops before the first task event.
- On reconnection, honor the browser's `Last-Event-ID` header and replay newer retained events in order. Every event carries its monotonic ID.
- If the cursor is older than retained history, send a `reset` event with the newest cursor; the client then refetches authoritative task/resource state and resumes from that cursor.
- The SSE handler queries the event table at a bounded interval (approximately 750 ms) because Node processes do not share memory. Send a comment heartbeat every 15 seconds to keep the connection alive.
- Set `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `Connection: keep-alive`; do not statically cache the route. Close the stream when the request is aborted or the browser disconnects.
- Retain at most seven days or 10,000 events, whichever limit is reached first. Prune safely without deleting task history needed for normal UI state.
- The browser treats SSE as an invalidation/progress channel, not as the source of truth: when it receives an event, it refetches the affected resource/task through the normal API. Show determinate progress only when `progress_percent` is real; otherwise use a subtle indeterminate state.
- If SSE remains disconnected for more than 30 seconds, show a quiet “Live updates paused” status and fall back to bounded 30-second refreshes for visible task states. Stop fallback polling when SSE reconnects.
- Long-running API actions return HTTP `202 Accepted` with a `taskId` immediately. Add `GET /api/tasks/:id` for initial state and reconnect recovery.

The task queue remains the authoritative execution state. SSE must never be required for a task to complete successfully.

**Multiple tabs:** a localhost HTTP/1.1 server can reach the common six-connection-per-origin browser limit if every tab opens its own SSE stream. Coordinate tabs with `BroadcastChannel`: elect one active tab to own the SSE connection and broadcast safe invalidation events to sibling tabs. Use a short renewable leader lease and deterministic failover when the owner closes or disconnects. If `BroadcastChannel` is unavailable, allow per-tab SSE with a visible diagnostic note; this is a tested fallback, not the normal path.

### 13.4 Data and file locations

Use an OS-appropriate application data directory, configurable with `APP_DATA_DIR`. If the variable is not set, resolve a stable per-OS default: macOS `~/Library/Application Support/PersonalJobCopilot`; Windows `%LOCALAPPDATA%\PersonalJobCopilot`; Linux `$XDG_DATA_HOME/personal-job-copilot` or `~/.local/share/personal-job-copilot` when `XDG_DATA_HOME` is unset. Resolve and create this directory before opening SQLite, starting the worker, or running PDF setup. Keep runtime data outside the source repository and never commit it.

Suggested contents:

```text
APP_DATA_DIR/
  database/app.sqlite
  documents/originals/
  documents/generated/
  exports/resumes/
  exports/cover-letters/
  backups/
  logs/
  secrets/
  runtime/playwright-browsers/
```

Secrets must not be stored in plain-text logs or browser-accessible files. Prefer environment variables for provider credentials and an encrypted local token store for OAuth refresh tokens. `.env.local`, the SQLite database, uploads, exports, and backups must be excluded from version control.

#### PDF browser installation and runtime

Playwright is used in production for PDF export, so Chromium is a runtime dependency of the PDF feature—not merely an end-to-end test browser.

- Pin the `playwright` package version in the lockfile. Keep `@playwright/test` at the same exact version so its expected Chromium revision cannot drift from the production PDF renderer. Install the matching Chromium build with a setup command such as `npm run setup:pdf-browser`.
- Add the package script `"setup:pdf-browser": "node scripts/setup-pdf-browser.mjs"`. The setup script must resolve `APP_DATA_DIR`, set `PLAYWRIGHT_BROWSERS_PATH` to `${APP_DATA_DIR}/runtime/playwright-browsers` in the child process environment before invoking the locally installed Playwright CLI with `playwright install chromium`. The dependency-free `worker/bootstrap.ts` must set the same environment variable before dynamically importing the worker application. Keep the PDF renderer's Playwright import lazy/dynamic after that environment is set; do not statically import Playwright from the worker entry or task-handler modules. The `scripts/run-playwright-tests.mjs` E2E runner must set the same browser path in its child environment before launching `@playwright/test`, so PDF smoke tests and E2E tests use the managed browser revision. Do not rely on a developer's default home-directory browser cache.
- Keep the Playwright package and its browser revision in sync. Whenever Playwright is upgraded, reinstall the managed Chromium build and rerun PDF export smoke tests.
- Do not silently download a browser during an export request. If Chromium is missing, show an actionable local setup error and disable PDF export until the user runs the setup command. DOCX export and the rest of the app remain usable.
- An advanced `PDF_BROWSER_EXECUTABLE_PATH` override may be supported for a user-managed Chrome/Chromium installation, but it is opt-in and not auto-detected. The user must accept that arbitrary system browser versions may alter pagination/rendering and run the export smoke test.
- Do not include `runtime/playwright-browsers` in normal database/document backups; the pinned setup command can reinstall it. Do include the Playwright version in the app diagnostic report.
- Document any platform-specific Chromium system-library prerequisites, especially on Linux.

### 13.5 Local network security

- Bind to `127.0.0.1` by default. Do not provide a “listen on all interfaces” option in normal settings.
- Accept requests only when `Host` is exactly `127.0.0.1:<actual-port>` or `localhost:<actual-port>`. For state-changing requests, require `Origin` to exactly match the request origin and one of those local host forms; allow no wildcard, arbitrary subdomain, alternate port, `null`, or missing Origin for browser-originated mutations. Non-browser local CLI operations use a separate internal path.
- If a developer deliberately overrides the bind address, display a startup warning that this app has no user authentication and must not be exposed to an untrusted network.
- Use same-origin/CSRF protections for all mutations.
- Use a nonce-based Content Security Policy generated per request and integrated with the installed Next.js App Router/proxy behavior. In production, avoid `unsafe-eval` and broad `unsafe-inline`; permit only the request nonce for framework/application inline scripts where required. Restrict `default-src` to `self`, `connect-src` to `self` (for SSE), `img-src` to `self` and explicitly required safe data/blob sources, and `font-src` to `self`. Add Playwright tests for nonce propagation and blocked inline script execution. Development may use a less restrictive local-only policy if Next dev requires it; production policy must remain strict.
- Keep all API keys and OAuth tokens server-side. Never put a credential in `app_settings`, task payloads, SSE events, client components, or exported files.
- Parse fetched HTML with Cheerio only in server-side connector code. Sanitize job-description fragments with `sanitize-html` using an allowlist of text/structure tags (`p`, `br`, `ul`, `ol`, `li`, `strong`, `b`, `em`, `i`, `h1`–`h6`, `a`); allow only safe `http`/`https` link destinations and safe attributes. Strip scripts, styles, forms, embedded media, event handlers, and arbitrary CSS. Render sanitized HTML only.
- **Uploads:** maximum 15 MiB per resume/document file. Validate magic bytes and container structure, not filename extension alone: PDF must begin with a valid PDF signature; DOCX must be a ZIP container with `[Content_Types].xml` and expected Word document parts; TXT/MD must decode as valid UTF-8 text. Reject macro-enabled Office formats, encrypted documents that cannot be inspected, malformed ZIP central directories, path traversal entries, and excessive expansion. For DOCX, enforce at most 5,000 ZIP entries, 50 MiB total expanded content, and a maximum 100:1 expansion ratio.
- **Backup archives:** maximum 512 MiB compressed and 2 GiB expanded by default; maximum 20,000 entries. Reject absolute paths, `..` traversal, symlinks, hard links, devices, duplicate normalized paths, and files outside the expected archive root.
- Prevent path traversal in uploaded names, backup extraction, and export paths. Generate internal filenames from IDs; preserve the display filename only as metadata.
- Apply SSRF protections to all user-supplied URLs: block loopback, private, link-local, multicast, reserved IPs; revalidate every redirect and DNS resolution; limit redirect count and response body size. Do not fetch URLs found inside a job description.
- Do not render fetched HTML in a privileged origin without sanitization.

### 13.6 AI provider interface

**Configuration split:** API keys are secrets and live only in `.env.local` (`AI_API_KEY`) or a future OS credential-store integration; never store them in `app_settings` or expose them in the settings response. `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, temperature, request timeout, per-day analysis budget, and data-sharing consent are non-secret runtime settings. The Settings UI may override non-secret values in `app_settings`. The worker reads the effective settings at the start of each task, so changes apply without a process rebuild. Environment variables supply first-run defaults; secret lookup remains server-only.


Define a small interface such as:

```ts
interface LlmProvider {
  generateStructured<T>(input: {
    task: string;
    systemPrompt: string;
    userPayload: unknown;
    schema: ZodSchema<T>;
    model: string;
    temperature?: number;
  }): Promise<{ data: T; model: string; usage?: TokenUsage }>;
}
```

Implement two adapters in MVP using Node’s built-in `fetch`, not a third-party SDK:

1. **OpenAI production adapter:** call the OpenAI Responses API (`POST /v1/responses`) using strict JSON Schema structured outputs when the selected model supports them. API key is supplied only from server-side credential configuration. Detect refusals, incomplete responses, transport errors, rate limits, and schema/business-rule failures.
2. **OpenAI-compatible adapter:** configurable base URL, model, and authentication header for local model servers and compatible hosted endpoints. Use the documented Chat Completions JSON response format supported by the configured endpoint; do not assume every compatible server implements the Responses API. Validate every result with Zod and application-level factuality checks.

Do not add an OpenAI SDK to MVP; raw `fetch` keeps the initial client choice explicit and avoids a package that the current interface does not need. Keep HTTP transport, provider-specific response parsing, schema conversion, timeout, retry, and error mapping behind the adapter interface. Add further providers only when there is a concrete need. The application must not require an agent framework or autonomous agent loop; implement explicit, versioned workflows in application services. Mastra may be added later if a durable workflow requirement justifies it, but is not a prerequisite for MVP.

The UI must show which provider/model is configured. Never send the full career profile when a task only needs a subset of facts. Minimize each model request to relevant job and career data.

### 13.7 AI safety and prompt-injection handling

Job descriptions, emails, web pages, uploaded documents, and source metadata are untrusted content. Treat them as data, not instructions.

- Never execute instructions found inside a job description or source page.
- Do not allow source content to change system prompts, tools, local settings, or file paths.
- Do not allow an LLM to initiate arbitrary network requests or filesystem operations.
- Tools exposed to an LLM, if any, must be narrowly scoped and read-only for profile/job retrieval.
- All generated structured output must pass schema validation and application-level factuality checks.
- All external actions require explicit user interaction.

---

## 14. Logical data model

Use SQLite with foreign keys enabled. The following is the required logical model; exact naming may be refined during implementation, but relationships and constraints must be preserved.

### 14.1 Career data

| Table | Key fields and purpose |
|---|---|
| `profile` | Single row enforced by `id = 1`; name, contact fields, headline, summary, location, notice period and other verified personal details |
| `experiences` | Employer, title, location, start/end dates, employment type, description, verification state |
| `projects` | Name, problem, description, role/contribution, architecture, outcomes, dates, verification state |
| `achievements` | Achievement text, metrics and units when present, linked experience/project, verification state |
| `skills` | Canonical skill name, aliases, category, optional user-entered proficiency, verification state |
| `experience_skills` | Many-to-many experience/skill links |
| `project_skills` | Many-to-many project/skill links |
| `achievement_skills` | Many-to-many achievement/skill links |
| `education` | Institution, qualification, field, dates, details, verification state |
| `certifications` | Name, issuer, issue/expiry date, credential URL, verification state |
| `languages` | Language, user-entered proficiency/level, verification state, source/evidence reference |
| `source_documents` | Original file path, MIME type, hash, import date, extracted text path, parser version |
| `evidence_links` | Source document, excerpt, target type/ID, extraction confidence, verification state |

### 14.2 Search and job data

| Table | Key fields and purpose |
|---|---|
| `search_profiles` | Name, titles, seniority, experience range, location/work mode, preferences, weights, resume preferences, enabled state |
| `search_profile_skills` | Search profile, normalized skill key, display label, aliases JSON, preference (`must_have`, `preferred`, `excluded`), filter mode (`hard`, `weighted`), optional weight; intentionally no FK to candidate `skills` |
| `companies` | Canonical company name, website, aliases, user-maintained industry tags, optional notes |
| `job_sources` | Connector type, company, source identifier, URL, schedule, health state |
| `source_runs` | Source, started/completed times, result counts, completeness, outcome, safe error details |
| `jobs` | Canonical normalized job details and freshness/status fields; nullable `merged_into_job_id` for a soft-merged alias row |
| `job_source_records` | Job, source, external ID, source URL, raw JSON, source timestamps, last seen |
| `job_requirements` | Job, normalized requirement text/key, category, machine support state (`supported`, `partially_supported`, `not_found_in_profile`, `ambiguous`), candidate response (`not_reviewed`, `candidate_confirms_has`, `candidate_confirms_does_not_have`), priority, extraction confidence, analysis source/version, stable signature, optional user priority override, override timestamp; preserve matching overrides across re-analysis |
| `job_compensation_overrides` | Job, manual min/max/currency/period, provenance, note, created/updated timestamps; kept separate from source-disclosed compensation |
| `job_duplicate_candidates` | Canonicalized job pair, match method/evidence, similarity score, state (`proposed`, `dismissed`, `merged`), created/dismissed/resolved timestamps; unique normalized pair |
| `match_runs` | Job, search profile, documented-fit score, search-skill alignment, priority score, included factors/inputs, weight/calculation/analysis versions, created time |
| `match_evidence` | Match run, requirement, state, linked career fact/evidence, explanation |
| `job_fts` | FTS5 index synchronized with canonical searchable job fields |
| `user_job_states` | Job, search profile, discovery state (`saved`, `dismissed`, `hidden`), user notes, updated time; no application lifecycle values |

### 14.3 Application and document data

| Table | Key fields and purpose |
|---|---|
| `applications` | Job, search profile, status, applied date, nullable `resume_version_id`, original apply URL, immutable submitted-material snapshot JSON/hash, notes |
| `application_events` | Application, prior/new status, timestamp, optional note |
| `resume_drafts` | Mutable working draft: required non-null job ID in MVP, search profile, career-profile snapshot, job snapshot/hash, structured content JSON, model/prompt version, state; general resumes are deferred |
| `resume_claims` | Mutable claim index: resume draft, stable claim ID, stable parent entry ID, section ID/type, text, sort order, user-edited/verification state; parent entry ID is required |
| `resume_claim_evidence` | Resume claim, evidence link/profile fact reference; every generated factual claim must have at least one valid reference |
| `resume_versions` | Immutable export snapshots: draft ID, version number, required job/profile IDs in MVP, job-description snapshot/hash, career-profile snapshot/hash, structured resume content/evidence JSON, content hash, created time |
| `document_exports` | Immutable resume version ID, format, file path, file hash, export timestamp |
| `cover_letters` | Job, search profile, editable structured content, evidence references, model/prompt version, user-edited state, content hash, created/updated timestamps |
| `application_answers` | Job/application, prompt text, editable answer text, evidence references, user-edited state, content hash, created/updated timestamps |

### 14.4 System data

| Table | Key fields and purpose |
|---|---|
| `app_settings` | Key/value settings with schema version; no secrets in unencrypted values |
| `background_tasks` | Persistent queue described in Section 13.3, including validated payload, `idempotency_key`, cancellation timestamp, optional progress stage/percent, lease fields, attempts, and lifecycle timestamps |
| `task_events` | `INTEGER PRIMARY KEY AUTOINCREMENT` event ID, task ID, event type, safe status/progress/resource metadata, timestamp; durable source for SSE replay |
| `ai_runs` | Task, provider/model, prompt/schema version, input hash, status, latency, token usage, validation outcome; avoid storing unnecessary raw prompts |
| `integration_tokens` | Encrypted OAuth token payload, provider, expiry, scopes, created/updated timestamps |
| `gmail_sync_state` | Gmail query, cursor/history ID where used, last sync time, connection state; later release only |
| `system_maintenance` | Singleton maintenance state (`normal`, `quiescing`, `paused`, `restoring`, `resetting`), request ID/type, requester timestamp, worker acknowledgement/heartbeat, recovery journal metadata |

### 14.5 Database constraints

- Enable `PRAGMA foreign_keys = ON` for every connection.
- Use ISO-8601 UTC timestamps in storage.
- Store currency codes as ISO 4217 where applicable.
- Use explicit nullable fields rather than sentinel strings such as `unknown` in numeric columns.
- Add uniqueness constraints for connector/source ID pairs, `(resume_draft_id, version_number)`, normalized duplicate-candidate pairs, active task idempotency keys, and application/job/search-profile combinations. `applications.resume_version_id` must reference an immutable `resume_versions` row. `resume_claims.stable_claim_id` must be unique within a draft, and every claim must reference a stable `entry_id` present in the draft JSON. Search-profile skill rows use their normalized skill key and do not reference candidate skills.
- Preserve historical resume and job snapshots; do not mutate an already submitted resume version. Soft-merged jobs retain an alias row and canonical redirect; do not orphan applications, resume drafts, match records, or user job states.
- Use migrations and a schema version. Never reset the user's database during an application upgrade.

`resume_drafts.structured_content_json` is the canonical resume document. Its required shape is versioned: `{ schemaVersion, sections: [{ sectionId, type, title, sortOrder, entries: [{ entryId, type, title, organization?, dates?, location?, claims: [{ claimId, text, sortOrder }] }] }] }`. Every `claimId` is stable for the life of that claim and has exactly one `resume_claims` row with the same draft, `entry_id`, `section_id`, section type, text, and sort order. `resume_claim_evidence` attaches to the stable claim ID, never to array position or display text. Reordering updates both representations in one transaction; text edits update both representations and preserve evidence links. If a claim is deleted, its evidence links are removed only after an explicit delete operation. Validate JSON/table consistency on save and in migrations.

For job analysis re-runs, preserve user overrides. Match new extracted requirements to existing overrides by normalized requirement signature; if no stable match exists, mark the old override `orphaned` for review rather than silently deleting it. Source-disclosed compensation and user-entered compensation remain separate fields; the user override is displayed as such and must never overwrite the source record.
- Add indexes for job status, posted date, first-seen date, source ID, company, search profile, application status, queue state, and `task_events.id/task_id`.
- `task_events.id` must be declared `INTEGER PRIMARY KEY AUTOINCREMENT` so event IDs are never reused after retention pruning; it is the monotonic sequence used for SSE IDs. Keep task/event foreign-key relationships valid during retention pruning.

---

## 15. Internal API surface

The UI and worker should call shared application services. Route handlers must be thin validation and serialization layers.

Suggested route groups:

| Method | Route | Purpose |
|---|---|---|
| GET/PATCH | `/api/profile` | Read/update the single career profile |
| GET/POST | `/api/profile/experiences` | List/create work experience |
| GET/PATCH/DELETE | `/api/profile/experiences/:id` | Edit/delete work experience |
| GET/POST | `/api/profile/projects` | List/create projects |
| GET/PATCH/DELETE | `/api/profile/projects/:id` | Edit/delete projects |
| GET/POST | `/api/profile/achievements` | List/create achievements |
| GET/PATCH/DELETE | `/api/profile/achievements/:id` | Edit/delete achievements |
| GET/POST, GET/PATCH/DELETE | `/api/profile/skills`, `/api/profile/skills/:id` | Manage candidate skills |
| GET/POST, GET/PATCH/DELETE | `/api/profile/education`, `/api/profile/education/:id` | Manage education |
| GET/POST, GET/PATCH/DELETE | `/api/profile/certifications`, `/api/profile/certifications/:id` | Manage certifications |
| GET/POST, GET/PATCH/DELETE | `/api/profile/languages`, `/api/profile/languages/:id` | Manage languages |
| GET/POST, GET/PATCH/DELETE | `/api/profile/source-documents`, `/api/profile/source-documents/:id` | List/import/delete source documents |
| GET/POST, GET/PATCH/DELETE | `/api/profile/evidence-links`, `/api/profile/evidence-links/:id` | Manage evidence references |
| PATCH | `/api/profile/:entity/:id/verification` | Change verification state with audit metadata |
| POST | `/api/profile/import` | Extract text from supported resume/document; AI parsing is optional |
| GET/POST | `/api/search-profiles` | List/create job-search strategies |
| GET/PATCH/DELETE | `/api/search-profiles/:id` | Edit/delete a search profile |
| GET/POST | `/api/search-profiles/:id/skills` | List/add normalized job-skill preferences |
| PATCH/DELETE | `/api/search-profiles/:id/skills/:skillId` | Edit/remove a skill preference |
| GET/POST | `/api/sources` | List/add sources |
| GET/PATCH/DELETE | `/api/sources/:id` | Read/edit/remove sources |
| POST | `/api/sources/:id/test` | Validate a source |
| POST | `/api/sources/:id/run` | Queue manual source scan; return 202 and task ID |
| GET | `/api/sources/:id/runs` | Source health/history |
| GET | `/api/tasks` | List active/recent tasks for initial load and SSE reset recovery |
| GET | `/api/tasks/:id` | Read authoritative background-task state/progress |
| POST | `/api/tasks/:id/cancel` | Request safe task cancellation |
| GET | `/api/events` | SSE stream of safe task/resource events; Node.js runtime, dynamic, non-cacheable |
| GET | `/api/jobs` | Search/filter canonical jobs |
| GET | `/api/jobs/:id` | Read job detail and lineage |
| POST | `/api/jobs/import` | Manual URL/JD import |
| POST | `/api/jobs/:id/analyze` | Explicitly queue/cap JD analysis; deduplicated by description hash |
| POST | `/api/jobs/:id/match` | Recompute deterministic match for a search profile |
| PATCH | `/api/jobs/:id/requirements/:requirementId` | Save priority override and candidate response (`not_reviewed`, `candidate_confirms_has`, `candidate_confirms_does_not_have`); confirming possession requires evidence links |
| PUT/DELETE | `/api/jobs/:id/compensation-override` | Create/update/remove user-entered compensation override |
| POST | `/api/jobs/:id/state` | Save/dismiss/hide a job in discovery state |
| GET | `/api/duplicates` | List candidate duplicate pairs for review |
| POST | `/api/duplicates/:id/merge` | Transactionally merge a reviewed duplicate pair |
| POST | `/api/duplicates/:id/dismiss` | Dismiss a duplicate suggestion so it is not repeatedly shown |
| POST | `/api/jobs/:id/tailor-resume` | Generate a job-specific resume draft |
| POST | `/api/jobs/:id/cover-letter` | Generate a cover letter draft |
| GET/PATCH | `/api/cover-letters/:id` | Read/edit/save a cover letter |
| POST | `/api/cover-letters/:id/export` | Export cover letter as DOCX/PDF/TXT |
| POST | `/api/jobs/:id/application-answers` | Generate selected application answer drafts |
| GET/PATCH | `/api/application-answers/:id` | Read/edit/save an application answer |
| POST | `/api/application-answers/export` | Export selected answers as TXT/Markdown |
| GET/POST | `/api/resumes` | List/create job-specific resume drafts; `job_id` is required in MVP |
| GET/PATCH | `/api/resumes/:id` | Read/update a draft |
| POST | `/api/resumes/:id/export` | Generate DOCX/PDF export |
| GET/POST | `/api/applications` | List/create application records (new rows begin at `preparing`) |
| PATCH | `/api/applications/:id` | Update application status/details |
| GET | `/api/overview` | Aggregate recommendations and pending actions |
| GET/POST | `/api/settings` | Read/update non-secret settings |
| GET | `/api/diagnostics` | Safe local runtime, dependency, queue, source, and recent-error diagnostics |
| POST | `/api/backup` | Create a `.tar.gz` backup |
| POST | `/api/restore/validate` | Stage and validate a backup without changing live data |
| POST | `/api/restore` | Execute a validated restore through the maintenance coordinator |
| POST | `/api/data/reset` | Delete all local user data after exact confirmation and pre-reset backup warning |

All request/response bodies must have typed Zod schemas. Long-running actions (source scans, analysis, resume generation, exports, backups, restore, and reset) return HTTP `202 Accepted` with a task ID; the browser follows progress through `/api/events` and can recover through `GET /api/tasks/:id`. Return stable error codes and human-readable messages. Never return provider credentials, OAuth tokens, raw internal filesystem paths, event-log payloads containing personal data, or stack traces to the browser. Every PATCH/DELETE operation must preserve verification, application, and export invariants and must be covered by service-level tests.

---

## 16. Error handling and observability

### 16.1 Source errors

Distinguish:

- Network timeout / connection failure.
- HTTP rate limiting.
- Authentication or access denied.
- Source not found.
- Unsupported page structure.
- Malformed response.
- Partial pagination.
- Zero jobs returned from a valid complete response.

A zero-job result is not automatically an error. A failed or partial scan must not update job closure state.

### 16.2 AI errors

Distinguish:

- Provider not configured.
- Provider unavailable / timeout.
- Rate limit or quota.
- Invalid structured output.
- Output failed factuality validation.
- Unsupported model capability.

Show an actionable error and retain the user's input. Never replace a failed AI result with invented fallback content.

### 16.3 Logs

- Use structured local logs with timestamp, task ID, source ID, and error code.
- Redact API keys, OAuth tokens, email bodies, personal profile text, and document content.
- Store enough metadata to diagnose a failed task without logging sensitive content.
- Provide a simple UI for the last source runs and recent task failures.

`GET /api/diagnostics` returns a redacted, exportable report containing app/schema version, Node/package/runtime versions, platform, database health and migration state, worker heartbeat/queue counts, last source-run outcomes, last task error codes, configured AI provider name/model (never secret values), PDF browser availability/version, and storage usage. The endpoint must not return document contents, profile facts, raw logs, API keys, OAuth tokens, or absolute filesystem paths. Any full diagnostic bundle is generated locally and requires an explicit user action before export.

### 16.4 Live event failure behavior

- SSE disconnects must not cancel or pause worker tasks.
- Event persistence and the task table are authoritative; the browser may reconnect or query task state without losing progress.
- A malformed/unknown event type is ignored safely and logged without interrupting the stream.
- If an event is pruned before a reconnect, the server sends `reset` and the browser reloads current state through the API.
- Never put sensitive personal data or generated document content in event payloads; send identifiers and state only.

---

## 17. Backup, restore, and portability

The canonical backup format is `.tar.gz`, created and extracted with the pinned `tar` package. A backup contains `manifest.json`, a SQLite database snapshot, required original/source documents, generated resume and cover-letter exports, and application metadata needed to restore references. The manifest includes app version, schema version, creation time, relative file paths, byte sizes, SHA-256 hashes, and archive-format version. Do not include `-wal`/`-shm` sidecar files as an independent snapshot.

The app must provide:

- Manual backup and optional scheduled local backup (disabled by default).
- Backup of the SQLite database using the SQLite backup API and a consistent snapshot of documents/exports.
- Manifest and SHA-256 verification for every archived file.
- Restore validation before applying: archive bounds, path safety, hashes, schema compatibility, required tables, and document references.
- Automatic pre-restore backup.
- Clear warning and refusal when a backup is from a newer schema version than the running app. Older supported backups are migrated in a staging database before live restore.
- Configurable retention count and storage usage display.

**Coordinated restore protocol:** do not overwrite, unlink, or replace `app.sqlite`, `app.sqlite-wal`, or `app.sqlite-shm` while the web or worker process holds an open connection. Restore is executed in-place through a maintenance coordinator:

1. `POST /api/restore/validate` extracts the archive into an isolated staging directory, enforces the Section 13.5 limits, verifies all hashes and references, checks schema compatibility, and prepares a migrated staging database. It does not change live state.
2. `POST /api/restore` requires a validated staging ID and explicit confirmation. It creates a maintenance request and blocks new user mutations.
3. The worker stops scheduling and claiming tasks, lets bounded in-flight tasks finish, releases/requeues remaining leases, acknowledges `paused` in `system_maintenance`, and then performs no writes until maintenance completes. If active work exceeds the bounded drain window, the restore is postponed with a clear retryable error; do not forcibly interrupt a SQLite transaction.
4. The web process gates new database requests and runs a pre-restore SQLite backup. A journal records the restore request and file-swap phase. It moves current document/export directories to a rollback location, moves staged directories into place, and copies staged table data into the existing live database connection in one transaction. Do not replace the database file. The restore service must preserve the maintenance-control row and current process/installation settings that are intentionally outside the backup payload.
5. If the database transaction fails, roll back the transaction and restore the old document/export directories from the journal. If the process crashes between file replacement and database commit, startup recovery consults the journal and completes rollback before accepting user requests.
6. On success, mark restore complete, clear stale queue leases, emit a resource invalidation event, resume the worker, and remove staging/rollback material only after verification passes.

**Delete all local data:** `POST /api/data/reset` uses the same maintenance pause/drain and rollback-safe file/database procedure. Require the exact confirmation string `DELETE ALL LOCAL DATA`. Create a pre-reset backup and display the warning before accepting the request. Delete career facts, source records, jobs, search profiles, user job states, applications, resumes, exports, task/event history, and user documents. Preserve only the application installation, empty database schema, migration history, non-secret operational settings required to start, and the selected data-directory path. Do not silently delete `.env.local` or operating-system credential-store entries; provide separate credential-disconnect/removal controls.

Export must not include secrets by default. OAuth tokens and API keys are excluded from normal backup archives. Any future secrets export must be a separately confirmed encrypted archive and is not MVP.

---

## 18. Privacy and data handling

- All career data, job history, generated documents, and application records are local by default. Create the data directory and sensitive files with user-only permissions where the operating system supports them (POSIX directory mode `0700`, files `0600`; rely on per-user ACLs on Windows).
- MVP does not encrypt the SQLite database or career documents at the application layer. The setup guide must say this plainly and recommend operating-system full-disk encryption and secure handling of backups. OAuth tokens added later must be encrypted separately.
- No account or remote product telemetry is collected.
- The user can inspect and delete local data.
- AI requests send only the minimum relevant data to the configured provider. Clearly disclose this before first cloud-model use.
- A local OpenAI-compatible model endpoint may be configured for users who require local inference.
- Gmail integration, when implemented, is optional, read-only, and separately authorized.
- Source content and job descriptions may be copyrighted or subject to terms. Store only what is necessary for the user's personal job-search workflow; preserve source URLs and do not redistribute source content.
- The app must offer a “delete all local data” action with the exact confirmation and rollback-safe maintenance protocol in Section 17, plus a pre-reset backup warning.

---

## 19. Testing and quality strategy

### 19.1 Test layers

| Layer | Required coverage |
|---|---|
| Unit | Date semantics including unknown-posted-date max-age, deterministic skill normalization, hard/weighted search-skill filters, scoring, weight normalization, location/seniority/employment-type unknown handling, deduplication/merge conflicts, state transitions, resume JSON/claim/evidence consistency |
| Integration | SQLite migrations, FTS index, source adapters with fixtures, task queue leases/retries/cancellation/idempotency, worker pause/drain, coordinated restore/reset rollback, archive validation, file storage, document exports |
| AI contract | Zod schema validity, missing-data handling, unsupported-claim rejection, evidence mapping, prompt-injection resistance |
| Crawler fixtures | Representative Greenhouse, Lever, Ashby, Schema.org JobPosting JSON-LD, RSS/Atom, unsupported generic-page HTML, pagination and rate-limit responses |
| E2E | First run with and without AI, resume text import/review, source setup, discovery, analysis budget caps, hard/weighted skills, duplicate merge conflict handling, resume claim reorder/edit, cover-letter/answer editing/export, application tracking, backup/restore/reset, SSE progress/reconnect/multi-tab behavior, diagnostics, and graceful process shutdown |
| UI/accessibility | Keyboard-only navigation, command palette, drawer focus/scroll restoration, drag-and-drop keyboard alternatives, contrast, responsive layouts, and `prefers-reduced-motion` behavior |
| Visual QA | Review Playwright captures of Overview, Discover, Job detail drawer, Career Profile, Search Profiles, Resume Editor, Applications, and Settings at 1440 × 900 and 390 × 844; verify spacing, hierarchy, and empty/loading/error states |
| Security | SSRF, redirect validation, XSS/sanitizer allowlist, path traversal, archive bombs and malicious tar entries, MIME/magic-byte validation, upload limits, CSP nonce enforcement, Host/Origin checks, local bind address, secrets redaction, and SSE payload privacy |
| Regression | Fixed profile/JD fixture pairs with expected matching and resume evidence behavior |

### 19.2 AI evaluation dataset

Before release, create a non-production fixture set containing at least:

- 20 synthetic or consented career profiles with varied experience levels and role types.
- 50 representative job descriptions, including incomplete and contradictory listings.
- Profiles containing relevant, partially relevant, and irrelevant projects.
- Cases where a skill is present in the profile but absent from the current resume.
- Cases where a skill appears in a JD but is genuinely unsupported by the profile.
- Cases with no salary, ambiguous salary, and explicit salary.
- Cases with unknown posting dates.

Evaluate:

1. Job requirement extraction correctness.
2. Correct mapping of requirements to profile evidence.
3. Correct distinction between “not found” and “does not have”.
4. No unsupported factual claims in generated bullets.
5. No invented metrics or technologies.
6. Preservation of important achievements.
7. Resume readability and export integrity.
8. Stable score computation from identical structured inputs.

AI model updates or prompt changes must run the evaluation suite before being accepted.

### 19.3 Minimum release gates

Do not release MVP until:

- All migrations pass on a fresh database and on the previous release's fixture database.
- Core unit and integration tests pass.
- Source connector fixtures pass, including rate limit, timeout, incomplete pagination, and malformed response cases.
- A failed scan cannot close jobs.
- Duplicate source imports do not create duplicate canonical jobs.
- Every generated factual resume claim has at least one verified evidence reference.
- The resume validator rejects fabricated numbers and unsupported technologies in the evaluation set.
- DOCX and PDF output pass text extraction checks and preserve expected section order and content.
- The pinned Playwright Chromium browser can be installed under `APP_DATA_DIR`, detected at runtime, and used to export PDF; missing browser state produces a clear setup error rather than an automatic download.
- SSE task updates appear in the browser, reconnect with `Last-Event-ID`, recover after a reset, and do not affect worker completion.
- The primary views meet the Section 4.9 design rules; keyboard navigation, command palette, job drawer focus restoration, resume reordering alternatives, and reduced-motion behavior pass manual/E2E checks.
- The app binds to loopback by default.
- No API key or OAuth token appears in logs, browser responses, or exports.
- Backup and restore pass a round-trip test.

---

## 20. Acceptance criteria by feature

### UI and interaction quality

- The seven primary views use the shared palette, typography, spacing, border, and control rules in Section 4.9.
- The left rail collapses without losing navigation labels to assistive technology; mobile navigation remains keyboard accessible.
- The job detail drawer preserves the underlying list scroll position and returns focus to the invoking row when closed.
- `Cmd+K` / `Ctrl+K` opens the command palette; Escape closes it and focus returns appropriately.
- Motion is restrained and globally respects `prefers-reduced-motion`; route transitions affect the content region only, same-list reorder/filter changes settle smoothly, and profile changes do not animate unrelated records as reorder operations.
- Save/dismiss feedback is immediate, dismiss supports Undo, accordions expand without abrupt layout snaps, and skeleton geometry matches the loaded content.
- The interface contains none of the prohibited visual anti-patterns in Section 4.9.8.

### A. Local workspace

- The app starts using documented local commands.
- No login, account, or remote product backend is required.
- Database and files are stored under the configured local data directory.
- Default bind is `127.0.0.1`.
- Stopping and restarting the app does not lose state or duplicate queued work.
- One documented command starts both web and worker processes; Ctrl+C terminates both without leaving an orphan.
- Next.js development HMR does not create additional SQLite connections.
- Task progress reaches the browser through SSE and recovers after a dropped connection.

### B. Career profile

- User can manually create and edit every core profile entity.
- User can import supported resume formats.
- Extracted facts are not marked verified automatically.
- Each verified fact can show its source document/excerpt or manual origin.
- User can reject, archive, and correct extracted facts.

### C. Job discovery

- User can add, test, pause, and run a supported source.
- A successful scan normalizes jobs and stores source lineage.
- Re-running the same scan does not create duplicate canonical jobs.
- A partial or failed scan does not mark jobs closed.
- Posted date and first-seen time are always separate.
- User can manually import a URL and pasted description.
- A source failure is visible and does not block other sources.

### D. Matching

- Each search profile has independent hard filters and ranking weights.
- The fit score is deterministic for fixed analysis and profile inputs.
- Missing salary/location/date is treated as unknown.
- The job detail view shows evidence for every supported or partially supported requirement.
- “Not found in profile” is not worded as proof that the candidate lacks the skill.
- The displayed score is not called an ATS score or hiring probability.

### E. Resume generation

- A job-specific resume can be generated from verified career facts.
- Every generated claim has evidence references.
- Unsupported JD requirements are shown as gaps, not fabricated experience.
- User can edit the draft and review the evidence.
- Exported DOCX and PDF are ATS-safe, selectable text, and consistent with the preview.
- Each export creates or reuses an immutable resume version; later draft edits cannot change it. An application stores the exact resume version and immutable submitted-material snapshot, which remain retrievable after further edits or source-job closure.
- Desktop editing uses the specified split pane; narrow layouts switch to Edit/Preview tabs.
- Dragging and keyboard Move up/Move down actions reorder sections/bullets without detaching evidence references.
- The preview updates from structured data and the exported PDF is not a screenshot of the preview.

### F. Application tracking

- User can save a job in discovery state without creating an application. Starting preparation creates an application at `preparing`; application statuses are `preparing`, `ready_to_apply`, `applied`, `response_received`, `rejected`, `withdrawn`, or `archived`.
- Opening the employer URL does not automatically mark the job applied.
- An application preserves the exact resume version and materials used.
- Status changes have timestamps.

### G. Backup and restore

- Backup includes database and documents, with integrity manifest.
- Restore is validated before applying.
- Current data is backed up before restore.
- Secrets are excluded by default.

---

## 21. Suggested implementation sequence

Build in vertical slices so each stage is usable and testable.

### Slice 1 — Local foundation

- Next.js local web app.
- Shared design tokens, Geist fonts, Lucide icon treatment, navigation rail, responsive shell, and accessible component primitives from Section 4.9.
- SQLite database and migrations, including task-event storage.
- Local data directory.
- Loopback binding and security defaults.
- `concurrently`-managed web + worker processes with graceful signal handling and a dependency-free worker bootstrap.
- Development-only `globalThis` cache for the Next.js `better-sqlite3` connection.
- Persistent task queue and database-backed SSE endpoint with a minimal live task indicator.
- Basic navigation, command palette, settings shell, and empty/loading/error states.

**Exit condition:** One documented command starts both processes, the app writes/reads local data, HMR does not leak SQLite connections, task events reach the browser, and Ctrl+C/restart leaves no orphan process or stuck task.

### Slice 2 — Career profile

- Structured profile entities.
- PDF/DOCX/TXT/Markdown text extraction.
- AI-assisted structuring only when configured and explicitly permitted; otherwise raw text review plus manual fact entry.
- Extraction review and verification UI.
- Evidence/source management, including languages.

**Exit condition:** User can create a verified profile and import/review a resume with AI disabled, without any extracted fact being trusted automatically.

### Slice 3 — Job sources and discovery

- Source registry.
- Greenhouse, Lever, and Ashby connectors.
- Manual import.
- Job normalization, FTS5, freshness, deduplication and duplicate-review queue, source run history.
- Generic pages limited to Schema.org JobPosting JSON-LD and RSS/Atom.

**Exit condition:** Repeatable scans create stable canonical job data and preserve source lineage.

### Slice 4 — Search profiles and matching

- Search profile configuration.
- Deterministic baseline analysis and normalized search-profile skill filtering.
- Optional capped AI job-description extraction on explicit user request.
- Evidence matching and documented-fit score.
- Hard filters and configurable priority weights, including search-skill alignment.
- Overview recommendations, manual analysis review, and job detail overrides.

**Exit condition:** A fixed profile/JD test suite produces explainable, repeatable results in both AI and no-AI modes; analysis caps and cache deduplication are enforced.

### Slice 5 — Resume and application materials

- Structured resume draft generation.
- Claim evidence validation.
- Split-pane resume editor with inline structured editing, dnd-kit reordering, keyboard move controls, autosave, and evidence-link preservation.
- ATS-safe live preview and responsive Edit/Preview tabs.
- DOCX/PDF exports using the pinned Playwright-managed Chromium runtime installed under `APP_DATA_DIR`.
- Cover letter and application answer drafts with editing, persistence, and export.
- Application tracking with saved-job state separate from application lifecycle.

**Exit condition:** End-to-end workflow from discovered job to reviewed application package works without unsupported claims; resume claim/evidence associations survive reorder and edits.

### Slice 6 — Release hardening

- Security/CSP/upload/archive review.
- Crawler and AI/no-AI regression tests.
- Coordinated backup/restore/reset with worker pause/drain and recovery journal.
- Failure recovery, task cancellation, diagnostics, and logs.
- Setup guide and troubleshooting.

**Exit condition:** All minimum release gates in Section 19.3 pass.

Do not start Gmail, compensation estimation, or browser autofill until the MVP exit conditions are met.

---

## 22. Required project structure

A maintainable monorepo is not necessary. A single application repository with clear modules is sufficient.

Suggested structure:

```text
personal-job-copilot/
  app/                         # Next.js routes and UI
    (workspace)/
    api/
      events/route.ts           # Database-backed SSE stream
      tasks/[id]/route.ts       # Task state recovery
  components/                  # Reusable UI components
    ui/                         # Custom components built on Radix primitives
    motion/                     # Shared motion wrappers/policies
  features/
    career-profile/
    search-profiles/
    job-sources/
    job-discovery/
    job-matching/
    resume-builder/
    applications/
    settings/
  server/
    db/
      schema/
      migrations/
      repositories/
    services/
    connectors/
      greenhouse/
      lever/
      ashby/
      generic-careers/
      manual-import/
    ai/
      providers/
      prompts/
      schemas/
      workflows/
    queue/
    events/                      # Persisted task-event writer/reader
    files/
    security/
  worker/
    bootstrap.ts               # Sets APP_DATA_DIR/browser env, then dynamically imports index.ts
    index.ts
    scheduler.ts
    tsconfig.json              # rootDir="..", outDir="./dist"; emits worker/dist/worker/bootstrap.js
    handlers/
    dist/                      # Generated; includes dist/worker and shared dist/server trees; gitignored
  tests/
    unit/
    integration/
    fixtures/
    e2e/
    ai-evals/
  scripts/
    setup-pdf-browser.mjs      # Installs pinned Chromium under APP_DATA_DIR
    run-playwright-tests.mjs   # Runs E2E tests with the managed browser path
    backup-local.mjs           # Creates and validates .tar.gz backups
    restore-local.mjs          # Staging, migration, restore and recovery journal helpers
  docs/
  .env.example
  .gitignore
  package.json
  package-lock.json
  .nvmrc
  README.md
```

Keep business logic out of React components and route handlers. Both the web process and worker should call the same typed services/repositories.

---

## 23. Configuration and setup guide requirements

The repository must include:

- Prerequisites and supported operating systems.
- Node.js version policy and package manager.
- Install, development, production build, and local start commands, including the `concurrently`-managed web/worker runner and graceful shutdown behavior. The worker must start through the dependency-free `worker/bootstrap.ts` entry. Pin the active Node.js LTS major in `.nvmrc` (or the chosen version-manager file) and `package.json` `engines`, and verify the same runtime for native `better-sqlite3` installation. `worker/tsconfig.json` must emit the compiled bootstrap at `worker/dist/worker/bootstrap.js`, shared server modules under `worker/dist/server/`, and worker application modules under `worker/dist/worker/`, as required by `start:local`. The default URL is `http://127.0.0.1:3000`; document the `PORT` override.
- `.env.example` with descriptions but no real secrets.
- `APP_DATA_DIR` behavior and default location.
- `npm run setup:pdf-browser` instructions, pinned Playwright/Chromium version, `PLAYWRIGHT_BROWSERS_PATH` location under `APP_DATA_DIR/runtime/playwright-browsers`, Linux system prerequisites, browser-missing recovery, and the optional `PDF_BROWSER_EXECUTABLE_PATH` override.
- SSE behavior, task progress semantics, reconnect/recovery behavior, and the fact that workers continue if the browser tab closes.
- Database migration and backup/restore commands.
- AI provider setup, including a local OpenAI-compatible endpoint option. Use server-only environment configuration such as `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, and `AI_API_KEY`; the exact variable names must be documented in `.env.example`. Do not put provider secrets in SQLite settings or client-side code.
- `APP_ENCRYPTION_KEY` setup for encrypting OAuth tokens when Gmail is added.
- Source setup instructions for Greenhouse, Lever, Ashby, generic URLs, and manual import.
- Gmail setup only when that integration is implemented.
- Troubleshooting for source failures, provider errors, document parsing, and worker not running.
- Clear privacy note describing which data leaves the machine for each optional integration.

The app must be usable before an AI provider is configured. In that state, manual profile entry, PDF/DOCX/TXT text extraction, source setup, job discovery, deterministic skill/title matching, filtering, saving, duplicate review, and application tracking remain available. Resume import displays raw extracted text for manual entry; it does not claim to parse arbitrary resume structure without AI. The Overview uses basic relevance ordering when no numeric fit can be computed. AI actions show a clear provider-configuration and data-sharing prompt. Document `AI_PROVIDER`, `AI_MODEL`, optional `AI_BASE_URL`, `AI_API_KEY`, `APP_DATA_DIR`, and `APP_ENCRYPTION_KEY` in `.env.example`; provider/model/base URL/temperature/consent may be overridden through non-secret Settings values, but API keys must remain in `.env.local` or a future OS credential store. Include the `.tar.gz` archive format, restore/reset maintenance protocol, and worker TypeScript output path in the setup guide.

---

## 24. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Source sites change markup or APIs | Source-specific connectors, fixtures, health status, manual import fallback, no claim of universal coverage |
| Job date is missing or misleading | Preserve source timestamp semantics; show unknown rather than infer posting date |
| Duplicate postings | Stable source IDs and URLs first; human review for fuzzy duplicate candidates |
| LLM invents experience | Verified evidence only, claim-to-source links, structured output validation, regression evaluation |
| Job description contains prompt injection | Treat all fetched content as untrusted data; no arbitrary tool access |
| Salary estimate is unreliable | MVP shows only disclosed/user-entered salary; estimation gated on credible data |
| Gmail OAuth expires or needs setup | Optional later integration, user-owned OAuth configuration, read-only scope, reconnect flow |
| App is exposed on a network | Loopback-only binding, startup warning on overrides, no authentication assumption |
| Worker stops with the app | Persistent queue, lease recovery, one-run catch-up scheduling, task cancellation, visible last-run state |
| Restore races with active SQLite connections | Maintenance state, worker pause/drain acknowledgement, transactional in-place restore, rollback journal; never replace a live DB file |
| AI quota exhaustion during first ingestion | No automatic per-job LLM analysis, deterministic prefilter, cache by JD hash, explicit daily/action caps |
| Local disk loss | Verified `.tar.gz` backup/restore and portable data export |
| Crawling causes excessive requests | Conservative per-source intervals, backoff, user controls, respect source rules |

---

## 25. Product decisions fixed by this specification

These decisions are deliberate and should not be reopened during implementation without evidence that a requirement cannot be met:

1. Local web application only; no Tauri or desktop packaging.
2. One local user; no accounts, authentication, multi-tenancy, or monetization.
3. SQLite + FTS5; no PostgreSQL, Redis, or hosted vector database.
4. Dedicated local worker backed by SQLite; no cloud scheduler.
5. User-seeded sources; no global crawler/index.
6. Greenhouse, Lever, Ashby, and manual import as initial source paths.
7. Generic career-page crawling is conservative and best-effort, not guaranteed.
8. LinkedIn and Naukri automation/scraping are excluded; manual import is supported.
9. Job fit is evidence-based and not an ATS or hiring-probability score.
10. Employer-posted date and local first-seen date are distinct.
11. Resume generation uses verified profile facts and claim-level evidence references.
12. User reviews and submits applications on employer sites.
13. Salary is shown only when disclosed or user-entered in MVP; speculative LLM estimates are prohibited.
14. Gmail, salary estimation, browser autofill, and embeddings are later additions, not MVP blockers.
15. No autonomous multi-agent framework is required; use explicit typed workflows and provider adapters.
16. The visual system in Section 4.9 is mandatory: warm-neutral light theme, restrained evergreen accent, Geist/Geist Mono, hairline borders, compact navigation rail, command palette, job detail drawer, and no decorative dashboard anti-patterns.
17. Use `motion` (`motion/react`) for restrained transitions and the current `@dnd-kit/react` + `@dnd-kit/helpers` API for accessible resume reordering; respect reduced-motion preferences globally.
18. Use a database-backed SSE event log for worker-to-browser updates; do not depend on cross-process in-memory events.
19. Use `concurrently` to supervise the local web and worker processes; cache the Next.js development SQLite connection on `globalThis`.
20. Playwright-managed Chromium is a documented runtime dependency for PDF export, pinned to the Playwright version and installed under `APP_DATA_DIR`; it is not merely a dev/test dependency.
21. The initial stack is pinned to Next.js `16.4.6`, React/React DOM `19.3.1`, Node.js `24.22.3`, and the exact compatible package set in Section 13.1; no floating direct-dependency ranges are allowed in the bootstrap manifest.
22. Search-profile skills are job-centric normalized strings, independent of candidate skills, and participate in hard filters and a separate priority-ranking factor.
23. AI is optional. Resume import without AI is text extraction plus manual entry; no-AI matching uses deterministic rules and never invents fit scores.
24. AI job analysis is user-triggered and budget-capped; ingesting a job never implies an LLM request.
25. Worker output path is `worker/dist/worker/bootstrap.js` with shared modules under `worker/dist/server/`; worker-shared imports use relative paths and CommonJS output.
26. `user_job_states` owns save/dismiss/hide discovery state; `applications` owns only the application pipeline and begins at `preparing`.
27. Resume JSON is canonical and each claim has a stable parent entry ID; evidence attaches to stable claim IDs, not list positions.
28. Backup archives are `.tar.gz`; restore/reset use a maintenance coordinator and never replace an active SQLite file.
29. Generic career-page MVP support is limited to Schema.org JobPosting JSON-LD and RSS/Atom.
30. Unknown employer-posted dates remain labeled unknown; max-age eligibility for such jobs uses `first_seen_at` without treating it as a posted date.
31. Job location/seniority/employment type unknowns remain eligible by default unless the user explicitly chooses fail-closed behavior.
32. General/non-job resumes are not an MVP workflow; MVP drafts and versions require a job association.
33. API keys remain outside SQLite settings; non-secret AI settings may be changed in Settings and are read dynamically by the worker.

---

## 26. External documentation and implementation references

These references support connector and integration implementation. Re-check the documentation and applicable terms when implementing each connector because endpoints, policies, and OAuth requirements can change.

1. **Greenhouse Job Board API** — public job-board data and endpoint behavior: <https://docs.greenhouse.io/job-board>
2. **Lever Postings API** — public postings feed, pagination, fields, and hosted application URLs: <https://github.com/lever/postings-api>
3. **Ashby Public Job Postings API** — public job-board endpoint and optional compensation field: <https://developers.ashbyhq.com/docs/public-job-posting-api>
4. **Gmail `users.messages.list`** — message search and supported authorization scopes: <https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list>
5. **Google OAuth 2.0 web-server flow** — localhost redirect URI configuration and credential handling: <https://developers.google.com/identity/protocols/oauth2/web-server>
6. **Google OAuth token lifecycle** — refresh-token expiration behavior for projects in Testing status: <https://developers.google.com/identity/protocols/oauth2>
7. **LinkedIn automated activity guidance** — third-party scraping and automated activity restrictions: <https://www.linkedin.com/help/learning/answer/a1340567>
8. **LinkedIn User Agreement** — restrictions on scraping and unauthorized automated methods: <https://www.linkedin.com/legal/user-agreement>
9. **Motion for React installation and Next.js usage** — package name, `motion/react` imports, and App Router integration: <https://motion.dev/docs/react-installation>
10. **Motion layout animations** — layout changes and shared `layoutId` indicators: <https://motion.dev/docs/react-layout-animations>
11. **Motion accessibility** — reduced-motion configuration and `useReducedMotion`: <https://motion.dev/docs/react-accessibility>
12. **dnd-kit React quickstart** — current `@dnd-kit/react` API and package setup: <https://dndkit.com/react/quickstart/>
13. **dnd-kit sortable hook** — current sortable-list hook and `handleRef` support: <https://dndkit.com/react/hooks/use-sortable/>
14. **dnd-kit sortable state management** — `move` helper and synchronization with application state: <https://dndkit.com/react/guides/sortable-state-management/>
15. **dnd-kit sensors** — default pointer/keyboard sensors and keyboard configuration: <https://dndkit.com/react/guides/sensors/>
16. **dnd-kit accessibility plugin** — built-in ARIA behavior and screen-reader announcements: <https://dndkit.com/extend/plugins/accessibility/>
17. **Playwright browser management** — pinned browser revisions and `PLAYWRIGHT_BROWSERS_PATH`: <https://playwright.dev/docs/browsers>
18. **Next.js Route Handlers** — Node.js runtime and streaming `ReadableStream` responses for SSE: <https://nextjs.org/docs/app/api-reference/file-conventions/route>
19. **Next.js 16 upgrade guide** — current version, Node.js/TypeScript minimums, React setup, Turbopack defaults, async request APIs, and ESLint 10 support notes: <https://nextjs.org/docs/app/guides/upgrading/version-16>
20. **Node.js 24 release archive** — Node 24 LTS patch history and bundled npm version: <https://nodejs.org/en/download/archive/v24>
21. **Tailwind CSS Next.js integration** — Tailwind v4, `@tailwindcss/postcss`, and PostCSS installation pairing: <https://tailwindcss.com/docs/installation/framework-guides/nextjs>
22. **dnd-kit React package release and peer dependencies** — current `@dnd-kit/react` API and React 18/19 peer support: <https://github.com/clauderic/dnd-kit/blob/main/packages/react/package.json>
23. **dnd-kit 0.5.3 release notes** — matching React adapter dependency set: <https://github.com/clauderic/dnd-kit/blob/main/packages/react/CHANGELOG.md>
24. **Playwright installation and supported Node versions** — browser binary installation and supported Node.js release lines: <https://playwright.dev/docs/intro>
25. **ESLint version support** — current ESLint release line and supported runtime: <https://eslint.org/version-support/>
26. **React version history** — stable React releases and current version line: <https://react.dev/versions>
27. **Motion package manifest** — React 18/19 peer dependency range for the pinned Motion 14 release line: <https://github.com/motiondivision/motion/blob/main/packages/motion/package.json>
28. **Next.js npm release metadata** — stable `next` package versions: <https://www.npmjs.com/package/next?activeTab=versions>
29. **React npm release metadata** — stable `react` and `react-dom` package versions: <https://www.npmjs.com/package/react?activeTab=versions> and <https://www.npmjs.com/package/react-dom?activeTab=versions>
30. **Tailwind package release metadata** — `tailwindcss` and `@tailwindcss/postcss` version pairing: <https://www.npmjs.com/package/tailwindcss?activeTab=versions> and <https://www.npmjs.com/package/@tailwindcss/postcss?activeTab=versions>
31. **dnd-kit helpers npm metadata** — pinned helper package version: <https://www.npmjs.com/package/@dnd-kit/helpers?activeTab=versions>
32. **Drizzle release metadata** — stable ORM and migration CLI versions: <https://www.npmjs.com/package/drizzle-orm?activeTab=versions> and <https://www.npmjs.com/package/drizzle-kit?activeTab=versions>
33. **Playwright npm metadata** — exact version for both production browser runtime and E2E runner: <https://www.npmjs.com/package/playwright?activeTab=versions> and <https://www.npmjs.com/package/@playwright/test?activeTab=versions>
34. **Cheerio npm metadata** — HTML parser version: <https://www.npmjs.com/package/cheerio?activeTab=versions>
35. **sanitize-html npm metadata and security allowlist behavior** — HTML sanitizer version and API: <https://www.npmjs.com/package/sanitize-html?activeTab=versions>
36. **tar npm metadata** — archive creation/extraction version: <https://www.npmjs.com/package/tar?activeTab=versions>
37. **OpenAI Structured Outputs** — Responses API schema-constrained output guidance: <https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses>
38. **OpenAI Responses API create reference** — raw HTTP request/response contract: <https://developers.openai.com/api/reference/resources/responses/methods/create>
39. **Schema.org JobPosting** — structured career-page job listing vocabulary: <https://schema.org/JobPosting>
40. **RSS 2.0 specification** — supported feed format: <https://www.rssboard.org/rss-specification>
41. **Atom Syndication Format RFC 4287** — supported feed format: <https://www.rfc-editor.org/rfc/rfc4287>
42. **Next.js Content Security Policy** — nonce-based CSP implementation guidance: <https://nextjs.org/docs/app/guides/content-security-policy>

---

## 27. Final build-readiness checklist

The specification is ready to implement when the development team can answer “yes” to all of these:

- [x] Product is explicitly local web, single-user, and account-free.
- [x] Target outcome and non-goals are explicit.
- [x] MVP is separated from later additions.
- [x] User journeys and primary pages are defined.
- [x] Visual identity, palette, typography, layout density, motion, accessibility, and anti-patterns are specified.
- [x] Resume editor split-pane layout, reorder primitive, autosave, and evidence-link invariants are specified.
- [x] Worker-to-browser SSE event delivery, reconnect, and fallback behavior are specified.
- [x] Local process supervision, graceful shutdown, and Next.js SQLite HMR connection caching are specified.
- [x] Playwright-managed Chromium is declared as a PDF runtime dependency with installation and upgrade behavior.
- [x] Next.js 16, Node.js 24 LTS, React, dnd-kit, Motion, Tailwind, SQLite, Drizzle, document, test, and lint packages have an exact pinned baseline.
- [x] Contrast tokens distinguish secondary and tertiary text and include calculated baseline ratios for the muted surface.
- [x] Personalization and search-profile skill scoring are connected to actual filter/ranking math.
- [x] AI and no-AI behavior is defined for resume import, analysis, matching, and Overview.
- [x] AI analysis triggers, cache behavior, and budget caps are defined.
- [x] Worker compilation output, module format, and imports are explicit.
- [x] Worker pause/drain coordination for restore and reset is defined.
- [x] Saved-job state and application lifecycle are separate.
- [x] Resume JSON, entry IDs, claims, and evidence references have one canonical relationship.
- [x] Languages and required profile CRUD routes are included.
- [x] Duplicate-review persistence, merge/dismiss behavior, and conflict rules are included.
- [x] Requirement/compensation overrides and preservation on re-analysis are defined.
- [x] Cover letter/application answer editing and export routes are included.
- [x] Task listing/cancellation, diagnostics, source/profile CRUD, restore and reset routes are included.
- [x] AI secret storage and non-secret Settings overrides are reconciled.
- [x] Resume paper size/font and DOCX/PDF pagination limitations are specified.
- [x] Unknown-date max-age behavior and location/seniority/employment-type matching are explicit.
- [x] Generic career page scope, queue defaults, security constraints, and multi-tab SSE behavior are explicit.

**Open implementation gates:** The product decisions and API/data contracts are specified, but the repository has not been built. Before coding, perform the Section 13.1.4 dependency install/peer verification and implement the Section 19.3 tests. A green checklist is not a claim that runtime behavior has already passed.

**Implementation note:** This document specifies product behavior and architecture. Before coding, pin concrete library versions and verify current licenses, API documentation, and source terms. Do not weaken the factuality, freshness, privacy, or human-approval requirements to accelerate delivery.

**Dependency verification status:** Newly selected package versions (`cheerio@1.2.0`, `sanitize-html@2.18.2`, `@types/sanitize-html@2.16.2`, and `tar@7.5.23`) were checked against published npm metadata on 25 November 2026. The application repository and generated `package-lock.json` do not exist yet, so installation, peer resolution, native-module build, production build, and E2E checks have not been executed. Treat every pinned version as an implementation baseline that must pass the complete Section 13.1.4 install gate; update the affected compatibility group if the real install or runtime reveals an issue. Do not claim runtime verification before those checks pass.
