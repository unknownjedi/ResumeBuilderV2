import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const SETUP_STEPS = [
  {
    step: "01",
    title: "Build your verified career profile",
    description:
      "Import a baseline resume or add work experience, projects, achievements, and skills. Only verified facts are used in tailored outputs.",
    href: "/profile",
    actionLabel: "Open career profile",
  },
  {
    step: "02",
    title: "Create a search profile",
    description:
      "Define target job titles, hard filters, weighted skills, and location preferences for a specific search strategy.",
    href: "/search-profiles",
    actionLabel: "Configure search profile",
  },
  {
    step: "03",
    title: "Verify local AI CLI & diagnostics",
    description:
      "Select a local AI CLI preset (or keep No-AI deterministic mode), set default paper size, and check runtime health.",
    href: "/settings",
    actionLabel: "Open settings",
  },
  {
    step: "04",
    title: "Discover and inspect postings",
    description:
      "Import job URLs or scan configured sources to review documented-fit evidence and start tailored resumes.",
    href: "/discover",
    actionLabel: "Go to discover jobs",
  },
];

export default function OverviewPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            First-run workbench
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Action-oriented overview of your local job search. Complete the setup checklist below to populate recommendations and attention items.
          </p>
        </div>
        <div className="flex items-center gap-2 font-data text-[12px] text-[var(--text-tertiary)]">
          <span>Last scan: Not run</span>
          <span aria-hidden="true">·</span>
          <span>Next scheduled: Manual</span>
        </div>
      </div>

      {/* Guided first-run checklist */}
      <section aria-labelledby="setup-checklist-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3
            id="setup-checklist-heading"
            className="text-[14px] font-semibold text-[var(--text-primary)]"
          >
            Setup checklist
          </h3>
          <Badge tone="neutral">4 steps</Badge>
        </div>

        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
          {SETUP_STEPS.map((item) => (
            <div
              key={item.step}
              className="flex flex-col justify-between gap-3 px-4 py-3.5 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Circle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--control-border)]"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-data text-[12px] text-[var(--text-tertiary)]">
                      {item.step}
                    </span>
                    <span className="text-[14px] font-medium text-[var(--text-primary)]">
                      {item.title}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                    {item.description}
                  </p>
                </div>
              </div>

              <Link
                href={item.href}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] sm:self-center"
              >
                <span>{item.actionLabel}</span>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Action-oriented sections ready for Slice 2+ */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="recommended-jobs-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3
              id="recommended-jobs-heading"
              className="text-[14px] font-semibold text-[var(--text-primary)]"
            >
              Recommended open jobs
            </h3>
            <span className="font-data text-[12px] text-[var(--text-tertiary)]">
              Up to 10 ranked
            </span>
          </div>

          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center">
            <p className="text-[14px] font-medium text-[var(--text-primary)]">
              No ranked recommendations yet
            </p>
            <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
              Once you add a search profile and import or fetch job postings, top documented-fit openings will appear here with match reasons and freshness status.
            </p>
          </div>
        </section>

        <section aria-labelledby="needs-attention-heading" className="space-y-3">
          <h3
            id="needs-attention-heading"
            className="text-[14px] font-semibold text-[var(--text-primary)]"
          >
            Needs attention
          </h3>

          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-start gap-2.5 text-[13px] text-[var(--text-secondary)]">
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium text-[var(--text-primary)]">
                  Nothing awaiting action
                </p>
                <p className="mt-0.5">
                  Drafts needing fact verification, ready applications, and source errors requiring action will surface here.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
