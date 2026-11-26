"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  FileCode2,
  FileDown,
  FileText,
  Link2,
  Plus,
  Sparkles,
  Terminal,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { formatShortDate } from "@/features/job-discovery/types";
import { ResumeApiError } from "@/features/resume-builder/api";
import type { ExportFormat } from "@/features/resume-builder/types";
import {
  exportApplicationAnswers,
  exportCoverLetter,
  generateApplicationAnswers,
  generateCoverLetter,
  updateApplicationAnswer,
  updateCoverLetter,
} from "./api";
import {
  COVER_LETTER_LENGTHS,
  COVER_LETTER_TONES,
  isSensitiveApplicationPrompt,
  plainTextToCoverLetterContent,
  STANDARD_APPLICATION_PROMPTS,
  type ApplicationAnswerRecord,
  type CoverLetterLength,
  type CoverLetterRecord,
  type CoverLetterTone,
} from "./types";

export interface CoverLetterAnswersPanelProps {
  jobId: string;
  searchProfileId: string;
  applicationId: string;
  coverLetter: CoverLetterRecord | null;
  answers: ApplicationAnswerRecord[];
  onCoverLetterUpdated: (coverLetter: CoverLetterRecord) => void;
  onAnswersUpdated: (answers: ApplicationAnswerRecord[]) => void;
}

function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function CoverLetterAnswersPanel({
  jobId,
  searchProfileId,
  applicationId,
  coverLetter,
  answers,
  onCoverLetterUpdated,
  onAnswersUpdated,
}: CoverLetterAnswersPanelProps) {
  const { toast } = useToast();

  // Cover letter local state
  const [tone, setTone] = React.useState<CoverLetterTone>("balanced");
  const [length, setLength] = React.useState<CoverLetterLength>("medium");
  const [letterEdit, setLetterEdit] = React.useState<{
    id: string;
    baseText: string;
    draftText: string;
  } | null>(null);
  const [generatingLetter, setGeneratingLetter] = React.useState(false);
  const [savingLetter, setSavingLetter] = React.useState(false);
  const [exportingLetterFormat, setExportingLetterFormat] =
    React.useState<ExportFormat | null>(null);
  const [pdfMissingNotice, setPdfMissingNotice] = React.useState<{
    coverLetterId: string;
    message: string;
  } | null>(null);

  // Answers local state
  const [selectedPromptKeys, setSelectedPromptKeys] = React.useState<string[]>([
    "why_interested",
    "why_good_fit",
  ]);
  const [customPrompt, setCustomPrompt] = React.useState("");
  const [generatingAnswers, setGeneratingAnswers] = React.useState(false);
  const [answerEdits, setAnswerEdits] = React.useState<
    Record<string, { baseText: string; draftText: string }>
  >({});
  const [savingAnswerIds, setSavingAnswerIds] = React.useState<
    Record<string, boolean>
  >({});
  const [exportingAnswersFormat, setExportingAnswersFormat] = React.useState<
    "txt" | "md" | null
  >(null);

  const letterDraftText =
    coverLetter &&
    letterEdit?.id === coverLetter.id &&
    letterEdit.baseText === coverLetter.text
      ? letterEdit.draftText
      : (coverLetter?.text ?? "");
  const letterDirty = Boolean(
    coverLetter && letterDraftText !== coverLetter.text
  );
  const pdfMissingMessage =
    coverLetter && pdfMissingNotice?.coverLetterId === coverLetter.id
      ? pdfMissingNotice.message
      : null;

  const handleGenerateCoverLetter = async () => {
    setGeneratingLetter(true);
    setPdfMissingNotice(null);
    try {
      const created = await generateCoverLetter(jobId, {
        searchProfileId,
        applicationId,
        tone,
        length,
      });
      onCoverLetterUpdated(created);
      setLetterEdit(null);
      toast({
        title: coverLetter ? "Cover letter regenerated" : "Cover letter generated",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not generate cover letter",
        description: err instanceof Error ? err.message : "Generation failed.",
        tone: "danger",
      });
    } finally {
      setGeneratingLetter(false);
    }
  };

  const handleSaveCoverLetter = async () => {
    if (!coverLetter) return;
    setSavingLetter(true);
    try {
      const updated = await updateCoverLetter(coverLetter.id, {
        text: letterDraftText,
        structuredContent: plainTextToCoverLetterContent(
          letterDraftText,
          coverLetter.structuredContent
        ),
        userEditedState: "user_edited",
      });
      onCoverLetterUpdated(updated);
      setLetterEdit(null);
      toast({
        title: "Cover letter saved",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not save cover letter",
        description: err instanceof Error ? err.message : "Save failed.",
        tone: "danger",
      });
    } finally {
      setSavingLetter(false);
    }
  };

  const handleExportCoverLetter = async (format: ExportFormat) => {
    if (!coverLetter) return;
    setExportingLetterFormat(format);
    setPdfMissingNotice(null);
    try {
      if (letterDirty) {
        const saved = await updateCoverLetter(coverLetter.id, {
          text: letterDraftText,
          structuredContent: plainTextToCoverLetterContent(
            letterDraftText,
            coverLetter.structuredContent
          ),
          userEditedState: "user_edited",
        });
        onCoverLetterUpdated(saved);
        setLetterEdit(null);
      }

      const res = await exportCoverLetter(coverLetter.id, format);
      if (res.downloadUrl) {
        triggerDownload(res.downloadUrl);
      }
      toast({
        title: `Cover letter exported (${format.toUpperCase()})`,
        tone: "accent",
      });
    } catch (err) {
      if (
        err instanceof ResumeApiError &&
        err.code === "PDF_BROWSER_MISSING"
      ) {
        setPdfMissingNotice({
          coverLetterId: coverLetter.id,
          message: err.message,
        });
        toast({
          title: "PDF browser runtime missing",
          description: "Run `npm run setup:pdf-browser` to enable PDF export.",
          tone: "warning",
        });
      } else {
        toast({
          title: `Could not export cover letter`,
          description: err instanceof Error ? err.message : "Export failed.",
          tone: "danger",
        });
      }
    } finally {
      setExportingLetterFormat(null);
    }
  };

  const handleTogglePromptKey = (key: string) => {
    setSelectedPromptKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleGenerateAnswers = async () => {
    const trimmedCustom = customPrompt.trim();
    if (selectedPromptKeys.length === 0 && !trimmedCustom) {
      toast({
        title: "Select at least one prompt",
        description: "Choose a standard question or enter a custom prompt.",
        tone: "warning",
      });
      return;
    }

    if (
      trimmedCustom &&
      isSensitiveApplicationPrompt("custom", trimmedCustom)
    ) {
      toast({
        title: "Sensitive question flagged for manual input",
        description:
          "Work authorization, visa, legal, and demographic questions are never auto-filled.",
        tone: "warning",
      });
    }

    setGeneratingAnswers(true);
    try {
      const generated = await generateApplicationAnswers(jobId, {
        searchProfileId,
        applicationId,
        promptKeys: selectedPromptKeys,
        customPrompt: trimmedCustom || undefined,
      });

      const mergedById = new Map<string, ApplicationAnswerRecord>();
      for (const existing of answers) mergedById.set(existing.id, existing);
      for (const next of generated) mergedById.set(next.id, next);
      onAnswersUpdated(Array.from(mergedById.values()));
      setCustomPrompt("");
      toast({
        title: `Prepared ${generated.length} application ${generated.length === 1 ? "answer" : "answers"}`,
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not prepare application answers",
        description: err instanceof Error ? err.message : "Generation failed.",
        tone: "danger",
      });
    } finally {
      setGeneratingAnswers(false);
    }
  };

  const getAnswerDraftText = (ans: ApplicationAnswerRecord): string => {
    const entry = answerEdits[ans.id];
    if (entry && entry.baseText === ans.answerText) {
      return entry.draftText;
    }
    return ans.answerText;
  };

  const handleSaveAnswer = async (ans: ApplicationAnswerRecord) => {
    const nextText = getAnswerDraftText(ans);
    setSavingAnswerIds((prev) => ({ ...prev, [ans.id]: true }));
    try {
      const updated = await updateApplicationAnswer(ans.id, {
        answerText: nextText,
        userEditedState: "user_edited",
      });
      onAnswersUpdated(
        answers.map((item) => (item.id === ans.id ? updated : item))
      );
      setAnswerEdits((prev) => {
        const copy = { ...prev };
        delete copy[ans.id];
        return copy;
      });
      toast({
        title: "Application answer saved",
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not save answer",
        description: err instanceof Error ? err.message : "Save failed.",
        tone: "danger",
      });
    } finally {
      setSavingAnswerIds((prev) => {
        const copy = { ...prev };
        delete copy[ans.id];
        return copy;
      });
    }
  };

  const handleExportAnswers = async (format: "txt" | "md") => {
    const answerIds = answers
      .filter((a) => getAnswerDraftText(a).trim().length > 0)
      .map((a) => a.id);
    if (answerIds.length === 0) {
      toast({
        title: "No non-empty answers to export",
        tone: "warning",
      });
      return;
    }
    setExportingAnswersFormat(format);
    try {
      const res = await exportApplicationAnswers({ answerIds, format });
      if (res.downloadUrl) {
        triggerDownload(res.downloadUrl);
      }
      toast({
        title: `Exported answers (${format.toUpperCase()})`,
        tone: "accent",
      });
    } catch (err) {
      toast({
        title: "Could not export answers",
        description: err instanceof Error ? err.message : "Export failed.",
        tone: "danger",
      });
    } finally {
      setExportingAnswersFormat(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cover Letter Section */}
      <section className="space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
              Tailored cover letter
            </h4>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              Grounded only in your verified career profile and disclosed job
              details — never fabricated company research.
            </p>
          </div>
          {coverLetter ? (
            <div className="flex items-center gap-1.5">
              <Badge tone="neutral" className="font-data text-[11px]">
                {coverLetter.userEditedState}
              </Badge>
              {coverLetter.evidenceRefs.length > 0 ? (
                <Badge tone="accent" className="font-data text-[11px]">
                  <Link2 className="h-3 w-3" aria-hidden="true" />
                  {coverLetter.evidenceRefs.length} facts
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Generation controls */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={tone}
            onValueChange={(v) => setTone(v as CoverLetterTone)}
          >
            <SelectTrigger className="h-8 w-[124px] text-[12px]">
              <SelectValue placeholder="Tone" />
            </SelectTrigger>
            <SelectContent>
              {COVER_LETTER_TONES.map((t) => (
                <SelectItem key={t} value={t}>
                  Tone: {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={length}
            onValueChange={(v) => setLength(v as CoverLetterLength)}
          >
            <SelectTrigger className="h-8 w-[132px] text-[12px]">
              <SelectValue placeholder="Length" />
            </SelectTrigger>
            <SelectContent>
              {COVER_LETTER_LENGTHS.map((l) => (
                <SelectItem key={l} value={l}>
                  Length: {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="secondary"
            size="sm"
            loading={generatingLetter}
            onClick={() => void handleGenerateCoverLetter()}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {coverLetter ? "Regenerate draft" : "Generate cover letter"}
          </Button>
        </div>

        {coverLetter ? (
          <div className="space-y-3">
            <Textarea
              value={letterDraftText}
              onChange={(e) => {
                setLetterEdit({
                  id: coverLetter.id,
                  baseText: coverLetter.text,
                  draftText: e.target.value,
                });
              }}
              rows={10}
              aria-label="Cover letter text"
              className="min-h-[210px] font-sans text-[13px] leading-relaxed"
            />

            {pdfMissingMessage ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-[6px] border border-[#DFC99B] bg-[#F5EFE2] p-2.5 text-[12px]"
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <div className="font-medium text-[var(--text-primary)]">
                    PDF browser runtime missing
                  </div>
                  <div className="text-[var(--text-secondary)]">
                    {pdfMissingMessage} Run{" "}
                    <code className="inline-flex items-center gap-1 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 font-data">
                      <Terminal className="h-3 w-3" aria-hidden="true" />
                      npm run setup:pdf-browser
                    </code>{" "}
                    to export PDFs.
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={savingLetter}
                  disabled={!letterDirty}
                  onClick={() => void handleSaveCoverLetter()}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {letterDirty ? "Save cover letter" : "Saved"}
                </Button>
                <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                  Updated {formatShortDate(coverLetter.updatedAt)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  loading={exportingLetterFormat === "docx"}
                  disabled={exportingLetterFormat !== null}
                  onClick={() => void handleExportCoverLetter("docx")}
                >
                  <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                  .docx
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={exportingLetterFormat === "pdf"}
                  disabled={exportingLetterFormat !== null}
                  onClick={() => void handleExportCoverLetter("pdf")}
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  .pdf
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={exportingLetterFormat === "md"}
                  disabled={exportingLetterFormat !== null}
                  onClick={() => void handleExportCoverLetter("md")}
                >
                  <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
                  .md
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={exportingLetterFormat === "txt"}
                  disabled={exportingLetterFormat !== null}
                  onClick={() => void handleExportCoverLetter("txt")}
                >
                  .txt
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-[6px] border border-dashed border-[var(--border)] bg-[var(--surface-raised)] p-3 text-[12px] text-[var(--text-secondary)]">
            No cover letter draft yet. Generate an editable draft above when
            needed.
          </p>
        )}
      </section>

      {/* Application Answers Section */}
      <section className="space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">
              Application form answers
            </h4>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              Evidence-backed drafts for common application questions. Work
              authorization, visa, legal, and demographic questions are always
              flagged for manual input and never auto-filled.
            </p>
          </div>
          {answers.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                loading={exportingAnswersFormat === "txt"}
                disabled={exportingAnswersFormat !== null}
                onClick={() => void handleExportAnswers("txt")}
              >
                Export .txt
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={exportingAnswersFormat === "md"}
                disabled={exportingAnswersFormat !== null}
                onClick={() => void handleExportAnswers("md")}
              >
                Export .md
              </Button>
            </div>
          ) : null}
        </div>

        {/* Prompt Picker + Custom Prompt */}
        <div className="space-y-2.5 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-3">
          <div className="flex flex-wrap gap-2">
            {STANDARD_APPLICATION_PROMPTS.map((prompt) => {
              const selected = selectedPromptKeys.includes(prompt.key);
              return (
                <label
                  key={prompt.key}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => handleTogglePromptKey(prompt.key)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span>{prompt.label}</span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Add custom employer question (e.g., Describe a technical trade-off you made)..."
              className="h-8 flex-1 text-[12px]"
            />
            <Button
              variant="secondary"
              size="sm"
              loading={generatingAnswers}
              onClick={() => void handleGenerateAnswers()}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Prepare answers
            </Button>
          </div>
        </div>

        {/* Answer Cards */}
        {answers.length === 0 ? (
          <p className="rounded-[6px] border border-dashed border-[var(--border)] bg-[var(--surface-raised)] p-3 text-[12px] text-[var(--text-secondary)]">
            No application answers drafted yet. Select prompts above and click
            Prepare answers.
          </p>
        ) : (
          <div className="space-y-3">
            {answers.map((ans) => {
              const currentText = getAnswerDraftText(ans);
              const isDirty = currentText !== ans.answerText;
              const isSaving = Boolean(savingAnswerIds[ans.id]);
              return (
                <div
                  key={ans.id}
                  className="space-y-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="text-[13px] font-medium text-[var(--text-primary)]">
                      {ans.promptText}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {ans.requiresManualInput ? (
                        <Badge tone="warning">
                          <AlertTriangle
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                          Requires manual input
                        </Badge>
                      ) : (
                        <Badge tone="neutral" className="font-data text-[11px]">
                          {ans.evidenceRefs.length} facts
                        </Badge>
                      )}
                    </div>
                  </div>

                  {ans.requiresManualInput ? (
                    <p className="text-[12px] text-[var(--warning)]">
                      Sensitive compliance/authorization question — left blank
                      by policy so you can enter your exact manual response if
                      needed for reference.
                    </p>
                  ) : null}

                  <Textarea
                    value={currentText}
                    onChange={(e) =>
                      setAnswerEdits((prev) => ({
                        ...prev,
                        [ans.id]: {
                          baseText: ans.answerText,
                          draftText: e.target.value,
                        },
                      }))
                    }
                    placeholder={
                      ans.requiresManualInput
                        ? "Enter your manual response here (never auto-filled)..."
                        : "Edit application answer..."
                    }
                    rows={3}
                    className="min-h-[76px] text-[13px]"
                  />

                  <div className="flex items-center justify-between gap-2">
                    <span className="font-data text-[11px] text-[var(--text-tertiary)]">
                      {ans.userEditedState} · {formatShortDate(ans.updatedAt)}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={isSaving}
                      disabled={!isDirty}
                      onClick={() => void handleSaveAnswer(ans)}
                    >
                      {isDirty ? "Save answer" : "Saved"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
