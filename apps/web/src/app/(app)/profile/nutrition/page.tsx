// /profile/nutrition — R17-WP3 (PRD §2.3.16). Server Component
// shell — orchestrates via NutritionClient.

import type { Metadata } from 'next';
import { NutritionClient } from './NutritionClient';

export const metadata: Metadata = {
  title: 'Цели и КБЖУ',
};

// R17-WP3: these pages always need a live session, so skip prerender.
export const dynamic = 'force-dynamic';

export default function ProfileNutritionPage(): React.JSX.Element {
  return <NutritionClient />;
}
