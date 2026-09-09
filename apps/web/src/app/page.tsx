// Landing page (MC-013 update). Public marketing surface — the two CTAs
// lead to /auth/login and /auth/register. The /design and old showcase
// cards move below as a "Что готово" sub-section for transparency.

import Link from 'next/link';
import { Badge, Button, Card, Chip } from '@multichef/ui';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function HomePage(): React.ReactElement {
  return (
    <main className="mx-auto max-w-content min-h-screen px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-display text-text">MULTI-CHEF</h1>
        <ThemeToggle />
      </header>

      <section className="mb-6">
        <h2 className="text-title mb-2">Семейный планировщик питания</h2>
        <p className="text-body mb-4">
          Рецепты из того, что уже есть дома. Недельный план, список покупок и КБЖУ — без ручного
          счёта.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          <Link href="/auth/login">
            <Button variant="primary">Войти</Button>
          </Link>
          <Link href="/auth/register">
            <Button variant="secondary">Создать аккаунт</Button>
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="fresh">Phase 0 done</Badge>
          <Badge tone="info">MC-013 app-shell</Badge>
          <Badge tone="warning">Frontend</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-3 mb-6">
        <Card>
          <h3 className="text-heading mb-2">Что готово</h3>
          <ul className="flex flex-col gap-2">
            <li className="flex items-center gap-2">
              <Chip selected>5 табов</Chip>
              <span className="text-caption text-text-muted">
                Сегодня · Холодильник · План · Покупки · Профиль
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Chip selected>Safe-area</Chip>
              <span className="text-caption text-text-muted">
                env(safe-area-inset-bottom) для iPhone
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Chip>Mobile-first</Chip>
              <span className="text-caption text-text-muted">max-width 480px контент</span>
            </li>
          </ul>
        </Card>

        <Card variant="elevated">
          <h3 className="text-heading mb-2">Дизайн-система</h3>
          <p className="text-body mb-3">
            Токены цветов, типографики и отступов из PRD §2.5. Light и dark темы, переключатель в
            правом верхнем углу.
          </p>
          <Link href="/design">
            <Button variant="ghost">Открыть /design</Button>
          </Link>
        </Card>
      </section>

      <footer className="text-small text-text-muted text-center py-4">
        Значения КБЖУ ориентировочные: зависят от бренда, фактического веса и способа приготовления.
      </footer>
    </main>
  );
}
