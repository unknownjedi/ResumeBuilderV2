"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";

const RESET_CONFIRMATION_PHRASE = "DELETE ALL LOCAL DATA";

export interface BackupArchiveItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  trigger: string;
  fileCount: number;
  dbChecksumSha256: string;
  validManifest: boolean;
}

export interface BackupManifestSummary {
  schemaVersion: number;
  createdAt: string;
  trigger: string;
  fileCount: number;
  dbChecksumSha256: string;
}

export interface BackupValidationPayload {
  valid: boolean;
  entryCount: number;
  totalUncompressedBytes: number;
  manifest: BackupManifestSummary;
}

type RestoreTarget =
  | { kind: "existing"; filename: string }
  | { kind: "upload"; file: File; filename: string };

interface ValidatedRestoreState {
  target: RestoreTarget;
  validation: BackupValidationPayload;
}

export interface BackupRestorePanelProps {
  /** Incremented by parent when an external backup creation completes. */
  refreshTrigger?: number;
  /** Whether to show a "Create backup now" button inside the panel header. */
  showCreateButton?: boolean;
  /** Called after restore or reset mutates the live workspace database. */
  onWorkspaceMutated?: () => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractApiError(body: unknown, status: number, fallback: string): string {
  const rec = asRecord(body);
  const nestedErr = rec ? asRecord(rec.error) : null;
  if (nestedErr && typeof nestedErr.message === "string" && nestedErr.message.trim()) {
    return nestedErr.message;
  }
  if (rec && typeof rec.error === "string" && rec.error.trim()) {
    return rec.error;
  }
  if (rec && typeof rec.message === "string" && rec.message.trim()) {
    return rec.message;
  }
  return `${fallback} (HTTP ${status}).`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTimestamp(iso: string): string {
  if (!iso) return "Unknown date";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString();
}

function triggerBadgeTone(trigger: string): BadgeTone {
  switch (trigger) {
    case "manual":
      return "accent";
    case "pre_restore":
    case "pre_reset":
      return "warning";
    default:
      return "neutral";
  }
}

function parseBackupsList(payload: unknown): BackupArchiveItem[] {
  const rec = asRecord(payload);
  const list = rec && Array.isArray(rec.backups) ? rec.backups : [];
  const items: BackupArchiveItem[] = [];

  for (const entry of list) {
    const item = asRecord(entry);
    if (!item || typeof item.filename !== "string") continue;
    items.push({
      filename: item.filename,
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : 0,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      trigger: typeof item.trigger === "string" ? item.trigger : "manual",
      fileCount: typeof item.fileCount === "number" ? item.fileCount : 0,
      dbChecksumSha256:
        typeof item.dbChecksumSha256 === "string" ? item.dbChecksumSha256 : "",
      validManifest: item.validManifest !== false,
    });
  }

  return items;
}

function parseValidationResponse(payload: unknown): BackupValidationPayload | null {
  const rec = asRecord(payload);
  const validation = rec ? asRecord(rec.validation) : null;
  if (!validation) return null;
  const manifest = asRecord(validation.manifest);
  if (!manifest) return null;

  return {
    valid: Boolean(validation.valid),
    entryCount:
      typeof validation.entryCount === "number" ? validation.entryCount : 0,
    totalUncompressedBytes:
      typeof validation.totalUncompressedBytes === "number"
        ? validation.totalUncompressedBytes
        : 0,
    manifest: {
      schemaVersion:
        typeof manifest.schemaVersion === "number" ? manifest.schemaVersion : 1,
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : "",
      trigger: typeof manifest.trigger === "string" ? manifest.trigger : "unknown",
      fileCount: typeof manifest.fileCount === "number" ? manifest.fileCount : 0,
      dbChecksumSha256:
        typeof manifest.dbChecksumSha256 === "string"
          ? manifest.dbChecksumSha256
          : "",
    },
  };
}

/**
 * Local .tar.gz backup archive list, two-step verified restore flow,
 * and confirmed Danger Zone workspace reset panel.
 */
export function BackupRestorePanel({
  refreshTrigger = 0,
  showCreateButton = true,
  onWorkspaceMutated,
}: BackupRestorePanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [backups, setBackups] = React.useState<BackupArchiveItem[]>([]);
  const [loadingBackups, setLoadingBackups] = React.useState(true);
  const [backupsError, setBackupsError] = React.useState<string | null>(null);
  const [creatingBackup, setCreatingBackup] = React.useState(false);

  const [confirmingDeleteFilename, setConfirmingDeleteFilename] = React.useState<
    string | null
  >(null);
  const [deletingFilename, setDeletingFilename] = React.useState<string | null>(null);

  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [validatingTargetLabel, setValidatingTargetLabel] = React.useState<
    string | null
  >(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const [validatedRestore, setValidatedRestore] =
    React.useState<ValidatedRestoreState | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);

  const [createSafetyBackup, setCreateSafetyBackup] = React.useState(true);
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false);
  const [resetConfirmText, setResetConfirmText] = React.useState("");
  const [resetting, setResetting] = React.useState(false);

  const requestBackupsList = React.useCallback(async () => {
    try {
      const response = await fetch("/api/backups", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          items: null as BackupArchiveItem[] | null,
          error: extractApiError(
            body,
            response.status,
            "Could not load backup archives"
          ),
        };
      }
      return {
        items: parseBackupsList(body),
        error: null as string | null,
      };
    } catch (error) {
      return {
        items: null as BackupArchiveItem[] | null,
        error:
          error instanceof Error
            ? error.message
            : "Could not load backup archives.",
      };
    }
  }, []);

  const fetchBackupsList = React.useCallback(async () => {
    setLoadingBackups(true);
    setBackupsError(null);
    const result = await requestBackupsList();
    if (result.items !== null) {
      setBackups(result.items);
    }
    setBackupsError(result.error);
    setLoadingBackups(false);
  }, [requestBackupsList]);

  React.useEffect(() => {
    let active = true;
    void requestBackupsList().then((result) => {
      if (!active) return;
      if (result.items !== null) {
        setBackups(result.items);
      }
      setBackupsError(result.error);
      setLoadingBackups(false);
    });
    return () => {
      active = false;
    };
  }, [requestBackupsList, refreshTrigger]);

  const handleCreateBackupNow = async () => {
    setCreatingBackup(true);
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          extractApiError(body, response.status, "Backup creation failed")
        );
      }
      const rec = asRecord(body);
      const backupObj = rec ? asRecord(rec.backup) : null;
      const filename =
        backupObj && typeof backupObj.filename === "string"
          ? backupObj.filename
          : null;

      toast({
        title: filename ? "Backup created" : "Backup completed",
        description: filename
          ? `Saved ${filename} to your local backups folder.`
          : "Local .tar.gz snapshot created.",
        tone: "accent",
      });
      await fetchBackupsList();
    } catch (error) {
      toast({
        title: "Backup failed",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    setDeletingFilename(filename);
    try {
      const response = await fetch(
        `/api/backups/${encodeURIComponent(filename)}`,
        { method: "DELETE" }
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          extractApiError(body, response.status, "Could not delete backup")
        );
      }
      toast({
        title: "Backup deleted",
        description: filename,
        tone: "neutral",
      });
      setConfirmingDeleteFilename(null);
      if (
        validatedRestore?.target.kind === "existing" &&
        validatedRestore.target.filename === filename
      ) {
        setValidatedRestore(null);
      }
      await fetchBackupsList();
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setDeletingFilename(null);
    }
  };

  const runRestoreValidation = async (target: RestoreTarget) => {
    setValidatingTargetLabel(target.filename);
    setValidationError(null);
    setValidatedRestore(null);

    try {
      let response: Response;
      if (target.kind === "existing") {
        response = await fetch("/api/restore/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: target.filename }),
        });
      } else {
        const formData = new FormData();
        formData.append("file", target.file);
        response = await fetch("/api/restore/validate", {
          method: "POST",
          body: formData,
        });
      }

      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          extractApiError(body, response.status, "Archive validation failed")
        );
      }

      const parsed = parseValidationResponse(body);
      if (!parsed || !parsed.valid) {
        throw new Error(
          "Archive failed manifest or SQLite integrity verification."
        );
      }

      setValidatedRestore({ target, validation: parsed });
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "Archive validation failed."
      );
    } finally {
      setValidatingTargetLabel(null);
    }
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setValidationError(null);
    setValidatedRestore(null);
    if (file) {
      void runRestoreValidation({ kind: "upload", file, filename: file.name });
    }
  };

  const clearRestoreSelection = () => {
    setSelectedFile(null);
    setValidatedRestore(null);
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleConfirmRestore = async () => {
    if (!validatedRestore) return;
    setRestoring(true);

    try {
      let response: Response;
      if (validatedRestore.target.kind === "existing") {
        response = await fetch("/api/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: validatedRestore.target.filename,
            confirmRestore: true,
          }),
        });
      } else {
        const formData = new FormData();
        formData.append("file", validatedRestore.target.file);
        formData.append("confirmRestore", "true");
        response = await fetch("/api/restore", {
          method: "POST",
          body: formData,
        });
      }

      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(extractApiError(body, response.status, "Restore failed"));
      }

      const rec = asRecord(body);
      const restoredCount =
        rec && typeof rec.restoredFileCount === "number"
          ? rec.restoredFileCount
          : validatedRestore.validation.manifest.fileCount;
      const preRestoreFilename =
        rec && typeof rec.preRestoreBackupFilename === "string"
          ? rec.preRestoreBackupFilename
          : null;

      toast({
        title: "Workspace restored",
        description: preRestoreFilename
          ? `Restored ${restoredCount} files. Safety backup: ${preRestoreFilename}`
          : `Restored ${restoredCount} files from archive.`,
        tone: "accent",
      });

      setRestoreDialogOpen(false);
      clearRestoreSelection();
      await fetchBackupsList();
      onWorkspaceMutated?.();
      router.refresh();
    } catch (error) {
      toast({
        title: "Restore failed",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setRestoring(false);
    }
  };

  const handleConfirmReset = async () => {
    if (resetConfirmText !== RESET_CONFIRMATION_PHRASE) return;
    setResetting(true);

    try {
      const response = await fetch("/api/data/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationText: RESET_CONFIRMATION_PHRASE,
          createSafetyBackup,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          extractApiError(body, response.status, "Could not delete local data")
        );
      }

      const rec = asRecord(body);
      const safetyFilename =
        rec && typeof rec.safetyBackupFilename === "string"
          ? rec.safetyBackupFilename
          : null;

      toast({
        title: "Local data deleted",
        description: safetyFilename
          ? `Workspace wiped. Safety backup saved as ${safetyFilename}.`
          : "All local database records, documents, and exports were deleted.",
        tone: "warning",
      });

      setResetDialogOpen(false);
      setResetConfirmText("");
      clearRestoreSelection();
      await fetchBackupsList();
      onWorkspaceMutated?.();
      router.refresh();
    } catch (error) {
      toast({
        title: "Reset failed",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setResetting(false);
    }
  };

  const isValidating = validatingTargetLabel !== null;

  return (
    <div className="space-y-8 border-t border-[var(--border)] pt-6">
      {/* 1) Backup Archives List */}
      <section className="space-y-3" aria-labelledby="backup-archives-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3
              id="backup-archives-heading"
              className="text-[15px] font-semibold text-[var(--text-primary)]"
            >
              Backup archives
            </h3>
            <p className="text-[13px] text-[var(--text-secondary)]">
              Verified <span className="font-data">.tar.gz</span> snapshots stored in your local backups directory.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showCreateButton ? (
              <Button
                variant="secondary"
                size="sm"
                loading={creatingBackup}
                onClick={() => void handleCreateBackupNow()}
              >
                <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                Create backup now
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={loadingBackups}
              onClick={() => void fetchBackupsList()}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>

        {loadingBackups ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : backupsError ? (
          <div
            role="alert"
            className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] text-[var(--text-secondary)]"
          >
            {backupsError}
          </div>
        ) : backups.length === 0 ? (
          <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
            No backup archives stored yet. Create a snapshot before making major changes.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface)]">
            {backups.map((backup) => {
              const isConfirmingDelete = confirmingDeleteFilename === backup.filename;
              const isDeletingThis = deletingFilename === backup.filename;
              const isValidatingThis = validatingTargetLabel === backup.filename;

              return (
                <div
                  key={backup.filename}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-data text-[13px] font-medium text-[var(--text-primary)]">
                        {backup.filename}
                      </span>
                      <Badge tone={triggerBadgeTone(backup.trigger)}>
                        {backup.trigger}
                      </Badge>
                      {!backup.validManifest ? (
                        <Badge tone="warning">Unverified manifest</Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-data text-[12px] text-[var(--text-secondary)]">
                      <span>{backup.fileCount} files</span>
                      <span>{formatBytes(backup.sizeBytes)}</span>
                      <span title={backup.dbChecksumSha256 || undefined}>
                        sha256:{" "}
                        {backup.dbChecksumSha256
                          ? backup.dbChecksumSha256.slice(0, 12)
                          : "—"}
                      </span>
                      <span>{formatTimestamp(backup.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <a
                      href={`/api/backups/${encodeURIComponent(backup.filename)}/download`}
                      download={backup.filename}
                      className={cn(
                        "inline-flex h-8 items-center justify-center gap-1.5 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-2.5 text-[13px] font-medium text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-muted)]",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                      )}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      Download
                    </a>

                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isValidating || isDeletingThis}
                      loading={isValidatingThis}
                      onClick={() =>
                        void runRestoreValidation({
                          kind: "existing",
                          filename: backup.filename,
                        })
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Restore
                    </Button>

                    {!isConfirmingDelete ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isDeletingThis}
                        aria-label={`Delete backup ${backup.filename}`}
                        onClick={() => setConfirmingDeleteFilename(backup.filename)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Delete
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-[4px] border border-[#E4B8B4] bg-[#F8EAE8] px-2 py-1">
                        <Button
                          variant="danger"
                          size="sm"
                          loading={isDeletingThis}
                          onClick={() => void handleDeleteBackup(backup.filename)}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isDeletingThis}
                          onClick={() => setConfirmingDeleteFilename(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2) Two-step Verified Restore Flow */}
      <section
        className="space-y-4 border-t border-[var(--border)] pt-6"
        aria-labelledby="restore-archive-heading"
      >
        <div>
          <h3
            id="restore-archive-heading"
            className="text-[15px] font-semibold text-[var(--text-primary)]"
          >
            Restore from archive
          </h3>
          <p className="text-[13px] text-[var(--text-secondary)]">
            Step 1 verifies the archive manifest and SQLite integrity. Step 2 creates an automatic <span className="font-data">pre_restore</span> safety backup before replacing live workspace data.
          </p>
        </div>

        <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <label
                htmlFor="restore-archive-upload"
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                Upload a local <span className="font-data">.tar.gz</span> backup archive
              </label>
              <p className="text-[12px] text-[var(--text-tertiary)]">
                Or click <span className="font-medium text-[var(--text-secondary)]">Restore</span> on any snapshot in the list above.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                id="restore-archive-upload"
                type="file"
                accept=".tar.gz,.tgz,application/gzip"
                disabled={isValidating || restoring}
                onChange={handleFileSelected}
                className="block max-w-[260px] text-[12px] text-[var(--text-secondary)] file:mr-2.5 file:inline-flex file:h-8 file:cursor-pointer file:items-center file:rounded-[4px] file:border file:border-[var(--control-border)] file:bg-[var(--surface-raised)] file:px-2.5 file:text-[13px] file:font-medium file:text-[var(--text-primary)] hover:file:bg-[var(--surface-muted)]"
              />
              {selectedFile ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isValidating || restoring}
                  onClick={() =>
                    void runRestoreValidation({
                      kind: "upload",
                      file: selectedFile,
                      filename: selectedFile.name,
                    })
                  }
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Re-validate
                </Button>
              ) : null}
            </div>
          </div>

          {isValidating ? (
            <div
              role="status"
              className="rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-2.5 text-[13px] text-[var(--text-secondary)]"
            >
              Verifying <span className="font-data">{validatingTargetLabel}</span> manifest and database integrity…
            </div>
          ) : null}

          {validationError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[6px] border border-[#E4B8B4] bg-[#F8EAE8] px-3.5 py-2.5 text-[13px] text-[var(--danger)]"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{validationError}</span>
            </div>
          ) : null}

          {validatedRestore ? (
            <div className="rounded-[6px] border border-[#C4D6CA] bg-[var(--surface-raised)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CheckCircle2
                    className="h-4 w-4 text-[var(--accent)]"
                    aria-hidden="true"
                  />
                  <span className="font-data text-[13px] font-semibold text-[var(--text-primary)]">
                    {validatedRestore.target.filename}
                  </span>
                  <Badge tone="accent">DB integrity OK</Badge>
                </div>
                <Badge tone={triggerBadgeTone(validatedRestore.validation.manifest.trigger)}>
                  {validatedRestore.validation.manifest.trigger}
                </Badge>
              </div>

              <dl className="grid gap-2 text-[12px] sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--text-tertiary)]">Created</dt>
                  <dd className="font-data text-[var(--text-primary)]">
                    {formatTimestamp(validatedRestore.validation.manifest.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-tertiary)]">Contents</dt>
                  <dd className="font-data text-[var(--text-primary)]">
                    {validatedRestore.validation.manifest.fileCount} files (
                    {validatedRestore.validation.entryCount} entries,{" "}
                    {formatBytes(validatedRestore.validation.totalUncompressedBytes)})
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-tertiary)]">Schema version</dt>
                  <dd className="font-data text-[var(--text-primary)]">
                    v{validatedRestore.validation.manifest.schemaVersion}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--text-tertiary)]">DB SHA-256</dt>
                  <dd className="break-all font-data text-[var(--text-primary)]">
                    {validatedRestore.validation.manifest.dbChecksumSha256 || "—"}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setRestoreDialogOpen(true)}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Continue to restore…
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearRestoreSelection}
                >
                  Clear
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* 3) Danger Zone */}
      <section
        className="space-y-3 border-t border-[var(--border)] pt-6"
        aria-labelledby="danger-zone-heading"
      >
        <div className="rounded-[8px] border border-[#E4B8B4] bg-[var(--surface)] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle
                className="h-4 w-4 text-[var(--danger)]"
                aria-hidden="true"
              />
              <h3
                id="danger-zone-heading"
                className="text-[15px] font-semibold text-[var(--text-primary)]"
              >
                Danger zone
              </h3>
            </div>
            <Badge tone="danger">Permanent local wipe</Badge>
          </div>

          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            Permanently wipe the local SQLite database, imported documents, and generated resume/cover-letter exports. Your Playwright Chromium runtime (<span className="font-data">runtime/playwright-browsers</span>) is preserved so PDF exports keep working immediately.
          </p>

          <div className="flex items-start justify-between gap-4 border-t border-[var(--border)] pt-4">
            <div>
              <label
                htmlFor="reset-safety-backup"
                className="text-[13px] font-medium text-[var(--text-primary)]"
              >
                Create <span className="font-data">pre_reset</span> safety archive before deleting
              </label>
              <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                Recommended. Stores one final <span className="font-data">.tar.gz</span> snapshot in your backups folder before clearing live data.
              </p>
            </div>
            <Switch
              id="reset-safety-backup"
              checked={createSafetyBackup}
              onCheckedChange={setCreateSafetyBackup}
            />
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <Button
              variant="danger"
              onClick={() => {
                setResetConfirmText("");
                setResetDialogOpen(true);
              }}
            >
              Delete all local data
            </Button>
          </div>
        </div>
      </section>

      {/* Step 2 Restore Confirmation Dialog */}
      <Dialog
        open={restoreDialogOpen}
        onOpenChange={(open) => {
          if (!restoring) setRestoreDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm workspace restore</DialogTitle>
            <DialogDescription>
              Restoring replaces your live SQLite database, imported documents, and exports. An automatic <span className="font-data">pre_restore</span> backup archive will be created before applying changes.
            </DialogDescription>
          </DialogHeader>

          {validatedRestore ? (
            <div className="mt-4 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3.5 text-[12px] space-y-1.5">
              <div className="font-data font-semibold text-[var(--text-primary)]">
                {validatedRestore.target.filename}
              </div>
              <div className="font-data text-[var(--text-secondary)]">
                Created: {formatTimestamp(validatedRestore.validation.manifest.createdAt)}
              </div>
              <div className="font-data text-[var(--text-secondary)]">
                Files: {validatedRestore.validation.manifest.fileCount} · Trigger:{" "}
                {validatedRestore.validation.manifest.trigger}
              </div>
              <div className="break-all font-data text-[var(--text-tertiary)]">
                SHA-256: {validatedRestore.validation.manifest.dbChecksumSha256}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="secondary"
              disabled={restoring}
              onClick={() => setRestoreDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={restoring}
              onClick={() => void handleConfirmRestore()}
            >
              Restore workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Danger Zone Delete All Confirmation Dialog */}
      <Dialog
        open={resetDialogOpen}
        onOpenChange={(open) => {
          if (!resetting) {
            setResetDialogOpen(open);
            if (!open) setResetConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all local data</DialogTitle>
            <DialogDescription>
              This permanently removes all SQLite records, imported documents, and exported PDFs/DOCX files.{" "}
              {createSafetyBackup
                ? "A pre_reset safety backup archive will be created first."
                : "Safety backup is disabled; deleted data cannot be recovered."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-2">
            <label
              htmlFor="delete-confirmation-input"
              className="block text-[13px] font-medium text-[var(--text-primary)]"
            >
              Type{" "}
              <span className="font-data font-semibold text-[var(--danger)]">
                {RESET_CONFIRMATION_PHRASE}
              </span>{" "}
              to confirm
            </label>
            <Input
              id="delete-confirmation-input"
              className="font-data"
              autoComplete="off"
              spellCheck={false}
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              placeholder={RESET_CONFIRMATION_PHRASE}
              disabled={resetting}
            />
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              disabled={resetting}
              onClick={() => {
                setResetDialogOpen(false);
                setResetConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={resetting}
              disabled={resetConfirmText !== RESET_CONFIRMATION_PHRASE}
              onClick={() => void handleConfirmReset()}
            >
              Delete all local data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
