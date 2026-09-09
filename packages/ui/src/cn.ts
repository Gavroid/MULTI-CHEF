// `cn` — Tailwind-aware classnames helper.
//
// Standard recipe: `clsx` for conditional class objects + `tailwind-merge`
// to dedupe conflicting Tailwind utilities (e.g. `p-2 p-4` → `p-4`).
// Pure, no React, so it can be consumed anywhere in the monorepo.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
