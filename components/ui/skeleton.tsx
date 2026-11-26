import * as React from "react";
import { cn } from "./cn";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Match static placeholder geometry without shimmer when false. */
  animate?: boolean;
}

/**
 * Low-contrast loading placeholder that disables shimmer under prefers-reduced-motion.
 */
export function Skeleton({ className, animate = true, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-[4px]",
        animate ? "workbench-skeleton" : "bg-[var(--surface-muted)]",
        className
      )}
      {...props}
    />
  );
}
