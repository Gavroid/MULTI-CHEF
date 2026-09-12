// /plan/setup — weekly-plan wizard (MC-055, PRD §2.3.11).
//
// Server wrapper over SetupClient (3 compact steps: household, shape,
// goals → POST /meal-plans → job progress polling → /plan).

import React, { Suspense } from 'react';
import { SetupClient } from './SetupClient';

export default function PlanSetupPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <SetupClient />
    </Suspense>
  );
}
