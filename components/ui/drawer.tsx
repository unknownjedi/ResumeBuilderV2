"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "./cn";

const DrawerCloseContext = React.createContext<(() => void) | null>(null);

export function Drawer({
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) {
  const close = React.useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  return (
    <DrawerCloseContext.Provider value={close}>
      <DialogPrimitive.Root onOpenChange={onOpenChange} {...props} />
    </DrawerCloseContext.Provider>
  );
}

export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: "right" | "left";
  showCloseButton?: boolean;
}

/**
 * Accessible slide-over drawer built on Radix Dialog for focus trapping,
 * Escape-to-close, and automatic focus restoration to the invoking control.
 */
export const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(function DrawerContent(
  { className, children, side = "right", showCloseButton = true, onKeyDown, ...props },
  ref
) {
  const closeDrawer = React.useContext(DrawerCloseContext);

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#22231F]/28 transition-opacity duration-150" />
      <DialogPrimitive.Content
        ref={ref}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "Escape" && !e.defaultPrevented && closeDrawer) {
            e.preventDefault();
            closeDrawer();
          }
        }}
        className={cn(
          "fixed top-0 bottom-0 z-50 flex flex-col bg-[var(--surface-raised)] text-[var(--text-primary)]",
          "shadow-[0_6px_24px_rgba(34,35,31,0.10)] focus:outline-none",
          side === "right"
            ? "right-0 w-full max-w-[480px] border-l border-[var(--border)]"
            : "left-0 w-[280px] max-w-[85vw] border-r border-[var(--border)]",
          className
        )}
        {...props}
      >
        {showCloseButton ? (
          <DialogPrimitive.Close
            aria-label="Close panel"
            className="absolute right-3.5 top-3.5 z-10 inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 border-b border-[var(--border)] px-5 py-4 pr-12",
        className
      )}
      {...props}
    />
  );
}

export function DrawerBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />
  );
}

export const DrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn(
        "text-[16px] font-semibold leading-6 text-[var(--text-primary)]",
        className
      )}
      {...props}
    />
  );
});

export const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DrawerDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("mt-0.5 text-[13px] text-[var(--text-secondary)]", className)}
      {...props}
    />
  );
});
