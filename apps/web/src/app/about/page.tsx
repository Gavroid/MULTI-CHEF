import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'О проекте — Мультишеф',
  description: 'Установите PWA на телефон или поделитесь ссылкой.',
};

export default function AboutPage() {
  const installUrl = 'https://multi-chef.431a.ru/';
  // QR-код через внешний сервис — кэшируется Next'ом, не бьёт приватность.
  // Альтернатива: реализовать qrcode.js client-side (пост-MVP).
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(installUrl)}&bgcolor=ffffff&color=0a0a0a`;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Мультишеф</h1>
      <p className="mt-2 text-zinc-600">Меню недели из того, что есть в холодильнике.</p>

      <section className="mt-10 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-medium">Установить на телефон</h2>
        <p className="mt-1 text-sm text-zinc-600">Отсканируйте камерой или нажмите на QR-код:</p>
        <img
          src={qrSrc}
          alt="QR-код на https://multi-chef.431a.ru/"
          width={240}
          height={240}
          className="mx-auto mt-4 rounded-lg"
        />
        <p className="mt-3 break-all font-mono text-xs text-zinc-500">{installUrl}</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
        >
          Открыть приложение
        </Link>
      </section>

      <section className="mt-10 text-left text-sm text-zinc-700">
        <h2 className="text-xl font-medium text-zinc-900">Инструкции</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-6">
          <li>
            <strong>iOS:</strong> откройте ссылку в Safari → «Поделиться» → «На экран Домой».
          </li>
          <li>
            <strong>Android:</strong> откройте в Chrome → меню → «Добавить на главный экран».
          </li>
        </ol>
        <p className="mt-4">
          Подробнее:{' '}
          <Link
            href="https://github.com/Gavroid/MULTI-CHEF/blob/main/docs/USER-GUIDE.md"
            className="text-orange-600 underline"
            target="_blank"
            rel="noreferrer"
          >
            USER-GUIDE.md
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
