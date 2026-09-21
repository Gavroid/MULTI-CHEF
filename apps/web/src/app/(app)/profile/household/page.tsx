// /profile/household — R17-WP3 (PRD §2.3.16). Server Component shell.

import type { Metadata } from 'next';
import { HouseholdClient } from './HouseholdClient';

export const metadata: Metadata = {
  title: 'Домохозяйство',
};

// R17-WP3: these pages always need a live session, so skip prerender.
export const dynamic = 'force-dynamic';

export default function ProfileHouseholdPage(): React.JSX.Element {
  return <HouseholdClient />;
}
