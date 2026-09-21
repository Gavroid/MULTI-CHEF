// /fridge/leftovers — PRD §2.3.9 «Преображение остатков» (R17-WP2).
//
// Server Component shell; orchestrates via LeftoversClient. Metadata
// here so the page gets a meaningful <title> (noindex via the (app)
// layout — see PLAN-R17-POST-AUDIT §WP-7).

import type { Metadata } from 'next';
import { LeftoversClient } from './LeftoversClient';

export const metadata: Metadata = {
  title: 'Преображение остатков',
};

export default function FridgeLeftoversPage(): React.JSX.Element {
  return <LeftoversClient />;
}
