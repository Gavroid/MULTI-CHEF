// Design-system demo route. Renders every UI primitive in every state so
// designers/devs can eyeball the result without spinning up Storybook
// (see MC-012 trade-off in DEVELOPMENT-PLAN §1.2).
//
// Lives at /_design — the underscore prefix marks it as internal/dev-only.
// Real product routes will land in MC-030+.

import { Badge, Button, Card, Chip, Input, Skeleton, ToastProvider } from '@multichef/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DesignDemoClient } from './_DesignDemoClient';

export default function DesignPage(): React.ReactElement {
  return (
    <ToastProvider>
      <main className="mx-auto max-w-content min-h-screen px-4 py-6">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-display">Дизайн-система</h1>
          <ThemeToggle />
        </header>

        <Section title="Button">
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button loading loadingText="Отправляем">
              Primary
            </Button>
          </div>
          <div className="flex flex-wrap gap-3 items-end mt-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium (default)</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        <Section title="Card">
          <div className="flex flex-col gap-3">
            <Card>
              <h3 className="text-heading mb-1">Default card</h3>
              <p className="text-caption">Простой контейнер с тонкой границей.</p>
            </Card>
            <Card variant="elevated">
              <h3 className="text-heading mb-1">Elevated card</h3>
              <p className="text-caption">Тень для важного контента.</p>
            </Card>
          </div>
        </Section>

        <Section title="Input">
          <div className="flex flex-col gap-3">
            <Input label="Название блюда" placeholder="Борщ" helper="до 64 символов" />
            <Input label="С ошибкой" defaultValue="abc" error="Минимум 8 символов" />
            <Input label="Disabled" disabled placeholder="Недоступно" />
          </div>
        </Section>

        <Section title="Chip">
          <div className="flex flex-wrap gap-2">
            <Chip>Без лактозы</Chip>
            <Chip selected>Острое</Chip>
            <Chip>Вегетарианское</Chip>
            <Chip>Без глютена</Chip>
          </div>
        </Section>

        <Section title="Badge">
          <div className="flex flex-wrap gap-2">
            <Badge tone="fresh">Свежее · 5 дней</Badge>
            <Badge tone="warning">Истекает · 3 дня</Badge>
            <Badge tone="danger">Истёк</Badge>
            <Badge tone="info">Подсказка</Badge>
            <Badge>Нейтральный</Badge>
          </div>
        </Section>

        <Section title="Skeleton">
          <div className="flex flex-col gap-2">
            <Skeleton width="w-1/2" height="h-4" />
            <Skeleton width="w-3/4" height="h-4" />
            <div className="flex items-center gap-2">
              <Skeleton rounded width="w-12" height="h-12" />
              <Skeleton width="w-32" height="h-4" />
            </div>
          </div>
        </Section>

        <Section title="Toast + BottomSheet (клиент-сайд демо)">
          <DesignDemoClient />
        </Section>

        <Section title="Типографика">
          <ul className="flex flex-col gap-1">
            <li className="text-display">Display 28/34</li>
            <li className="text-title">Title 22/28</li>
            <li className="text-heading">Heading 18/24</li>
            <li className="text-body">Body 16/24 — основной текст приложения.</li>
            <li className="text-caption">Caption 14/20 — вторичный текст.</li>
            <li className="text-small">Small 12/16 — бейджи, подписи табов.</li>
            <li className="text-price tabular-nums">₽ 1 250,00</li>
          </ul>
        </Section>
      </main>
    </ToastProvider>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mb-6">
      <h2 className="text-heading text-text-muted mb-3">{title}</h2>
      {children}
    </section>
  );
}
