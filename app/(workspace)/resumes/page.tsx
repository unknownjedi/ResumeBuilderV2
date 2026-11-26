import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export default function ResumesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Resumes
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Structured, ATS-safe one-column resume drafts and immutable DOCX/PDF exports linked to verified career evidence.
          </p>
        </div>
        <Badge tone="neutral">A4 &amp; US Letter</Badge>
      </div>

      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">
          No tailored resume drafts yet
        </p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
          Select a job posting to generate an editable tailored draft, confirm evidence links, and export immutable PDF or DOCX versions.
        </p>
        <div className="mt-4">
          <Link
            href="/settings"
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Set default paper size
          </Link>
        </div>
      </div>
    </div>
  );
}
