// /auth/register — заглушка. Полная форма (email + password + confirm,
// onboarding wizard) появится в MC-014.

import Link from 'next/link';
import { Button, Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';

export default function RegisterPage(): React.ReactElement {
  return (
    <>
      <TabTitle sublabel="Создание аккаунта">Регистрация</TabTitle>
      <Card>
        <h2 className="text-heading mb-2">Создайте аккаунт</h2>
        <p className="text-body mb-3">
          Форма регистрации + 7-шаговый wizard онбординга (аллергии, household, бюджет) появятся в
          MC-014.
        </p>
        <Button variant="primary" disabled>
          Создать аккаунт (TODO: MC-014)
        </Button>
      </Card>
      <p className="text-caption text-text-muted text-center mt-4">
        Уже есть аккаунт?{' '}
        <Link href="/auth/login" className="text-[var(--color-primary)] hover:underline">
          Войти
        </Link>
      </p>
    </>
  );
}
