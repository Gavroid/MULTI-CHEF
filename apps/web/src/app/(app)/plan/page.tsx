// /plan — «План» tab (MC-013 stub replaced in MC-055).
//
// Thin server page: the interactive plan view lives in PlanClient
// (client-side data via plan-client with deps injection).

import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'План' };

import { PlanClient } from './PlanClient';

export default function PlanPage(): React.ReactElement {
  return <PlanClient />;
}
