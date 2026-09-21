// /profile/preferences — R17-WP3 (PRD §2.3.16). Server Component shell.

import type { Metadata } from 'next';
import { PreferencesClient } from './PreferencesClient';

export const metadata: Metadata = {
  title: 'Предпочтения и аллергии',
};

// R17-WP3: these pages always need a live session, so skip prerender.
export const dynamic = 'force-dynamic';

export default function ProfilePreferencesPage(): React.JSX.Element {
  return <PreferencesClient />;
}
