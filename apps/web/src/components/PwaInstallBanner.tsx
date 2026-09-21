'use client';

import { useEffect, useState } from 'react';

/**
 * PwaInstallBanner — surfaces the OS install prompt for the PWA.
 *
 * Trigger: the browser fires `beforeinstallprompt` once the SW +
 * manifest are valid AND the user has had ≥1 session visit. The
 * prompt is intercepted here so the user gets a one-tap install
 * button instead of relying on the browser's own UI (Chrome hides
 * the install icon for unauthenticated users).
 *
 * Dismiss state is persisted in localStorage so the banner stays
 * quiet for a week after dismissal.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'pwa-install-dismissed-at';
const DISMISS_DAYS = 7;

function isDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

export function PwaInstallBanner() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Already installed (display-mode: standalone).
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }

    if (isDismissed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function onInstall() {
    if (!evt) return;
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setShow(false);
  }

  function onDismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  if (installed || !show) return null;

  return (
    <div
      data-testid="pwa-install-banner"
      className="fixed bottom-20 left-3 right-3 z-50 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-lg"
    >
      <div className="flex-1 text-sm">
        <div className="font-medium">Установить Мультишеф</div>
        <div className="text-muted-foreground">
          Быстрый доступ с рабочего стола — без адресной строки.
        </div>
      </div>
      <button
        type="button"
        onClick={onInstall}
        className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
      >
        Установить
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Скрыть предложение"
        className="rounded-xl px-2 py-2 text-sm text-muted-foreground hover:bg-muted"
      >
        ✕
      </button>
    </div>
  );
}
