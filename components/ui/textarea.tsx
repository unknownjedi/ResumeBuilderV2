"use client";

import * as React from "react";
import { cn } from "./cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/**
 * Quiet-workbench multiline text area.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid = false, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex min-h-[84px] w-full rounded-[6px] border bg-[var(--surface-raised)] px-3 py-2 text-[14px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]",
          "transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
          "disabled:cursor-not-allowed disabled:bg-[var(--disabled-surface)] disabled:text-[var(--disabled-text)] disabled:border-[var(--border)]",
          invalid
            ? "border-[var(--danger)]"
            : "border-[var(--control-border)] hover:border-[var(--text-secondary)]",
          className
        )}
        {...props}
      />
    );
  }
);
