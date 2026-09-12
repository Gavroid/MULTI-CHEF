// /today/roulette — кулинарная рулетка (MC-042, PRD §2.3.5).
//
// Server wrapper: the interactive state machine lives in RouletteClient
// (setup form → closed card → flip → Беру!/Другое).

import { RouletteClient } from './RouletteClient';

export default function RoulettePage(): React.ReactElement {
  return <RouletteClient />;
}
