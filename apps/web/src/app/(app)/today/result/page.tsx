// /today/result — recommendation result (MC-034, PRD §2.3.4).
//
// Thin wrapper over ResultClient (which reads the recommendation from
// sessionStorage via ?ref= and renders the 3 option cards).

'use client';

import React from 'react';
import { ResultClient } from './ResultClient';

export default function TodayResultPage(): React.ReactElement {
  return <ResultClient />;
}
