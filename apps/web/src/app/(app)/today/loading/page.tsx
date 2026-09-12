// /today/loading — recommendation loading screen (MC-034).
//
// Server wrapper over LoadingClient (which owns the POST + optical
// stages + sessionStorage hand-off to /today/result). Suspense is
// required because LoadingClient reads ?budget/&time/&anti via
// useSearchParams() — without a boundary the static prerender bails.

import React, { Suspense } from 'react';
import { LoadingClient } from './LoadingClient';

export default function TodayLoadingPage(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <LoadingClient />
    </Suspense>
  );
}
