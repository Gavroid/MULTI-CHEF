'use client';

// /profile — профиль пользователя (PRD §2.3.6).
//
// Audit fix: this page previously ALWAYS rendered the MC-013 "Войдите"
// stub, even for authenticated users. Now it checks the real session
// (GET /auth/session) and renders either the profile view (email,
// household, theme toggle, logout) or the login CTA.
//
// R17-WP3: split PRD §2.3.16 list-of-sections into real navigable
// links: /profile/nutrition, /profile/preferences, /profile/household.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Card, Skeleton } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { logout } from '@/lib/auth-client';
import { resetPantryCache } from '@/hooks/usePantry';
import { resetPreferencesCache } from '@/hooks/usePreferences';
import { broadcastCacheInvalidation } from '@/lib/cache-sync';

interface SectionLinkProps {
  href: string;
  label: string;
  hint: string;
  testId: string;
}

function SectionLink({ href, label, hint, testId }: SectionLinkProps): React.ReactElement {
  return (
    <Link
      href={href}
      className="flex items-center justify-between py-3 border-b border-[var(--color-border)] last:border-0"
      data-testid={testId}
    >
      <span className="flex flex-col">
        <span className="text-body-strong">{label}</span>
        <span className="text-caption text-[var(--color-text-muted)]">{hint}</span>
      </span>
      <span aria-hidden="true" className="text-[var(--color-text-muted)]">
        →
      </span>
    </Link>
  );
}

export default function ProfilePage(): React.ReactElement {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [peopleCount, setPeopleCount] = useState(0);
  const [budgetWeekKopecks, setBudgetWeekKopecks] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  // T46-C/T46-D (E23): User.locale drives API error language; tz is shown
  // (and consumed by date formatting) so the user can see their zone.
  const [locale, setLocale] = useState('ru');
  const [tz, setTz] = useState('Europe/Moscow');
  const [switching, setSwitching] = useState(false);
  const t = useTranslations('profile');

  const switchLocale = async (next: 'ru' | 'en'): Promise<void> => {
    setSwitching(true);
    try {
      const csrf = document.cookie
        .split('; ')
        .find((c) => c.startsWith('mc_csrf='))
        ?.split('=')[1];
      const res = await fetch('/api/v1/auth/locale', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key':
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `profile-${Date.now()}`,
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({ locale: next }),
      });
      if (res.ok) setLocale(next);
    } finally {
      setSwitching(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [sessionRes, householdRes] = await Promise.all([
          fetch('/api/v1/auth/session', { credentials: 'include' }),
          fetch('/api/v1/household', { credentials: 'include' }),
        ]);
        if (cancelled) return;
        if (sessionRes.ok) {
          const s = await sessionRes.json();
          setAuthed(true);
          setEmail(s.email ?? s.user?.email ?? '');
          setLocale(s.user?.locale ?? 'ru');
          setTz(s.user?.tz ?? 'Europe/Moscow');
        }
        if (householdRes.ok) {
          const h = await householdRes.json();
          if (h.name) {
            setHouseholdName(h.name);
            setPeopleCount(h.defaultPeopleCount ?? 2);
            setBudgetWeekKopecks(h.budgetWeekKopecks ?? null);
          }
        }
      } catch {
        // network error — show logged-out state
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <>
        <TabTitle sublabel={t('subtitle')}>{t('title')}</TabTitle>
        <Card>
          <Skeleton className="h-4 w-2/3 mb-2" />
          <Skeleton className="h-4 w-1/2" />
        </Card>
      </>
    );
  }

  if (!authed) {
    return (
      <>
        <TabTitle sublabel={t('subtitle')}>{t('title')}</TabTitle>
        <Card>
          <h2 className="text-heading mb-2">{t('loginCtaTitle')}</h2>
          <p className="text-body mb-3">{t('loginCtaText')}</p>
          <Link href="/auth/login">
            <Button variant="primary">{t('login')}</Button>
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <TabTitle sublabel={t('subtitle')}>{t('title')}</TabTitle>

      <Card className="mb-3" data-testid="profile-user">
        <h2 className="text-heading mb-1">{email}</h2>
        {householdName ? (
          <p className="text-body text-[var(--color-text-muted)]">
            {householdName}
            {peopleCount > 0 ? ` · ${t('peopleShort', { count: peopleCount })}` : ''}
            {budgetWeekKopecks
              ? ` · ${t('budgetPerWeek', { amount: Math.round(budgetWeekKopecks / 100) })}`
              : ''}
          </p>
        ) : null}
      </Card>

      {/* R17-WP3: PRD §2.3.16 list-of-sections. */}
      <Card className="mb-3" data-testid="profile-sections">
        <SectionLink
          href="/profile/nutrition"
          label="Цели и КБЖУ"
          hint="Калории, Б/Ж/У, приёмы пищи, техника, уровень"
          testId="profile-section-nutrition"
        />
        <SectionLink
          href="/profile/preferences"
          label="Предпочтения и аллергии"
          hint="Любимые, нелюбимые, исключения"
          testId="profile-section-preferences"
        />
        <SectionLink
          href="/profile/household"
          label="Домохозяйство"
          hint="Название, число людей, бюджет"
          testId="profile-section-household"
        />
      </Card>

      <Card className="mb-3" data-testid="profile-theme">
        <p className="text-body mb-2">{t('theme')}</p>
        <ThemeToggle />
      </Card>

      {/* T46-C/T46-D (E23): locale switcher (drives API error language)
          and the user's timezone from User.tz. */}
      <Card className="mb-3" data-testid="profile-locale">
        <p className="text-body mb-2">{t('language')}</p>
        <div className="flex gap-2">
          <Button
            variant={locale === 'ru' ? 'primary' : 'secondary'}
            disabled={switching || locale === 'ru'}
            onClick={() => void switchLocale('ru')}
            data-testid="profile-locale-ru"
          >
            {t('localeRu')}
          </Button>
          <Button
            variant={locale === 'en' ? 'primary' : 'secondary'}
            disabled={switching || locale === 'en'}
            onClick={() => void switchLocale('en')}
            data-testid="profile-locale-en"
          >
            {t('localeEn')}
          </Button>
        </div>
        <p className="text-caption text-[var(--color-text-muted)] mt-2" data-testid="profile-tz">
          {t('timezone')}: {tz}
        </p>
        <p
          className="text-caption text-[var(--color-text-muted)] mt-1"
          data-testid="profile-locale-hint"
        >
          Интерфейс остаётся на русском; язык влияет на сообщения об ошибках API.
        </p>
      </Card>

      <Card className="mb-6" data-testid="profile-logout">
        <Button
          variant="secondary"
          className="w-full"
          disabled={loggingOut}
          onClick={() => {
            setLoggingOut(true);
            // Audit: clear marker BEFORE the API call so the client
            // AuthGuard does not flash the authed view during logout.
            window.localStorage.removeItem('mc_user');
            // T19-C (audit round 19): drop the module-scope data caches
            // so the next logged-in user on this tab cannot see the
            // previous user's pantry/preferences for up to 30s.
            resetPantryCache();
            resetPreferencesCache();
            // T29-A: соседние вкладки тоже сбрасывают кэши.
            broadcastCacheInvalidation('logout');
            void logout().then(() => {
              window.location.assign('/auth/login');
            });
          }}
          data-testid="profile-logout-btn"
        >
          {loggingOut ? t('loggingOut') : t('logout')}
        </Button>
      </Card>
    </>
  );
}
