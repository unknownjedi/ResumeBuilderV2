"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

export interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Content-region route transition keyed on active pathname.
 * Uses GPU-composited opacity + 5px vertical offset over 180ms with cubic-bezier(0.22, 1, 0.36, 1).
 * Never blocks navigation or animates the persistent application shell.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      key={pathname}
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0.08 : 0.18,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
