'use client';

// LoginForm — pure form component extracted from LoginPage so it can be
// unit-tested without booting Next's runtime. All Next-specific hooks
// (`useRouter`, `useSearchParams`) live in the page wrapper; this form
// only consumes a `deps` object.
//
// Contract:
//   - `deps.submit` is the typed fetch wrapper (login/register).
//   - `deps.navigate(href)` is called on success (we use router.push).
//   - `onSuccess(resp)` is called with the success ApiResponse so the
//     caller can persist user state. Failures do NOT call onSuccess.

import React, { useRef, useState, type ReactElement } from 'react';
import { Button, Input } from '@multichef/ui';
import { FormErrorBanner } from '@/components/FormErrorBanner';
import type { ApiResponse, AuthSuccess } from '@/lib/auth-client';

export interface LoginFormDeps {
  submit: (
    body: { email: string; password: string },
    options: { signal?: AbortSignal },
  ) => Promise<ApiResponse<AuthSuccess>>;
  navigate: (href: string) => void;
}

export interface LoginFormProps {
  deps: LoginFormDeps;
  redirectTo: string | null;
  /** Called with the success ApiResponse so the page wrapper can persist. */
  onSuccess?: (resp: ApiResponse<AuthSuccess>) => void;
}

export function LoginForm({ deps, redirectTo, onSuccess }: LoginFormProps): ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    // Client-side guard — mirrors the API's Zod LoginBody (email + pw).
    if (!email.trim()) {
      setError('Введите email');
      return;
    }
    if (!password) {
      setError('Введите пароль');
      return;
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setSubmitting(true);
    try {
      const result = await deps.submit({ email: email.trim(), password }, { signal: ac.signal });
      if (ac.signal.aborted) return;
      if (result.error) {
        setError(humaniseError(result.error));
        return;
      }
      if (result.data) {
        onSuccess?.(result);
        deps.navigate(redirectTo ?? '/today');
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
      data-testid="mc-login-form"
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
      />
      <Input
        label="Пароль"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={submitting}
        required
      />
      <Button type="submit" variant="primary" loading={submitting}>
        {submitting ? 'Входим…' : 'Войти'}
      </Button>
    </form>
  );
}

export function humaniseLoginError(env: {
  status: number;
  error: { code: string; message: string };
}): string {
  if (env.status === 0) return 'Нет соединения — проверьте интернет и попробуйте снова.';
  if (env.error.code === 'UNAUTHORIZED') return 'Неверный email или пароль.';
  if (env.error.code === 'RATE_LIMITED') return 'Слишком много попыток. Подождите минуту.';
  return env.error.message || 'Что-то пошло не так. Попробуйте ещё раз.';
}

function humaniseError(env: { status: number; error: { code: string; message: string } }): string {
  return humaniseLoginError(env);
}
