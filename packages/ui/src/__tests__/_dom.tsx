// Lightweight test helper: installs a happy-dom global, exposes `render`
// (uses React's createRoot), and a few ergonomic helpers. No external
// testing-library dependency — keeps the runtime tight and matches the
// rest of the monorepo's `node --test` style.
//
// Usage:
//   import { installDom, render, fireClick, unmount } from './dom.tsx';
//   installDom();
//   const { container, getByRole, unmount } = render(<Button>Hi</Button>);
//   fireClick(getByRole('button'));

import { Window } from 'happy-dom';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

let installed = false;

export function installDom(): void {
  if (installed) return;
  installed = true;
  const window = new Window();
  const document = window.document;
  // React 19's DOM renderer reads from globals; happy-dom doesn't install them.
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = document;
  // Node 24 exposes `navigator` as a non-writable getter on globalThis; use defineProperty
  // so we can swap it for happy-dom's navigator.
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: true,
  });
  g.HTMLElement = window.HTMLElement;
  g.Element = window.Element;
  g.Node = window.Node;
  g.Text = window.Text;
  g.DocumentFragment = window.DocumentFragment;
  g.Event = window.Event;
  g.MouseEvent = window.MouseEvent;
  g.FocusEvent = window.FocusEvent;
  g.KeyboardEvent = window.KeyboardEvent;
  g.CustomEvent = window.CustomEvent;
  g.getComputedStyle = window.getComputedStyle.bind(window);
  g.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number): void => clearTimeout(id);
}

export interface RenderResult {
  container: HTMLElement;
  unmount: () => void;
  root: Root;
}

export function render(element: ReactElement): RenderResult {
  installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    root,
    unmount: (): void => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export function fireClick(target: Element): void {
  act(() => {
    const w = (globalThis as unknown as { window: Window }).window;
    const MouseEventCtor = (w as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent;
    target.dispatchEvent(
      new MouseEventCtor('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
}

export function fireChange(target: Element, value: string): void {
  const input = target as HTMLInputElement;
  act(() => {
    // React tracks the value getter; setting it directly bypasses React's
    // input value tracker, which causes React to think the value hasn't
    // changed. Use the native setter hack to emit a real change event.
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, value);
    const w = (globalThis as unknown as { window: Window }).window;
    const EventCtor = (w as unknown as { Event: typeof Event }).Event;
    input.dispatchEvent(new EventCtor('input', { bubbles: true }));
    input.dispatchEvent(new EventCtor('change', { bubbles: true }));
  });
}

export function fireKey(target: Element, key: string): void {
  act(() => {
    const w = (globalThis as unknown as { window: Window }).window;
    const KeyboardEventCtor = (w as unknown as { KeyboardEvent: typeof KeyboardEvent })
      .KeyboardEvent;
    target.dispatchEvent(
      new KeyboardEventCtor('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

// `getByRole` / `getByText` — minimal query helpers. We deliberately keep
// these dumb (no accessibility-tree magic) so tests assert the actual DOM
// they ship. Filtering by accessible role + name.
export function getByRole(
  container: Element,
  role: string,
  options: { name?: string | RegExp } = {},
): HTMLElement {
  const all = container.querySelectorAll<HTMLElement>(`[role="${role}"], ${implicitRoles}`);
  for (const el of Array.from(all)) {
    if (matchesRole(el, role) && matchesName(el, options.name)) return el;
  }
  throw new Error(
    `getByRole: no element with role="${role}"${options.name ? ` name=${String(options.name)}` : ''}`,
  );
}

export function getByText(container: Element, text: string | RegExp): HTMLElement {
  const walker = container.ownerDocument.createTreeWalker(container, 0x004 /* SHOW_ALL */);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === 3 /* TEXT */ && matchesName(node as unknown as Element, text)) {
      // Return the closest HTMLElement ancestor — text nodes aren't useful to assert against.
      return (node.parentElement ?? (container as HTMLElement)) as HTMLElement;
    }
    node = walker.nextNode();
  }
  throw new Error(`getByText: no text matching ${text}`);
}

const implicitRoles = 'button, input, textarea, select, a[href]';
function matchesRole(el: HTMLElement, role: string): boolean {
  if (el.getAttribute('role') === role) return true;
  const tag = el.tagName.toLowerCase();
  if (role === 'button' && tag === 'button') return true;
  if (role === 'textbox' && (tag === 'input' || tag === 'textarea')) return true;
  if (role === 'link' && tag === 'a') return true;
  return false;
}

// Compute the accessible name of an element.
// Priority: aria-labelledby > aria-label > <label for=id> > own textContent.
// Returns empty string if no name source is found.
function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ownerDoc = el.ownerDocument ?? document;
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => ownerDoc.getElementById(id)?.textContent?.trim() ?? '');
    if (parts.some(Boolean)) return parts.join(' ').trim();
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;
  if ('id' in el && el.id) {
    const ownerDoc = el.ownerDocument ?? document;
    const labelEl = ownerDoc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (labelEl?.textContent) return labelEl.textContent.trim();
  }
  // Fall back to own text (for buttons, links, paragraphs).
  return (el.textContent ?? '').trim();
}

function cssEscape(value: string): string {
  // Minimal CSS.escape polyfill — happy-dom doesn't ship CSS.escape.
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/(["\\])/g, '\\$1');
}
function matchesName(el: Element, name: string | RegExp | undefined): boolean {
  if (name === undefined) return true;
  const text = accessibleName(el);
  return typeof name === 'string' ? text === name : name.test(text);
}
