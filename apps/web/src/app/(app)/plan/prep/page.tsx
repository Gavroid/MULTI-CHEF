// /plan/prep — «Заготовка» (MC-062, PRD §2.3.12).
//
// Server wrapper over PrepClient (task timeline with checkboxes; the
// progress persists server-side via PATCH prep-tasks).

import React from 'react';
import { PrepClient } from './PrepClient';

export default function PrepPage(): React.ReactElement {
  return <PrepClient />;
}
