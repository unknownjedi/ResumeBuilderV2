"use client";

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { motion } from "motion/react";
import { cn } from "./cn";

const TabsIndicatorContext = React.createContext<{
  indicatorId?: string;
  activeValue?: string;
}>({});

export interface TabsProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> {
  /** Optional Motion layoutId for restrained active-tab underline animation. */
  indicatorId?: string;
}

export function Tabs({
  indicatorId,
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const activeValue = value !== undefined ? value : internalValue;

  const handleValueChange = React.useCallback(
    (next: string) => {
      if (value === undefined) {
        setInternalValue(next);
      }
      onValueChange?.(next);
    },
    [onValueChange, value]
  );

  return (
    <TabsIndicatorContext.Provider value={{ indicatorId, activeValue }}>
      <TabsPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={handleValueChange}
        className={cn("flex flex-col", className)}
        {...props}
      />
    </TabsIndicatorContext.Provider>
  );
}

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 border-b border-[var(--border)]",
        className
      )}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, children, value, ...props }, ref) {
  const { indicatorId, activeValue } = React.useContext(TabsIndicatorContext);
  const isSelected = activeValue === value;

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        "relative inline-flex h-9 items-center justify-center px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150",
        "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
        "data-[state=active]:text-[var(--text-primary)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        "disabled:pointer-events-none disabled:text-[var(--disabled-text)]",
        className
      )}
      {...props}
    >
      {children}
      {isSelected ? (
        indicatorId ? (
          <motion.span
            layoutId={indicatorId}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-1 bottom-0 left-1 h-[2px] bg-[var(--accent)]"
          />
        ) : (
          <span className="absolute right-1 bottom-0 left-1 h-[2px] bg-[var(--accent)]" />
        )
      ) : null}
    </TabsPrimitive.Trigger>
  );
});

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        "pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        className
      )}
      {...props}
    />
  );
});
