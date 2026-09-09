import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, fireKey } from './_dom.tsx';
import './_dom.tsx';
const { BottomSheet } = await import('../components/BottomSheet');

// BottomSheet renders into a portal attached to document.body, so tests
// query against document (the global) instead of the render container.

function Harness({ onClose }: { onClose: () => void }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <BottomSheet
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Title"
      >
        body
      </BottomSheet>
    </>
  );
}

test('BottomSheet renders nothing when closed', () => {
  const { container } = render(<Harness onClose={() => {}} />);
  assert.equal(container.querySelector('[data-testid="mc-bottom-sheet"]'), null);
  assert.equal(document.body.querySelector('[data-testid="mc-bottom-sheet"]'), null);
});

test('BottomSheet renders dialog with role=dialog and title when open', () => {
  function C(): React.ReactElement {
    const [open] = React.useState(true);
    return (
      <BottomSheet open={open} onClose={() => {}} title="Hello">
        body
      </BottomSheet>
    );
  }
  render(<C />);
  const dialog = document.body.querySelector('[role="dialog"]');
  assert.ok(dialog, 'dialog should mount via portal');
  assert.equal(dialog?.getAttribute('aria-modal'), 'true');
  const title = document.body.querySelector('#mc-bottom-sheet-title');
  assert.ok(title);
  assert.equal(title?.textContent, 'Hello');
});

test('BottomSheet backdrop element exists with correct semantics', () => {
  function C(): React.ReactElement {
    const [open, setOpen] = React.useState(false);
    return (
      <>
        <button id="open-btn" onClick={() => setOpen(true)}>
          open
        </button>
        <BottomSheet open={open} onClose={() => setOpen(false)} title="T">
          x
        </BottomSheet>
      </>
    );
  }
  const { container } = render(<C />);
  act(() => {
    container.querySelector('#open-btn')?.click();
  });
  const backdrop = document.body.querySelector('button[aria-label="Закрыть"][tabindex="-1"]');
  assert.ok(backdrop, 'backdrop overlay button must render when open');
  assert.match((backdrop as HTMLElement).className, /absolute/);
  assert.match((backdrop as HTMLElement).className, /inset-0/);
});

test('BottomSheet Escape key closes', () => {
  let closed = 0;
  const { container } = render(
    <Harness
      onClose={() => {
        closed += 1;
      }}
    />,
  );
  act(() => {
    container.querySelector('button')?.click();
  });
  fireKey(document.body, 'Escape');
  assert.equal(closed, 1);
});
