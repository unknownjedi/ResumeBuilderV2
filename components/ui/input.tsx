"use client";

import * as React from "react";
import { cn } from "./cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/**
 * Quiet-workbench text input using --control-border for accessible non-text contrast.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", invalid = false, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex h-9 w-full rounded-[6px] border bg-[var(--surface-raised)] px-3 py-1.5 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]",
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
});
