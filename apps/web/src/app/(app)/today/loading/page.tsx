// /today/loading — recommendation loading screen (MC-034).
//
// Thin wrapper over LoadingClient (which owns the POST + optical
// stages + sessionStorage hand-off to /today/result).

'use client';

import React from 'react';
import { LoadingClient } from './LoadingClient';

export default function TodayLoadingPage(): React.ReactElement {
  return <LoadingClient />;
}
