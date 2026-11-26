import { Badge } from "@/components/ui/badge";

const PROFILE_SECTIONS = [
  "Contact & professional headline",
  "Summary / career objective",
  "Work experience",
  "Projects",
  "Achievements & measurable impact",
  "Skills & proficiency",
  "Education & certifications",
  "Source documents & evidence",
];

export default function CareerProfilePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text-primary)]">
            Career profile
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--text-secondary)]">
            Single source of candidate facts. Every imported or extracted item begins as Needs review until you explicitly mark it Verified.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="warning">Needs review</Badge>
          <Badge tone="accent">Verified</Badge>
        </div>
      </div>

      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
        {PROFILE_SECTIONS.map((section) => (
          <div
            key={section}
            className="flex items-center justify-between gap-4 px-4 py-3.5"
          >
            <span className="text-[14px] font-medium text-[var(--text-primary)]">
              {section}
            </span>
            <span className="font-data text-[12px] text-[var(--text-tertiary)]">
              0 entries
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
