import Link from 'next/link';

// T48-C (audit round 48): русская 404 вместо дефолтной английской.
export default function NotFound(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-content flex-col items-center justify-center px-4 text-center">
      <h1 className="text-heading mb-2">Страница не найдена</h1>
      <p className="text-body text-text-muted mb-6">
        Похоже, такой страницы не существует или она переехала.
      </p>
      <Link href="/" className="underline text-[var(--color-primary)] hover:no-underline">
        На главную
      </Link>
    </main>
  );
}
