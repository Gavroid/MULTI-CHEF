// /today/result — recommendation result (MC-034, PRD §2.3.4).
//
// Server wrapper over ResultClient (which reads the recommendation
// from sessionStorage via ?ref= and renders the 3 option cards).
// Suspense is required because ResultClient reads ?ref= via
// useSearchParams() — without a boundary the static prerender bails.

import React, { Suspense } from "react";
import { ResultClient } from "./ResultClient";

export default function TodayResultPage(): React.JSX.Element {
  return (
    <Suspense fallback={null}>
      <ResultClient />
    </Suspense>
  );
}
