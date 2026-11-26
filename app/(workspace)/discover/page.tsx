import Link from "next/link";
import { Link2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function DiscoverPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Discover jobs
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Search, filter, sort, and inspect normalized job postings without silent date or salary assumptions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">Missing dates &amp; salaries stay explicit</Badge>
        </div>
      </div>

      {/* Filter & search bar frame */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
          <Search className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
          <span>Title, company, location, and skill search will populate as sources are connected.</span>
        </div>
        <Link
          href="/settings"
          className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[var(--control-border)] bg-[var(--surface-raised)] px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <Link2 className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
          <span>Configure sources in Settings</span>
        </Link>
      </div>

      <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">
          No job postings imported yet
        </p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-[var(--text-secondary)]">
          Job rows, requirement evidence accordions, and the 1280px+ right-side detail drawer will render here once postings are imported or fetched.
        </p>
      </div>
    </div>
  );
}
