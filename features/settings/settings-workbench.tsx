"use client";

import * as React from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardCopy,
  RefreshCw,
  Terminal,
  XCircle,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { useSse } from "@/components/shell/sse-provider";
import { SourcesManager } from "@/features/job-sources/sources-manager";
import { BackupRestorePanel } from "@/features/settings/backup-restore-panel";

export type AiProviderPreset =
  | "none"
  | "claude"
  | "codex"
  | "opencode"
  | "agy"
  | "gemini"
  | "custom"
  | "openai-compatible";

export type PaperSize = "A4" | "Letter";

interface CliAvailabilityEntry {
  available: boolean;
  command?: string;
  version?: string;
}

interface SettingsFormState {
  aiProvider: AiProviderPreset;
  aiModel: string;
  aiCliCommand: string;
  aiCliArgsTemplate: string;
  aiBaseUrl: string;
  aiTemperature: number;
  dataSharingConsent: boolean;
  maxJobsPerAnalysisAction: number;
  dailyAnalysisBudget: number;
  defaultPaperSize: PaperSize;
  scheduledBackupsEnabled: boolean;
  backupRetentionCount: number;
}

interface BackgroundTaskItem {
  id: string;
  taskType: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progressStage?: string | null;
  progressPercent?: number | null;
  cancelRequestedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
}

interface AiTestResult {
  ok: boolean;
  provider?: string;
  model?: string;
  latencyMs?: number;
  message: string;
}

const DEFAULT_FORM: SettingsFormState = {
  aiProvider: "none",
  aiModel: "",
  aiCliCommand: "",
  aiCliArgsTemplate: "",
  aiBaseUrl: "",
  aiTemperature: 0.2,
  dataSharingConsent: false,
  maxJobsPerAnalysisAction: 10,
  dailyAnalysisBudget: 25,
  defaultPaperSize: "A4",
  scheduledBackupsEnabled: false,
  backupRetentionCount: 10,
};

const AI_PRESETS: Array<{
  value: AiProviderPreset;
  label: string;
  binary?: string;
  description: string;
  modelPlaceholder: string;
}> = [
  {
    value: "none",
    label: "None / No-AI Mode",
    description:
      "Deterministic parsing, matching, resume editing, and DOCX/PDF exports without invoking any LLM.",
    modelPlaceholder: "Not used in No-AI mode",
  },
  {
    value: "claude",
    label: "Claude Code (claude)",
    binary: "claude",
    description: "Uses your local authenticated `claude` CLI binary.",
    modelPlaceholder: "sonnet, opus, or full model ID",
  },
  {
    value: "codex",
    label: "Codex (codex)",
    binary: "codex",
    description: "Uses your local authenticated `codex` CLI binary.",
    modelPlaceholder: "gpt-5.4 or preferred Codex model",
  },
  {
    value: "opencode",
    label: "OpenCode (opencode)",
    binary: "opencode",
    description: "Runs your local `opencode` CLI headlessly in the background.",
    modelPlaceholder: "opencode-go/deepseek-v4.1-flash or provider/model",
  },
  {
    value: "agy",
    label: "Antigravity CLI (agy)",
    binary: "agy",
    description:
      "Runs a standalone headless `agy` CLI binary in the background (never launches desktop apps).",
    modelPlaceholder: "Standalone headless CLI model ID",
  },
  {
    value: "gemini",
    label: "Gemini CLI (gemini)",
    binary: "gemini",
    description: "Uses your local authenticated `gemini` CLI binary.",
    modelPlaceholder: "gemini-2.5-pro or gemini-2.5-flash",
  },
  {
    value: "custom",
    label: "Custom CLI",
    description:
      "Invoke any local CLI executable with an explicit argument template.",
    modelPlaceholder: "Optional model name passed to template",
  },
  {
    value: "openai-compatible",
    label: "Local OpenAI-compatible HTTP",
    description:
      "Connect to a local model server (Ollama, LM Studio, vLLM, llama.cpp) over HTTP.",
    modelPlaceholder: "qwen2.5:14b or local model identifier",
  },
];

function isValidPreset(value: unknown): value is AiProviderPreset {
  return (
    typeof value === "string" &&
    AI_PRESETS.some((preset) => preset.value === value)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string") return val;
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return undefined;
}

function pickBoolean(obj: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "boolean") return val;
  }
  return undefined;
}

function parseSettingsPayload(payload: unknown): {
  form: SettingsFormState;
  cliAvailability: Record<string, CliAvailabilityEntry>;
} {
  const root = asRecord(payload) ?? {};
  const settings = asRecord(root.settings) ?? root;
  const ai = asRecord(settings.ai) ?? settings;
  const resume = asRecord(settings.resume) ?? settings;
  const backup = asRecord(settings.backup) ?? settings;

  const rawProvider = pickString(ai, ["provider", "aiProvider", "ai_provider"]);
  const rawPaper = pickString(resume, [
    "defaultPaperSize",
    "paperSize",
    "default_paper_size",
  ]);

  const form: SettingsFormState = {
    aiProvider: isValidPreset(rawProvider) ? rawProvider : "none",
    aiModel: pickString(ai, ["model", "aiModel", "ai_model"]) ?? "",
    aiCliCommand:
      pickString(ai, ["cliCommand", "aiCliCommand", "ai_cli_command"]) ?? "",
    aiCliArgsTemplate:
      pickString(ai, [
        "cliArgsTemplate",
        "aiCliArgsTemplate",
        "ai_cli_args_template",
      ]) ?? "",
    aiBaseUrl: pickString(ai, ["baseUrl", "aiBaseUrl", "ai_base_url"]) ?? "",
    aiTemperature:
      pickNumber(ai, ["temperature", "aiTemperature", "ai_temperature"]) ?? 0.2,
    dataSharingConsent:
      pickBoolean(ai, [
        "dataSharingAccepted",
        "dataSharingConsent",
        "data_sharing_consent",
      ]) ?? false,
    maxJobsPerAnalysisAction:
      pickNumber(ai, [
        "actionAnalysisCap",
        "maxJobsPerAction",
        "maxJobsPerAnalysisAction",
        "max_jobs_per_analysis_action",
      ]) ?? 10,
    dailyAnalysisBudget:
      pickNumber(ai, [
        "dailyAnalysisCap",
        "dailyAnalysisBudget",
        "dailyBudget",
        "daily_analysis_budget",
      ]) ?? 25,
    defaultPaperSize: rawPaper === "Letter" ? "Letter" : "A4",
    scheduledBackupsEnabled:
      pickBoolean(settings, [
        "scheduledBackupsEnabled",
        "scheduledEnabled",
        "scheduled_backups_enabled",
      ]) ??
      pickBoolean(backup, [
        "scheduledEnabled",
        "scheduledBackupsEnabled",
        "scheduled_backups_enabled",
      ]) ??
      false,
    backupRetentionCount:
      pickNumber(settings, [
        "backupRetentionCount",
        "retentionCount",
        "backup_retention_count",
      ]) ??
      pickNumber(backup, [
        "retentionCount",
        "backupRetentionCount",
        "backup_retention_count",
      ]) ??
      10,
  };

  const cliAvailability: Record<string, CliAvailabilityEntry> = {};
  if (Array.isArray(root.detectedClis)) {
    for (const entry of root.detectedClis) {
      const rec = asRecord(entry);
      const provider = rec
        ? pickString(rec, ["id", "provider"]) ?? null
        : null;
      if (provider && typeof rec?.available === "boolean") {
        cliAvailability[provider] = {
          available: rec.available,
          command: typeof rec.command === "string" ? rec.command : undefined,
          version: typeof rec.resolvedPath === "string" ? rec.resolvedPath : undefined,
        };
      }
    }
  } else {
    const rawAvailability =
      asRecord(root.cliAvailability) ??
      asRecord(root.detectedClis) ??
      asRecord(root.cliDetection) ??
      asRecord(ai.cliAvailability);

    if (rawAvailability) {
      for (const [key, val] of Object.entries(rawAvailability)) {
        if (typeof val === "boolean") {
          cliAvailability[key] = { available: val };
        } else {
          const entry = asRecord(val);
          if (entry && typeof entry.available === "boolean") {
            cliAvailability[key] = {
              available: entry.available,
              command: typeof entry.command === "string" ? entry.command : undefined,
              version: typeof entry.version === "string" ? entry.version : undefined,
            };
          }
        }
      }
    }
  }

  return { form, cliAvailability };
}

function taskStatusTone(
  status: BackgroundTaskItem["status"]
): "neutral" | "accent" | "warning" | "danger" {
  switch (status) {
    case "succeeded":
      return "accent";
    case "running":
    case "queued":
      return "neutral";
    case "cancelled":
      return "warning";
    case "failed":
      return "danger";
  }
}

function formatDiagnosticValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  return JSON.stringify(value);
}

/**
 * Settings workbench covering AI CLI configuration (zero API keys),
 * resume/backup defaults, redacted diagnostics, and live background task monitoring.
 */
export function SettingsWorkbench() {
  const { toast } = useToast();
  const { subscribe, broadcastUnavailable, connectionState } = useSse();

  const [form, setForm] = React.useState<SettingsFormState>(DEFAULT_FORM);
  const [savedDailyBudget, setSavedDailyBudget] = React.useState<number>(25);
  const [budgetOverrideConfirmed, setBudgetOverrideConfirmed] = React.useState(false);
  const [cliAvailability, setCliAvailability] = React.useState<
    Record<string, CliAvailabilityEntry>
  >({});

  const [settingsLoading, setSettingsLoading] = React.useState(true);
  const [settingsUnavailable, setSettingsUnavailable] = React.useState<string | null>(
    null
  );
  const [savingSettings, setSavingSettings] = React.useState(false);

  const [testingAi, setTestingAi] = React.useState(false);
  const [aiTestResult, setAiTestResult] = React.useState<AiTestResult | null>(null);

  const [confirmingBackup, setConfirmingBackup] = React.useState(false);
  const [runningBackup, setRunningBackup] = React.useState(false);
  const [backupRefreshTrigger, setBackupRefreshTrigger] = React.useState(0);

  const [diagnostics, setDiagnostics] = React.useState<Record<string, unknown> | null>(
    null
  );
  const [diagnosticsLoading, setDiagnosticsLoading] = React.useState(true);
  const [diagnosticsError, setDiagnosticsError] = React.useState<string | null>(null);

  const [tasks, setTasks] = React.useState<BackgroundTaskItem[]>([]);
  const [tasksLoading, setTasksLoading] = React.useState(true);
  const [tasksError, setTasksError] = React.useState<string | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = React.useState<string | null>(null);

  const fetchSettingsRequest = React.useCallback(async () => {
    try {
      const response = await fetch("/api/settings", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return {
          unavailable: `Settings API returned HTTP ${response.status}. Defaults shown below.`,
          parsed: null,
        };
      }
      const data: unknown = await response.json();
      return {
        unavailable: null,
        parsed: parseSettingsPayload(data),
      };
    } catch {
      return {
        unavailable: "Settings API is not reachable yet. Defaults shown below.",
        parsed: null,
      };
    }
  }, []);

  const fetchDiagnosticsRequest = React.useCallback(async () => {
    try {
      const response = await fetch("/api/diagnostics", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return {
          error: `Diagnostics endpoint returned HTTP ${response.status}.`,
          data: null,
        };
      }
      const data: unknown = await response.json();
      const rec = asRecord(data);
      const diag = rec && asRecord(rec.diagnostics) ? asRecord(rec.diagnostics) : rec;
      return {
        error: null,
        data: diag ?? { report: data },
      };
    } catch {
      return {
        error: "Diagnostics endpoint is not reachable yet.",
        data: null,
      };
    }
  }, []);

  const fetchTasksRequest = React.useCallback(async () => {
    try {
      const response = await fetch("/api/tasks?limit=20", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return {
          error: `Tasks endpoint returned HTTP ${response.status}.`,
          items: null,
        };
      }
      const data: unknown = await response.json();
      const raw = Array.isArray(data)
        ? data
        : data &&
            typeof data === "object" &&
            Array.isArray((data as { items?: unknown }).items)
          ? (data as { items: unknown[] }).items
          : data &&
              typeof data === "object" &&
              Array.isArray((data as { tasks?: unknown }).tasks)
            ? (data as { tasks: unknown[] }).tasks
            : [];

      const parsed: BackgroundTaskItem[] = raw.filter(
        (item): item is BackgroundTaskItem =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as { id?: unknown }).id === "string" &&
              typeof (item as { taskType?: unknown }).taskType === "string" &&
              typeof (item as { status?: unknown }).status === "string"
          )
      );
      return {
        error: null,
        items: parsed,
      };
    } catch {
      return {
        error: "Tasks endpoint is not reachable yet.",
        items: null,
      };
    }
  }, []);

  const applyDiagnosticsResult = React.useCallback(
    (result: { error: string | null; data: Record<string, unknown> | null }) => {
      setDiagnosticsError(result.error);
      setDiagnostics(result.data);
      setDiagnosticsLoading(false);
    },
    []
  );

  const applyTasksResult = React.useCallback(
    (result: { error: string | null; items: BackgroundTaskItem[] | null }) => {
      setTasksError(result.error);
      if (result.items !== null) {
        setTasks(result.items);
      }
      setTasksLoading(false);
    },
    []
  );

  const loadDiagnostics = React.useCallback(async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsError(null);
    const result = await fetchDiagnosticsRequest();
    applyDiagnosticsResult(result);
  }, [applyDiagnosticsResult, fetchDiagnosticsRequest]);

  const applySettingsResult = React.useCallback(
    (res: Awaited<ReturnType<typeof fetchSettingsRequest>>) => {
      setSettingsUnavailable(res.unavailable);
      if (res.parsed) {
        setForm(res.parsed.form);
        setSavedDailyBudget(res.parsed.form.dailyAnalysisBudget);
        setCliAvailability(res.parsed.cliAvailability);
        setBudgetOverrideConfirmed(res.parsed.form.dailyAnalysisBudget > 25);
      }
      setSettingsLoading(false);
    },
    []
  );

  const loadTasks = React.useCallback(async () => {
    setTasksError(null);
    const result = await fetchTasksRequest();
    applyTasksResult(result);
  }, [applyTasksResult, fetchTasksRequest]);

  React.useEffect(() => {
    let active = true;

    void fetchSettingsRequest().then((res) => {
      if (!active) return;
      applySettingsResult(res);
    });

    void fetchDiagnosticsRequest().then((res) => {
      if (!active) return;
      applyDiagnosticsResult(res);
    });

    void fetchTasksRequest().then((res) => {
      if (!active) return;
      applyTasksResult(res);
    });

    return () => {
      active = false;
    };
  }, [
    applyDiagnosticsResult,
    applySettingsResult,
    applyTasksResult,
    fetchDiagnosticsRequest,
    fetchSettingsRequest,
    fetchTasksRequest,
  ]);

  // Refresh recent tasks when SSE delivers task events, reset, or 30s paused fallback poll.
  React.useEffect(() => {
    return subscribe((msg) => {
      if (
        msg.kind === "reset" ||
        msg.kind === "poll" ||
        (msg.kind === "event" && msg.event.eventType.startsWith("task."))
      ) {
        void loadTasks();
      }
    });
  }, [loadTasks, subscribe]);

  const requiresBudgetConfirmation =
    form.dailyAnalysisBudget > 25 &&
    form.dailyAnalysisBudget !== savedDailyBudget &&
    !budgetOverrideConfirmed;

  const handleSaveSettings = async (section: "ai" | "defaults") => {
    if (section === "ai" && requiresBudgetConfirmation) {
      toast({
        title: "Confirmation required",
        description:
          "Acknowledge the daily analysis budget warning before raising the cap above 25.",
        tone: "warning",
      });
      return;
    }

    setSavingSettings(true);
    try {
      const dailyCap = Math.max(1, Math.round(form.dailyAnalysisBudget || 25));
      const actionCap = Math.max(1, Math.round(form.maxJobsPerAnalysisAction || 10));
      const payload = {
        ai: {
          provider: form.aiProvider,
          model: form.aiModel.trim(),
          cliCommand: form.aiCliCommand.trim(),
          cliArgsTemplate: form.aiCliArgsTemplate.trim(),
          baseUrl: form.aiBaseUrl.trim(),
          temperature: Number.isFinite(form.aiTemperature) ? form.aiTemperature : 0.2,
          dataSharingAccepted: form.dataSharingConsent,
          actionAnalysisCap: actionCap,
          dailyAnalysisCap: dailyCap,
        },
        defaultPaperSize: form.defaultPaperSize,
        scheduledBackupsEnabled: form.scheduledBackupsEnabled,
        backupRetentionCount: Math.max(
          1,
          Math.round(form.backupRetentionCount || 10)
        ),
      };

      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errBody = asRecord(await response.json().catch(() => null));
        const nestedErr = errBody ? asRecord(errBody.error) : null;
        const msg =
          (nestedErr && typeof nestedErr.message === "string" && nestedErr.message) ||
          (errBody && typeof errBody.error === "string" && errBody.error) ||
          `Failed with HTTP ${response.status}`;
        throw new Error(msg);
      }

      setSavedDailyBudget(dailyCap);
      toast({
        title:
          section === "ai" ? "AI provider settings saved" : "Workspace defaults saved",
        tone: "accent",
      });
      void loadDiagnostics();
    } catch (error) {
      toast({
        title: "Could not save settings",
        description:
          error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestAiCli = async () => {
    setTestingAi(true);
    setAiTestResult(null);
    try {
      const response = await fetch("/api/settings/ai-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: form.aiProvider,
          model: form.aiModel.trim(),
          cliCommand: form.aiCliCommand.trim(),
          cliArgsTemplate: form.aiCliArgsTemplate.trim(),
          baseUrl: form.aiBaseUrl.trim(),
          temperature: form.aiTemperature,
        }),
      });

      const body = asRecord(await response.json().catch(() => null));
      const resObj = (body && asRecord(body.result)) ?? body;

      if (!response.ok || (resObj && resObj.ok === false)) {
        const nestedErr = body ? asRecord(body.error) : null;
        const errorText =
          (resObj && typeof resObj.message === "string" && resObj.message) ||
          (nestedErr && typeof nestedErr.message === "string" && nestedErr.message) ||
          (body && typeof body.error === "string" && body.error) ||
          `AI CLI test failed (HTTP ${response.status}).`;
        setAiTestResult({
          ok: false,
          message: errorText,
        });
        return;
      }

      setAiTestResult({
        ok: true,
        provider:
          (resObj && typeof resObj.provider === "string" && resObj.provider) ||
          form.aiProvider,
        model:
          (resObj && typeof resObj.model === "string" && resObj.model) ||
          form.aiModel ||
          undefined,
        latencyMs:
          resObj && typeof resObj.latencyMs === "number" ? resObj.latencyMs : undefined,
        message:
          (resObj && typeof resObj.message === "string" && resObj.message) ||
          "Local AI CLI responded with valid structured output.",
      });
    } catch {
      setAiTestResult({
        ok: false,
        message:
          "Could not reach POST /api/settings/ai-test. Verify the local server is running.",
      });
    } finally {
      setTestingAi(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    setCancellingTaskId(taskId);
    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(taskId)}/cancel`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      toast({
        title: "Cancellation requested",
        description: `Task ${taskId.slice(0, 8)} will stop at its next safe checkpoint.`,
        tone: "neutral",
      });
      void loadTasks();
    } catch (error) {
      toast({
        title: "Could not cancel task",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setCancellingTaskId(null);
    }
  };

  const handleWorkspaceMutated = React.useCallback(() => {
    void fetchSettingsRequest().then(applySettingsResult);
    void loadDiagnostics();
    void loadTasks();
  }, [applySettingsResult, fetchSettingsRequest, loadDiagnostics, loadTasks]);

  const handleCreateBackup = async () => {
    setRunningBackup(true);
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const rec = asRecord(body);
        const nestedErr = rec ? asRecord(rec.error) : null;
        const msg =
          (nestedErr && typeof nestedErr.message === "string" && nestedErr.message) ||
          (rec && typeof rec.error === "string" && rec.error) ||
          `HTTP ${response.status}`;
        throw new Error(msg);
      }
      const rec = asRecord(body);
      const backup = rec ? asRecord(rec.backup) : null;
      if (backup && typeof backup.filename === "string") {
        toast({
          title: "Backup created",
          description: `Saved ${backup.filename}.`,
          tone: "accent",
        });
        setBackupRefreshTrigger((prev) => prev + 1);
        void loadDiagnostics();
      } else {
        toast({
          title: "Backup queued",
          description: "Check Diagnostics & Tasks for progress.",
          tone: "accent",
        });
        void loadTasks();
      }
      setConfirmingBackup(false);
    } catch (error) {
      toast({
        title: "Backup failed to start",
        description: error instanceof Error ? error.message : "Request failed.",
        tone: "danger",
      });
    } finally {
      setRunningBackup(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    if (!diagnostics) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      toast({
        title: "Diagnostics copied",
        description: "Redacted JSON report copied to clipboard.",
        tone: "accent",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard permission was denied.",
        tone: "warning",
      });
    }
  };

  const activePresetMeta =
    AI_PRESETS.find((preset) => preset.value === form.aiProvider) ?? AI_PRESETS[0];
  const isCliPreset =
    form.aiProvider === "claude" ||
    form.aiProvider === "codex" ||
    form.aiProvider === "opencode" ||
    form.aiProvider === "agy" ||
    form.aiProvider === "gemini" ||
    form.aiProvider === "custom";

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--border)] pb-4">
        <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
          Workspace settings
        </h2>
        <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
          Configure your local AI CLI provider without storing API keys, manage resume and backup defaults, and inspect runtime diagnostics.
        </p>
      </div>

      {settingsUnavailable ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] text-[var(--text-secondary)]"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
            aria-hidden="true"
          />
          <span>{settingsUnavailable}</span>
        </div>
      ) : null}

      <Tabs defaultValue="ai" indicatorId="settings-tabs">
        <TabsList aria-label="Settings sections" className="overflow-x-auto">
          <TabsTrigger value="ai">AI Provider (CLI-first)</TabsTrigger>
          <TabsTrigger value="sources">Job Sources</TabsTrigger>
          <TabsTrigger value="defaults">Resume Defaults &amp; Backups</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics &amp; Recent Tasks</TabsTrigger>
        </TabsList>

        {/* 1) AI Provider */}
        <TabsContent value="ai" className="space-y-6">
          {settingsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-80" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-6">
                <section className="space-y-3">
                  <div>
                    <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                      Provider preset
                    </h3>
                    <p className="text-[13px] text-[var(--text-secondary)]">
                      Zero API keys are collected or stored. Select a locally authenticated CLI tool, a local OpenAI-compatible HTTP endpoint, or No-AI mode.
                    </p>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {AI_PRESETS.map((preset) => {
                      const selected = form.aiProvider === preset.value;
                      const probe = preset.binary
                        ? cliAvailability[preset.value] ?? cliAvailability[preset.binary]
                        : undefined;

                      return (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => {
                            setForm((prev) => ({
                              ...prev,
                              aiProvider: preset.value,
                            }));
                            setAiTestResult(null);
                          }}
                          aria-pressed={selected}
                          className={cn(
                            "flex flex-col items-start gap-1.5 rounded-[6px] border p-3 text-left transition-colors duration-150",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                            selected
                              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--control-border)] hover:bg-[var(--surface-raised)]"
                          )}
                        >
                          <div className="flex w-full items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                              {preset.label}
                            </span>
                            {preset.binary ? (
                              probe ? (
                                <Badge tone={probe.available ? "accent" : "neutral"}>
                                  {probe.available ? "Detected" : "Not in PATH"}
                                </Badge>
                              ) : (
                                <Badge tone="neutral">CLI</Badge>
                              )
                            ) : null}
                          </div>
                          <span className="text-[12px] leading-4 text-[var(--text-secondary)]">
                            {preset.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="space-y-4 border-t border-[var(--border)] pt-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="ai-model"
                        className="block text-[13px] font-medium text-[var(--text-primary)]"
                      >
                        Model name
                      </label>
                      <Input
                        id="ai-model"
                        value={form.aiModel}
                        disabled={form.aiProvider === "none"}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, aiModel: e.target.value }))
                        }
                        placeholder={activePresetMeta.modelPlaceholder}
                      />
                      <p className="text-[12px] text-[var(--text-tertiary)]">
                        Enter any model alias or identifier you own in your CLI or server.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="ai-temperature"
                        className="block text-[13px] font-medium text-[var(--text-primary)]"
                      >
                        Temperature
                      </label>
                      <Input
                        id="ai-temperature"
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        disabled={form.aiProvider === "none"}
                        className="font-data"
                        value={form.aiTemperature}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            aiTemperature: Number.parseFloat(e.target.value) || 0,
                          }))
                        }
                      />
                      <p className="text-[12px] text-[var(--text-tertiary)]">
                        Lower values (0.0–0.3) keep structured extraction deterministic.
                      </p>
                    </div>
                  </div>

                  {form.aiProvider === "openai-compatible" ? (
                    <div className="space-y-1.5">
                      <label
                        htmlFor="ai-base-url"
                        className="block text-[13px] font-medium text-[var(--text-primary)]"
                      >
                        Local OpenAI-compatible Base URL
                      </label>
                      <Input
                        id="ai-base-url"
                        type="url"
                        className="font-data"
                        value={form.aiBaseUrl}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, aiBaseUrl: e.target.value }))
                        }
                        placeholder="http://127.0.0.1:11434/v1"
                      />
                      <p className="text-[12px] text-[var(--text-tertiary)]">
                        Uses Chat Completions JSON output against your local server.
                      </p>
                    </div>
                  ) : null}

                  {isCliPreset ? (
                    form.aiProvider === "custom" ? (
                      <div className="grid gap-4 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <label
                            htmlFor="ai-cli-command"
                            className="block text-[13px] font-medium text-[var(--text-primary)]"
                          >
                            Custom CLI executable
                          </label>
                          <Input
                            id="ai-cli-command"
                            className="font-data"
                            value={form.aiCliCommand}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                aiCliCommand: e.target.value,
                              }))
                            }
                            placeholder="my-local-llm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label
                            htmlFor="ai-cli-args"
                            className="block text-[13px] font-medium text-[var(--text-primary)]"
                          >
                            Argument template
                          </label>
                          <Input
                            id="ai-cli-args"
                            className="font-data"
                            value={form.aiCliArgsTemplate}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                aiCliArgsTemplate: e.target.value,
                              }))
                            }
                            placeholder="--model {{model}} --prompt {{prompt}}"
                          />
                        </div>
                      </div>
                    ) : (
                      <Accordion type="single" collapsible>
                        <AccordionItem value="cli-override">
                          <AccordionTrigger>
                            Optional CLI binary &amp; argument override
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="grid gap-4 pt-1 sm:grid-cols-2">
                              <div className="space-y-1.5">
                                <label
                                  htmlFor="ai-cli-command"
                                  className="block text-[13px] font-medium text-[var(--text-primary)]"
                                >
                                  Override command
                                </label>
                                <Input
                                  id="ai-cli-command"
                                  className="font-data"
                                  value={form.aiCliCommand}
                                  onChange={(e) =>
                                    setForm((prev) => ({
                                      ...prev,
                                      aiCliCommand: e.target.value,
                                    }))
                                  }
                                  placeholder={activePresetMeta.binary ?? "claude"}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label
                                  htmlFor="ai-cli-args"
                                  className="block text-[13px] font-medium text-[var(--text-primary)]"
                                >
                                  Argument template
                                </label>
                                <Input
                                  id="ai-cli-args"
                                  className="font-data"
                                  value={form.aiCliArgsTemplate}
                                  onChange={(e) =>
                                    setForm((prev) => ({
                                      ...prev,
                                      aiCliArgsTemplate: e.target.value,
                                    }))
                                  }
                                  placeholder="Optional override args"
                                />
                              </div>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    )
                  ) : null}
                </section>

                <section className="space-y-4 border-t border-[var(--border)] pt-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <label
                        htmlFor="data-sharing-consent"
                        className="text-[14px] font-medium text-[var(--text-primary)]"
                      >
                        Data-sharing consent for AI tasks
                      </label>
                      <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                        Required before sending job descriptions or selected verified career facts to your configured CLI or model endpoint.
                      </p>
                    </div>
                    <Switch
                      id="data-sharing-consent"
                      checked={form.dataSharingConsent}
                      onCheckedChange={(checked) =>
                        setForm((prev) => ({ ...prev, dataSharingConsent: checked }))
                      }
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="max-jobs-action"
                        className="block text-[13px] font-medium text-[var(--text-primary)]"
                      >
                        Per-action analysis cap
                      </label>
                      <Input
                        id="max-jobs-action"
                        type="number"
                        min={1}
                        max={50}
                        className="font-data"
                        value={form.maxJobsPerAnalysisAction}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            maxJobsPerAnalysisAction:
                              Number.parseInt(e.target.value, 10) || 1,
                          }))
                        }
                      />
                      <p className="text-[12px] text-[var(--text-tertiary)]">
                        Default: 10 unique job descriptions per manual action.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="daily-analysis-budget"
                        className="block text-[13px] font-medium text-[var(--text-primary)]"
                      >
                        Daily analysis cap
                      </label>
                      <Input
                        id="daily-analysis-budget"
                        type="number"
                        min={0}
                        max={500}
                        className="font-data"
                        value={form.dailyAnalysisBudget}
                        onChange={(e) => {
                          const nextVal = Number.parseInt(e.target.value, 10);
                          setForm((prev) => ({
                            ...prev,
                            dailyAnalysisBudget: Number.isNaN(nextVal) ? 0 : nextVal,
                          }));
                        }}
                      />
                      <p className="text-[12px] text-[var(--text-tertiary)]">
                        Default: 25 job analyses per local calendar day.
                      </p>
                    </div>
                  </div>

                  {form.dailyAnalysisBudget > 25 ? (
                    <div className="rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] p-3.5 text-[13px] text-[var(--text-primary)]">
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
                          aria-hidden="true"
                        />
                        <div className="space-y-2">
                          <p className="font-medium text-[var(--warning)]">
                            Daily budget exceeds the default cap of 25
                          </p>
                          <p className="text-[var(--text-secondary)]">
                            Raising this limit allows more LLM CLI invocations per day and may increase provider usage or cost.
                          </p>
                          {form.dailyAnalysisBudget !== savedDailyBudget ? (
                            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                              <input
                                type="checkbox"
                                checked={budgetOverrideConfirmed}
                                onChange={(e) =>
                                  setBudgetOverrideConfirmed(e.target.checked)
                                }
                                className="h-4 w-4 accent-[var(--accent)]"
                              />
                              <span>I understand and want to raise the daily cap</span>
                            </label>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-5">
                  <Button
                    variant="primary"
                    loading={savingSettings}
                    onClick={() => void handleSaveSettings("ai")}
                  >
                    Save AI settings
                  </Button>
                  <Button
                    variant="secondary"
                    loading={testingAi}
                    onClick={() => void handleTestAiCli()}
                  >
                    <Terminal className="h-4 w-4" aria-hidden="true" />
                    Test AI CLI
                  </Button>
                </div>

                {aiTestResult ? (
                  <div
                    role="status"
                    className={cn(
                      "rounded-[6px] border p-3.5 text-[13px]",
                      aiTestResult.ok
                        ? "border-[#C4D6CA] bg-[var(--accent-soft)] text-[var(--text-primary)]"
                        : "border-[#E4B8B4] bg-[#F8EAE8] text-[var(--text-primary)]"
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {aiTestResult.ok ? (
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                      ) : (
                        <XCircle
                          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">
                            {aiTestResult.ok ? "AI CLI check passed" : "AI CLI check failed"}
                          </span>
                          {aiTestResult.model ? (
                            <span className="font-data text-[12px] text-[var(--text-secondary)]">
                              {aiTestResult.model}
                            </span>
                          ) : null}
                          {typeof aiTestResult.latencyMs === "number" ? (
                            <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                              {aiTestResult.latencyMs} ms
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[var(--text-secondary)]">{aiTestResult.message}</p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Right sidebar summary: detected CLI binaries */}
              <aside className="space-y-4 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 self-start">
                <div>
                  <h4 className="text-[13px] font-semibold text-[var(--text-primary)]">
                    Local CLI binary detection
                  </h4>
                  <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                    Checked against your local PATH by the server.
                  </p>
                </div>

                <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                  {AI_PRESETS.filter((p) => p.binary).map((preset) => {
                    const probe = preset.binary
                      ? cliAvailability[preset.value] ?? cliAvailability[preset.binary]
                      : undefined;

                    return (
                      <div
                        key={preset.value}
                        className="flex items-center justify-between gap-2 py-2.5 text-[13px]"
                      >
                        <div className="min-w-0">
                          <div className="font-data font-medium text-[var(--text-primary)]">
                            {preset.binary}
                          </div>
                          {probe?.version ? (
                            <div className="truncate font-data text-[11px] text-[var(--text-tertiary)]">
                              {probe.version}
                            </div>
                          ) : null}
                        </div>
                        {probe ? (
                          <Badge tone={probe.available ? "accent" : "neutral"}>
                            {probe.available ? "Detected" : "Not found"}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Not probed</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </aside>
            </div>
          )}
        </TabsContent>

        {/* 2) Resume Defaults & Backups */}
        <TabsContent value="defaults" className="max-w-3xl space-y-6">
          <section className="space-y-3">
            <div>
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Resume page geometry
              </h3>
              <p className="text-[13px] text-[var(--text-secondary)]">
                Explicitly choose the default paper size for previews and DOCX/PDF exports. Never inferred from browser locale.
              </p>
            </div>

            <div className="max-w-xs space-y-1.5">
              <label
                htmlFor="default-paper-size"
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                Default paper size
              </label>
              <Select
                value={form.defaultPaperSize}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    defaultPaperSize: value === "Letter" ? "Letter" : "A4",
                  }))
                }
              >
                <SelectTrigger id="default-paper-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">A4 (210 × 297 mm)</SelectItem>
                  <SelectItem value="Letter">US Letter (8.5 × 11 in)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className="space-y-4 border-t border-[var(--border)] pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label
                  htmlFor="scheduled-backups"
                  className="text-[14px] font-medium text-[var(--text-primary)]"
                >
                  Scheduled local backups
                </label>
                <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                  Periodically archive SQLite snapshots, originals, and exports into your local backups directory.
                </p>
              </div>
              <Switch
                id="scheduled-backups"
                checked={form.scheduledBackupsEnabled}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, scheduledBackupsEnabled: checked }))
                }
              />
            </div>

            <div className="max-w-xs space-y-1.5">
              <label
                htmlFor="backup-retention"
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                Retention count
              </label>
              <Input
                id="backup-retention"
                type="number"
                min={1}
                max={100}
                className="font-data"
                value={form.backupRetentionCount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    backupRetentionCount: Number.parseInt(e.target.value, 10) || 1,
                  }))
                }
              />
              <p className="text-[12px] text-[var(--text-tertiary)]">
                Number of recent `.tar.gz` backup archives to keep on disk.
              </p>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-5">
            <Button
              variant="primary"
              loading={savingSettings}
              onClick={() => void handleSaveSettings("defaults")}
            >
              Save defaults
            </Button>
            {!confirmingBackup ? (
              <Button
                variant="secondary"
                onClick={() => setConfirmingBackup(true)}
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                Create backup now
              </Button>
            ) : (
              <div className="flex items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
                <span className="text-[13px] text-[var(--text-primary)]">
                  Create `.tar.gz` snapshot?
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  loading={runningBackup}
                  onClick={() => void handleCreateBackup()}
                >
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={runningBackup}
                  onClick={() => setConfirmingBackup(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>

          <BackupRestorePanel
            refreshTrigger={backupRefreshTrigger}
            showCreateButton={false}
            onWorkspaceMutated={handleWorkspaceMutated}
          />
        </TabsContent>

        {/* 3) Diagnostics & Recent Tasks */}
        <TabsContent value="diagnostics" className="space-y-8">
          {/* Live transport diagnostic note */}
          {broadcastUnavailable ? (
            <div
              role="status"
              className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px] text-[var(--text-secondary)]"
            >
              BroadcastChannel is unavailable in this browser context. Using per-tab SSE fallback ({connectionState}).
            </div>
          ) : null}

          {/* Redacted Diagnostics Report */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                  System diagnostics
                </h3>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Redacted runtime report from <span className="font-data">GET /api/diagnostics</span>. Secrets, document contents, and raw paths are excluded.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadDiagnostics()}
                  loading={diagnosticsLoading}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Refresh
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!diagnostics}
                  onClick={() => void handleCopyDiagnostics()}
                >
                  <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy JSON
                </Button>
              </div>
            </div>

            {diagnosticsLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : diagnosticsError ? (
              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] text-[var(--text-secondary)]">
                {diagnosticsError}
              </div>
            ) : diagnostics ? (
              <div className="overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface)]">
                <dl className="divide-y divide-[var(--border)]">
                  {Object.entries(diagnostics).map(([key, val]) => (
                    <div
                      key={key}
                      className="grid gap-2 px-4 py-2.5 text-[13px] sm:grid-cols-[220px_minmax(0,1fr)]"
                    >
                      <dt className="font-data text-[12px] font-medium text-[var(--text-secondary)]">
                        {key}
                      </dt>
                      <dd className="break-words font-data text-[12px] text-[var(--text-primary)]">
                        {formatDiagnosticValue(val)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </section>

          {/* Active & Recent Background Tasks */}
          <section className="space-y-3 border-t border-[var(--border)] pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                  Recent background tasks
                </h3>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Persistent queue state updated via live SSE invalidation events.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadTasks()}
                loading={tasksLoading}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Reload tasks
              </Button>
            </div>

            {tasksLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : tasksError ? (
              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] text-[var(--text-secondary)]">
                {tasksError}
              </div>
            ) : tasks.length === 0 ? (
              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-[13px] text-[var(--text-secondary)]">
                No background tasks recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface)]">
                {tasks.map((task) => {
                  const canCancel =
                    (task.status === "queued" || task.status === "running") &&
                    !task.cancelRequestedAt;
                  const hasPercent = typeof task.progressPercent === "number";

                  return (
                    <div
                      key={task.id}
                      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-data text-[13px] font-semibold text-[var(--text-primary)]">
                            {task.taskType}
                          </span>
                          <Badge tone={taskStatusTone(task.status)}>
                            {task.cancelRequestedAt &&
                            (task.status === "queued" || task.status === "running")
                              ? "Cancelling"
                              : task.status}
                          </Badge>
                          <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                            {task.id.slice(0, 8)}
                          </span>
                          {task.progressStage ? (
                            <span className="text-[12px] text-[var(--text-secondary)]">
                              {task.progressStage}
                            </span>
                          ) : null}
                        </div>

                        {task.status === "running" ? (
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 w-44 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                              {hasPercent ? (
                                <div
                                  className="h-full bg-[var(--accent)] transition-[width] duration-150"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, task.progressPercent ?? 0))}%`,
                                  }}
                                />
                              ) : (
                                <div className="workbench-indeterminate h-full w-1/3 bg-[var(--accent)]" />
                              )}
                            </div>
                            {hasPercent ? (
                              <span className="font-data text-[11px] text-[var(--text-secondary)]">
                                {task.progressPercent}%
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {task.status === "failed" &&
                        (task.errorCode || task.errorMessage) ? (
                          <p className="text-[12px] text-[var(--danger)]">
                            {[task.errorCode, task.errorMessage]
                              .filter(Boolean)
                              .join(": ")}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        {task.updatedAt ? (
                          <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                            {new Date(task.updatedAt).toLocaleTimeString()}
                          </span>
                        ) : null}
                        {canCancel ? (
                          <Button
                            variant="outline"
                            size="sm"
                            loading={cancellingTaskId === task.id}
                            onClick={() => void handleCancelTask(task.id)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </TabsContent>
        {/* 4) Job Sources */}
        <TabsContent value="sources">
          <SourcesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
