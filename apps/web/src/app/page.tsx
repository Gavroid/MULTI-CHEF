// Landing page (MC-012). Demonstrates the design system end-to-end:
// theme toggle, Button/Card/Badge/Chip primitives, mobile-first layout.
//
// Marketing/auth/feature screens will replace this in MC-030+. Right now
// it exists to prove the design tokens + UI package are wired correctly
// and that the landing renders with the brand palette + typography.

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
        <p className="text-caption text-text-muted mb-3">
          Семейный планировщик питания · Phase 1 / MC-012
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge tone="fresh">Phase 0 done</Badge>
          <Badge tone="info">MC-012</Badge>
          <Badge tone="warning">Frontend</Badge>
        </div>
      </section>

      <section className="flex flex-col gap-3 mb-6">
        <Card variant="elevated">
          <h2 className="text-title mb-2">Дизайн-система</h2>
          <p className="text-body mb-3">
            Токены цветов, типографики и отступов из PRD §2.5 — теперь в одном месте. Light и dark
            темы, переключатель в правом верхнем углу.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Link href="/design">
              <Button variant="primary">Посмотреть компоненты</Button>
            </Link>
            <Button variant="secondary" type="button">
              Документация
            </Button>
          </div>
        </Card>

        <Card>
          <h3 className="text-heading mb-2">Что готово</h3>
          <ul className="flex flex-col gap-2">
            <li className="flex items-center gap-2">
              <Chip selected>Tailwind v3</Chip>
              <span className="text-caption text-text-muted">
                токены мапятся в утилитарные классы
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Chip selected>CSS-переменные</Chip>
              <span className="text-caption text-text-muted">light/dark через data-theme</span>
            </li>
            <li className="flex items-center gap-2">
              <Chip>Mobile-first</Chip>
              <span className="text-caption text-text-muted">max-width 480px контент</span>
            </li>
          </ul>
        </Card>
      </section>

      <footer className="text-small text-text-muted text-center py-4">
        Значения КБЖУ ориентировочные: зависят от бренда, фактического веса и способа приготовления.
      </footer>
    </main>
  );
}
