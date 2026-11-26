"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--on-accent)] border border-[var(--accent)] hover:bg-[#365545] active:bg-[#2F4B3C]",
  secondary:
    "bg-[var(--surface-raised)] text-[var(--text-primary)] border border-[var(--control-border)] hover:bg-[var(--surface-muted)]",
  outline:
    "bg-transparent text-[var(--text-primary)] border border-[var(--control-border)] hover:bg-[var(--surface-muted)]",
  ghost:
    "bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]",
  danger:
    "bg-[var(--danger)] text-[var(--on-danger)] border border-[var(--danger)] hover:bg-[#8E322A] active:bg-[#7A2B24]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-[14px] gap-2",
  lg: "h-10 px-4 text-[14px] gap-2",
  icon: "h-8 w-8 p-0 justify-center",
};

/**
 * Quiet-workbench button primitive with explicit disabled tokens and 2px evergreen focus ring.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "secondary",
      size = "md",
      loading = false,
      disabled,
      type = "button",
      children,
      ...props
    },
    ref
  ) {
    const isDisabled = Boolean(disabled || loading);

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex items-center justify-center rounded-[4px] font-medium whitespace-nowrap select-none transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
          "disabled:pointer-events-none disabled:bg-[var(--disabled-surface)] disabled:text-[var(--disabled-text)] disabled:border-[var(--border)]",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : null}
        {children}
      </button>
    );
  }
);
