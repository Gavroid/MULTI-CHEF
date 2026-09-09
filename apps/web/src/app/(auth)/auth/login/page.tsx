// /auth/login — заглушка. Полная форма (email + password, magic link,
// OAuth) появится в MC-014.

import Link from 'next/link';
import { Button, Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';

export default function LoginPage(): React.ReactElement {
  return (
    <>
      <TabTitle sublabel="Вход в аккаунт">Логин</TabTitle>
      <Card>
        <h2 className="text-heading mb-2">С возвращением</h2>
        <p className="text-body mb-3">
          Форма с email + паролем и magic-link появится в MC-014. Сейчас кнопка ниже — заглушка для
          проверки роутинга.
        </p>
        <Button variant="primary" disabled>
          Войти через email (TODO: MC-014)
        </Button>
      </Card>
      <p className="text-caption text-text-muted text-center mt-4">
        Нет аккаунта?{' '}
        <Link href="/auth/register" className="text-[var(--color-primary)] hover:underline">
          Зарегистрироваться
        </Link>
      </p>
    </>
  );
}
