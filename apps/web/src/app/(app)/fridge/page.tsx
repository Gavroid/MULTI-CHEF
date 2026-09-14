// /fridge — список продуктов пользователя (PRD §2.3.3).
//
// MC-023: full CRUD (list + create + edit + soft-delete + restore).
// The orchestrator lives in FridgeClient.tsx so the unit tests can
// import it directly with stub `deps`. This file is the Next.js
// page entrypoint and intentionally has no logic of its own.

import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Холодильник' };

import { FridgeClient } from './FridgeClient';

export default function FridgePage(): React.JSX.Element {
  return <FridgeClient />;
}
