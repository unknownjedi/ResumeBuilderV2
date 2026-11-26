"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

export interface MotionProviderProps {
  children: ReactNode;
  nonce?: string;
}

/**
 * Shared MotionConfig boundary enforcing user reduced-motion preferences
 * across all client motion components without importing Motion in Server Components.
 */
export function MotionProvider({ children, nonce }: MotionProviderProps) {
  return (
    <MotionConfig reducedMotion="user" nonce={nonce}>
      {children}
    </MotionConfig>
  );
}
