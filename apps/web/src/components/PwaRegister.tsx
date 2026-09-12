'use client';

// MC-070 — registers the service worker after hydration (prod only).

import { useEffect } from 'react';

export function PwaRegister(): null {
  useEffect(() => {
    if (process.env['NODE_ENV'] === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline support is best-effort */
      });
    }
  }, []);
  return null;
}
