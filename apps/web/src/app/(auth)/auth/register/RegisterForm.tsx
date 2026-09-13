'use client';

// RegisterForm — pure form extracted from RegisterPage for unit testing
// without Next's runtime. Mirrors the contract of LoginForm.

import React, { useRef, useState, type ReactElement } from 'react';
import { Button, Input } from '@multichef/ui';
import { FormErrorBanner } from '@/components/FormErrorBanner';
import type { ApiResponse, AuthSuccess } from '@/lib/auth-client';

export interface RegisterFormDeps {
  submit: (
    body: {
      email: string;
      password: string;
      householdName?: string;
      guestProfile?: { budgetWeekKopecks?: number };
    },
    options: { signal?: AbortSignal },
  ) => Promise<ApiResponse<AuthSuccess>>;
  navigate: (href: string) => void;
}

export interface RegisterFormProps {
  deps: RegisterFormDeps;
  /** Called with the success ApiResponse so the page wrapper can persist. */
  onSuccess?: (resp: ApiResponse<AuthSuccess>) => void;
}

interface FieldErrors {
  email?: string;
  password?: string;
  householdName?: string;
}

export function RegisterForm({ deps, onSuccess }: RegisterFormProps): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [budgetRoubles, setBudgetRoubles] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Client-side validation mirroring RegisterBody zod.
    const local: FieldErrors = {};
    if (!email.trim()) local.email = 'Введите email';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      local.email = 'Похоже на невалидный email';
    if (password.length < 8) local.password = 'Минимум 8 символов';
    if (!/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) {
      local.password = 'Пароль должен содержать букву и цифру';
    }
    if (Object.keys(local).length > 0) {
      setFieldErrors(local);
      return;
    }

    const payload: {
      email: string;
      password: string;
      householdName?: string;
      guestProfile?: { budgetWeekKopecks?: number };
    } = {
      email: email.trim(),
      password,
    };
    const trimmedName = householdName.trim();
    if (trimmedName) payload.householdName = trimmedName;
    // Audit round-5: onboarding budget reaches Household.budgetWeekKopecks
    // (previously silently dropped — /today budget bar had no source).
    const budgetInput = Number.parseInt(budgetRoubles, 10);
    if (Number.isFinite(budgetInput) && budgetInput > 0) {
      payload.guestProfile = { budgetWeekKopecks: budgetInput * 100 };
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setSubmitting(true);
    try {
      const result = await deps.submit(payload, { signal: ac.signal });
      if (ac.signal.aborted) return;
      if (result.error) {
        const fields = result.error.error.details as
          { fields?: Record<string, string[]> } | undefined;
        if (fields?.fields) {
          const next: FieldErrors = {};
          for (const [k, msgs] of Object.entries(fields.fields)) {
            const msg = Array.isArray(msgs) && msgs.length > 0 ? msgs[0] : undefined;
            if (!msg) continue;
            if (k === 'email') next.email = msg;
            else if (k === 'password') next.password = msg;
            else if (k === 'householdName') next.householdName = msg;
          }
          if (Object.keys(next).length > 0) {
            setFieldErrors(next);
            return;
          }
        }
        setError(humaniseError(result.error));
        return;
      }
      if (result.data) {
        onSuccess?.(result);
        deps.navigate('/today');
      }
    } finally {
      setSubmitting(false);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={submitting}
      data-testid="mc-register-form"
      className="flex flex-col gap-3"
    >
      <FormErrorBanner message={error} />
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.ru"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={submitting}
        required
        {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
      />
      <Input
        label="Пароль"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={submitting}
        required
        helper="Минимум 8 символов, буква + цифра"
        {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
      />
      <Input
        label="Бюджет на неделю, ₽"
        type="number"
        min={0}
        placeholder="Необязательно — для прогресс-бара на «Сегодня»"
        value={budgetRoubles}
        onChange={(e) => setBudgetRoubles(e.target.value)}
      />
      <Input
        label="Название семьи"
        type="text"
        autoComplete="off"
        placeholder="Моя семья"
        value={householdName}
        onChange={(e) => setHouseholdName(e.target.value)}
        disabled={submitting}
        helper="Необязательно — используем «Моя семья» по умолчанию"
        {...(fieldErrors.householdName ? { error: fieldErrors.householdName } : {})}
      />
      <Button type="submit" variant="primary" loading={submitting}>
        {submitting ? 'Создаём…' : 'Создать аккаунт'}
      </Button>
    </form>
  );
}

export function humaniseRegisterError(env: {
  status: number;
  error: { code: string; message: string };
}): string {
  if (env.status === 0) return 'Нет соединения — проверьте интернет и попробуйте снова.';
  if (env.error.code === 'CONFLICT')
    return 'Этот email уже зарегистрирован. Войдите или используйте другой.';
  if (env.error.code === 'RATE_LIMITED') return 'Слишком много попыток. Подождите минуту.';
  return env.error.message || 'Что-то пошло не так. Попробуйте ещё раз.';
}

function humaniseError(env: { status: number; error: { code: string; message: string } }): string {
  return humaniseRegisterError(env);
}
