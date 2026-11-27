# Personal Job Copilot

Local-first career profile manager, job discovery ledger, deterministic/AI-assisted matching workspace, grounded resume tailoring studio, and manual application tracker.

## Highlights

- **Local-first & private:** Runs strictly on `127.0.0.1` (`Host` / `Origin` verified) with SQLite + FTS5 storage under your OS user data directory (`APP_DATA_DIR`). Zero external telemetry or remote hosting required.
- **Zero API keys required (CLI-first AI):** Configure locally installed AI CLIs (`claude`, `codex`, `opencode`, `agy`, `gemini`, or custom CLI presets + your own model) or a local OpenAI-compatible HTTP endpoint (Ollama/LM Studio) in **Settings**. Works 100% offline in deterministic / No-AI mode too.
- **Grounded materials only:** Tailored resume claims and cover letters cite verified Career Profile facts, reject unverified/fabricated metrics, withhold sensitive legal/work-auth/demographic answers for manual completion, and freeze immutable snapshots when you explicitly confirm an application was submitted.
- **ATS-safe exports:** Export single-column DOCX (`docx`) and A4 / US Letter PDFs (Playwright Chromium with network requests blocked during rendering).

## Prerequisites

- **Node.js `24.15.x`** (`.nvmrc` pinned to `24.15.0`) and `npm`
- **Chromium for PDF export** (optional if you only need DOCX/Markdown/TXT exports):

```bash
npm install
npm run setup:pdf-browser
```

> On Linux, install Chromium OS dependencies if needed (`npx playwright install-deps chromium`).

## Quick Start

Development mode (Next.js dev server on `127.0.0.1:3000` + TypeScript background worker):

```bash
npm run dev
```

Production local build and launch:

```bash
npm run build
npm run start:local
```

Then open **http://127.0.0.1:3000** in your browser.

## Verification & Testing

```bash
npm run lint
npm run typecheck
npm test        # Unit, integration, security, and 20x50 AI evaluation suites
npm run test:e2e
```

## Backups & CLI Recovery

Create or restore local `.tar.gz` backups either in **Settings → Resume Defaults & Backups** or from the terminal:

```bash
node scripts/backup-local.mjs
node scripts/restore-local.mjs --file /path/to/backup.tar.gz
```

See [docs/setup-and-troubleshooting.md](docs/setup-and-troubleshooting.md) for OS data directory paths, AI CLI configuration details, security architecture, and troubleshooting.
