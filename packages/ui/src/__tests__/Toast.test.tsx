import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './_dom.tsx';
import './_dom.tsx';
const { ToastProvider, toast, useToast } = await import('../components/Toast');

function ShowToast({ message }: { message: string }): React.ReactElement {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show({ message })}>
      show
    </button>
  );
}

test('ToastProvider renders without crashing', () => {
  const { container } = render(
    <ToastProvider>
      <div>app</div>
    </ToastProvider>,
  );
  assert.match(container.textContent ?? '', /app/);
});

test('toast.show renders the message in the viewport', () => {
  const { container } = render(
    <ToastProvider>
      <ShowToast message="Сохранено" />
    </ToastProvider>,
  );
  act(() => {
    toast.show({ message: 'Сохранено' });
  });
  const toastEl = container.querySelector('[data-testid="mc-toast"]');
  assert.ok(toastEl, 'toast element should mount');
  assert.match(toastEl?.textContent ?? '', /Сохранено/);
});

test('toast.action button is rendered and clickable', () => {
  let clicked = false;
  const { container } = render(
    <ToastProvider>
      <ShowToast message="msg" />
    </ToastProvider>,
  );
  act(() => {
    toast.show({
      message: 'Удалено',
      action: {
        label: 'Отменить',
        onClick: () => {
          clicked = true;
        },
      },
    });
  });
  const toastEl = container.querySelector('[data-testid="mc-toast"]');
  const actionBtn = Array.from(toastEl?.querySelectorAll('button') ?? []).find(
    (b) => b.textContent === 'Отменить',
  );
  assert.ok(actionBtn, 'action button should render');
  actionBtn?.click();
  assert.equal(clicked, true);
});

test('toast disappears after durationMs (timer-driven)', async () => {
  const { container } = render(
    <ToastProvider>
      <ShowToast message="x" />
    </ToastProvider>,
  );
  act(() => {
    toast.show({ message: 'Временное', durationMs: 50 });
  });
  let toastEl = container.querySelector('[data-testid="mc-toast"]');
  assert.ok(toastEl, 'toast should appear first');
  await new Promise<void>((r) => setTimeout(r, 80));
  toastEl = container.querySelector('[data-testid="mc-toast"]');
  assert.equal(toastEl, null, 'toast should auto-dismiss after durationMs');
});

test('useToast outside provider throws', () => {
  assert.throws(() => {
    render(<ShowToast message="nope" />);
  }, /useToast must be used inside/);
});
