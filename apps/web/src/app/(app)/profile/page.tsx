// /profile — профиль пользователя (PRD §2.3.6). MC-013: показывает CTA
// «Войти», потому что аутентификация появится только в MC-014.
// Полный профиль (аллергии, household, питание) — MC-040+.

import Link from 'next/link';
import { Button, Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';

export default function ProfilePage(): React.ReactElement {
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
