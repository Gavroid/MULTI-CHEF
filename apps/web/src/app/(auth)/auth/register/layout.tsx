import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// T1: server layout owns the document metadata — the page itself is a
// client component and cannot export metadata.
export const metadata: Metadata = {
  title: 'Регистрация',
  description: 'Создайте семейный аккаунт MULTI-CHEF за минуту.',
};

export default function Layout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
