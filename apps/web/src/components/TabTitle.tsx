// TabTitle — consistent h1 for the 5 tab pages. Lives in the (app) layout's
// page header zone (sticky on scroll in future MCs). Uses the design
// token `text-display` so font + line-height match PRD §2.5.2.

import type { ReactElement, ReactNode } from 'react';

export function TabTitle({
  children,
  sublabel,
}: {
  children: ReactNode;
  sublabel?: ReactNode;
}): ReactElement {
  return (
    <header className="mb-4">
      <h1 className="text-display text-text">{children}</h1>
      {sublabel ? <p className="text-caption text-text-muted mt-1">{sublabel}</p> : null}
    </header>
  );
}
