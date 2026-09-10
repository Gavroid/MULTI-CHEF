// /recipe/[id] — recipe detail page (MC-035, PRD §2.3.15).
//
// Thin async server entrypoint: awaits the route params + ?servings=N,
// parses servings (1..12, otherwise fall back to the recipe default),
// renders <RecipeClient /> — which owns data fetching + URL sync.
// Auth is enforced by the (app) route group's AuthGuard — no per-page
// guard here.

import React from 'react';
import { RecipeClient } from './RecipeClient';

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ servings?: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const { servings: servingsRaw } = await searchParams;

  const parsed = servingsRaw ? Number.parseInt(servingsRaw, 10) : NaN;
  const initialServings =
    Number.isFinite(parsed) && parsed >= 1 && parsed <= 12 ? parsed : undefined;

  return (
    <RecipeClient recipeId={id} {...(initialServings !== undefined ? { initialServings } : {})} />
  );
}
