"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "./cn";

export type ToastTone = "neutral" | "accent" | "warning" | "danger";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: string;
  open: boolean;
}

interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const TONE_BORDER: Record<ToastTone, string> = {
  neutral: "border-[var(--border)]",
  accent: "border-l-[3px] border-l-[var(--accent)] border-[var(--border)]",
  warning: "border-l-[3px] border-l-[var(--warning)] border-[var(--border)]",
  danger: "border-l-[3px] border-l-[var(--danger)] border-[var(--border)]",
};

/**
 * Accessible toast notification provider backed by Radix Toast.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, open: false } : item))
    );
  }, []);

  const toast = React.useCallback((input: ToastInput) => {
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setItems((prev) => [...prev.slice(-4), { ...input, id, open: true }]);
    return id;
  }, []);

  const handleOpenChange = React.useCallback((id: string, open: boolean) => {
    if (!open) {
      setItems((prev) => prev.filter((item) => item.id !== id));
    }
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            open={item.open}
            duration={item.duration}
            onOpenChange={(open) => handleOpenChange(item.id, open)}
            className={cn(
              "flex items-start justify-between gap-3 rounded-[8px] border bg-[var(--surface-raised)] p-3.5 text-[var(--text-primary)]",
              "shadow-[0_6px_20px_rgba(34,35,31,0.10)]",
              TONE_BORDER[item.tone ?? "neutral"]
            )}
          >
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-[13px] font-semibold leading-5 text-[var(--text-primary)]">
                {item.title}
              </ToastPrimitive.Title>
              {item.description ? (
                <ToastPrimitive.Description className="mt-0.5 text-[12px] leading-4 text-[var(--text-secondary)]">
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
              {item.actionLabel && item.onAction ? (
                <div className="mt-2">
                  <ToastPrimitive.Action
                    altText={item.actionLabel}
                    onClick={item.onAction}
                    className="inline-flex h-7 items-center rounded-[4px] border border-[var(--control-border)] bg-[var(--surface)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    {item.actionLabel}
                  </ToastPrimitive.Action>
                </div>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="Dismiss notification"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

/** Trigger accessible toast notifications from client components. */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
