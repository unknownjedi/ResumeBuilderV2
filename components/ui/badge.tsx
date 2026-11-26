import * as React from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "warning" | "danger";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral:
    "bg-[var(--surface-muted)] text-[var(--text-secondary)] border-[var(--border)]",
  accent:
    "bg-[var(--accent-soft)] text-[var(--accent)] border-[#C4D6CA]",
  warning:
    "bg-[#F5EFE2] text-[var(--warning)] border-[#DFC99B]",
  danger:
    "bg-[#F8EAE8] text-[var(--danger)] border-[#E4B8B4]",
};

/**
 * Semantic status pill. Neutral by default; color reserved for meaningful states.
 */
export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[12px] font-medium leading-4 whitespace-nowrap",
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    />
  );
}
