import { Badge } from "@/components/ui/badge";

const PIPELINE_STATES = [
  "Preparing",
  "Ready to apply",
  "Applied",
  "Response received",
  "Rejected",
  "Withdrawn",
  "Archived",
];

export default function ApplicationsPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--border)] pb-4">
        <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
          Applications
        </h2>
        <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
          Manual application tracking with preserved resume versions and submission timestamps. Saved jobs remain separate until you start an application.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PIPELINE_STATES.map((stage) => (
          <Badge key={stage} tone="neutral">
            {stage}
          </Badge>
        ))}
      </div>

      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">
          No active applications
        </p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
          Choose Prepare application on any inspected job posting to start tracking materials and status transitions here.
        </p>
      </div>
    </div>
  );
}
