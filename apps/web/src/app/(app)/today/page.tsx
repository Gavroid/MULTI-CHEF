// /today — главный экран (PRD §2.3.2, MC-034).
//
// The idle view lives in TodayClient (data via usePantry/usePreferences
// hooks with deps injection); wizard/loading/result are separate
// sub-routes per the URL-driven state machine in the ADR.

import { TodayClient } from "./TodayClient";

export default function TodayPage(): React.JSX.Element {
  return <TodayClient />;
}
