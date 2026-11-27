# Setup, Architecture & Troubleshooting

## 1. Local Data Directory (`APP_DATA_DIR`)

Unless overridden via the `APP_DATA_DIR` environment variable, all user data is stored privately (`0700` dirs / `0600` files on POSIX):

- **macOS:** `~/Library/Application Support/PersonalJobCopilot`
- **Linux:** `${XDG_DATA_HOME:-~/.local/share}/personal-job-copilot`
- **Windows:** `%LOCALAPPDATA%\PersonalJobCopilot`

Inside `APP_DATA_DIR`:

- `database/app.sqlite` — SQLite WAL database + FTS5 job index + persistent background task queue
- `documents/originals/` & `documents/generated/` — Uploaded source resumes & normalized extractions
- `exports/resumes/` & `exports/cover-letters/` — Generated DOCX, PDF, Markdown, and TXT artifacts
- `backups/` — `.tar.gz` archives (`manifest.json` + SQLite online `.backup()` + documents/exports; **never** includes `secrets/`, `logs/`, or `runtime/`)
- `runtime/playwright-browsers/` — Managed Chromium runtime for PDF rendering (preserved during `"DELETE ALL LOCAL DATA"` reset)

## 2. CLI-First AI Setup (Zero API Keys)

Open **Settings → AI Provider (CLI-first)**:

1. Choose a local CLI preset (`claude`, `codex`, `opencode`, `agy`, `gemini`, or `custom`), or `openai-compatible` for a local Ollama/LM Studio server, or `none` for 100% deterministic operation.
2. Specify your installed binary path/command and model name if overriding defaults.
3. Click **Test provider** to verify health before enabling data sharing consent.

No LLM API keys are stored in the SQLite database, settings JSON, backups, or logs.

## 3. PDF Export & Linux Chromium Dependencies

PDF generation uses Playwright Chromium with all external network routes blocked (`about:blank` / `data:` only):

```bash
npm run setup:pdf-browser
```

On headless Linux servers/containers, install shared browser system libraries once:

```bash
npx playwright install-deps chromium
```

If Chromium is absent, resume and cover letter exports return `422 PDF_BROWSER_MISSING` while DOCX, Markdown, and TXT exports remain fully available.

## 4. Backup, Restore & Full Reset

- **UI Backup & Restore:** In **Settings → Resume Defaults & Backups**, create snapshots, download `.tar.gz` archives, validate uploaded archives before restoring, and restore atomically (creating an automatic `pre_restore` safety backup and coordinating worker quiescing via `system_maintenance`).
- **Danger Zone Reset:** Requires typing `DELETE ALL LOCAL DATA` verbatim. Optionally saves a `pre_reset` archive, wipes SQLite/documents/exports, preserves `runtime/playwright-browsers`, and re-initializes a clean database.
- **CLI Recovery:** Use `node scripts/backup-local.mjs` and `node scripts/restore-local.mjs --file <archive.tar.gz>` when the web server is stopped.

## 5. Troubleshooting

- **`PDF_BROWSER_MISSING` on export:** Run `npm run setup:pdf-browser` (or set `PLAYWRIGHT_BROWSERS_PATH` / `PDF_BROWSER_EXECUTABLE_PATH`).
- **AI CLI not found (`ENOENT`):** Confirm the CLI binary (`claude`, `codex`, `opencode`, `agy`, `gemini`) is in your shell `$PATH` or enter its absolute executable path in Settings.
- **`MAINTENANCE_DRAIN_TIMEOUT` during restore:** Wait a few seconds for running background tasks to finish and retry. If the process crashed mid-maintenance, restart the worker or verify SQLite `system_maintenance` state resets to `normal`.
- **Port 3000 already in use:** Stop existing local dev servers or start with `PORT=3100 npx next start --hostname 127.0.0.1 -p 3100`.
