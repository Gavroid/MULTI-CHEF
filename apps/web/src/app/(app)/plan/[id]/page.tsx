// /plan/[id] — PRD §2.3.10 detail plan view (R17-WP4).
// Server Component shell — reads `params.id` and delegates to client.

import type { Metadata } from 'next';
import { PlanDetailClient } from './PlanDetailClient';

export const metadata: Metadata = {
  title: 'План',
};

// R17-WP4: detail plan view always needs a live session; skip prerender.
export const dynamic = 'force-dynamic';

interface PlanDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PlanDetailPage({
  params,
}: PlanDetailPageProps): Promise<React.JSX.Element> {
  const { id } = await params;
  return <PlanDetailClient planId={id} />;
}
