// /today/generate — wizard entry (MC-034, PRD §2.3.3).
//
// Thin client page: reads ?prefill= from the URL and forwards the raw
// string to WizardClient, which parses/expands it. Prefill validation
// lives in the client — unknown tokens are silently ignored.

'use client';

import React, { use } from 'react';
import { WizardClient } from './WizardClient';

export default function TodayGeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ prefill?: string }>;
}): React.ReactElement {
  const { prefill } = use(searchParams);
  return <WizardClient prefill={prefill ?? null} />;
}
