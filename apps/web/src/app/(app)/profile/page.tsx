'use client';

// /profile — профиль пользователя (PRD §2.3.6).
//
// Audit fix: this page previously ALWAYS rendered the MC-013 "Войдите"
// stub, even for authenticated users. Now it checks the real session
// (GET /auth/session) and renders either the profile view (email,
// household, theme toggle, logout) or the login CTA.

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Skeleton } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { logout } from '@/lib/auth-client';

export default function ProfilePage(): React.ReactElement {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [peopleCount, setPeopleCount] = useState(0);
  const [budgetWeekKopecks, setBudgetWeekKopecks] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

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
        <TabTitle sublabel="Аккаунт и настройки">Профиль</TabTitle>
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
        <TabTitle sublabel="Аккаунт и настройки">Профиль</TabTitle>
        <Card>
          <h2 className="text-heading mb-2">Войдите, чтобы увидеть профиль</h2>
          <p className="text-body mb-3">
            Здесь будут аллергии, члены семьи, бюджет и настройки дисклеймера КБЖУ. Войдите или
            создайте аккаунт.
          </p>
          <Link href="/auth/login">
            <Button variant="primary">Войти</Button>
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <TabTitle sublabel="Аккаунт и настройки">Профиль</TabTitle>

      <Card className="mb-3" data-testid="profile-user">
        <h2 className="text-heading mb-1">{email}</h2>
        {householdName ? (
          <p className="text-body text-[var(--color-text-muted)]">
            {householdName}
            {peopleCount > 0 ? ` · ${peopleCount} чел.` : ''}
            {budgetWeekKopecks ? ` · бюджет ${Math.round(budgetWeekKopecks / 100)} ₽/нед` : ''}
          </p>
        ) : null}
      </Card>

      <Card className="mb-3" data-testid="profile-theme">
        <p className="text-body mb-2">Тема оформления</p>
        <ThemeToggle />
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
            void logout().then(() => {
              window.location.assign('/auth/login');
            });
          }}
          data-testid="profile-logout-btn"
        >
          Выйти
        </Button>
      </Card>
    </>
  );
}
