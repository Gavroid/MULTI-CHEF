'use client';

// /auth/register — MC-014 real screen. Replaces the MC-013 stub.
//
// Wire-up mirrors /auth/login but adds a householdName field (PRD §2.3.1
// step 1 of onboarding). After successful register we redirect to /today;
// the remaining 6 onboarding steps land in MC-040.

import React, { type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';
import { register } from '@/lib/auth-client';
import { saveLocalUser } from '@/lib/auth-storage';
import { RegisterForm, type RegisterFormDeps } from './RegisterForm';

export default function RegisterPage(): ReactElement {
  const router = useRouter();

  const deps: RegisterFormDeps = {
    submit: register,
    navigate: (href) => router.push(href),
  };

  return (
    <>
      <TabTitle sublabel="Создание аккаунта">Регистрация</TabTitle>
      <Card>
        <RegisterForm
          deps={deps}
          onSuccess={(resp) => {
            if (resp.data) saveLocalUser(resp.data.user, resp.data.household);
          }}
        />
      </Card>
      <p className="text-caption text-text-muted text-center mt-4">
        Уже есть аккаунт?{' '}
        <a href="/auth/login" className="underline text-[var(--color-primary)] hover:no-underline">
          Войти
        </a>
      </p>
    </>
  );
}
