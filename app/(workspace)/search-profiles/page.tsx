import { Badge } from "@/components/ui/badge";

export default function SearchProfilesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Search profiles
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Role-specific search strategies targeting titles, locations, hard filters, and ranking weights without duplicating your career profile.
          </p>
        </div>
        <Badge tone="neutral">Weighted by default</Badge>
      </div>

      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">
          No search profiles created
        </p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
          Create focused strategies such as Backend Engineer or AI Systems Engineer with independent target skills and explicit hard-filter controls.
        </p>
      </div>
    </div>
  );
}
