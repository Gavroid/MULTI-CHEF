import { test } from 'node:test';
import assert from 'node:assert/strict';

// The package re-exports its public surface. We assert the shape (presence +
// arity of key symbols) without binding to internal implementation details.
// If the public API contract changes, this test is the single place to
// update — it documents what apps/web consumes.
test('ui package re-exports tokens, cn, and components (MC-012)', async () => {
  const mod = await import('../index');
  const keys = Object.keys(mod).sort();
  // Required exports (presence only — types are erased at runtime).
  for (const name of [
    'Button',
    'Input',
    'Card',
    'Chip',
    'Badge',
    'Skeleton',
    'ToastProvider',
    'toast',
    'useToast',
    'BottomSheet',
    'cn',
    'colors',
    'space',
    'radius',
    'shadow',
  ]) {
    assert.ok(keys.includes(name), `missing export: ${name}`);
  }
});

test('ui cn helper is callable (sanity)', async () => {
  const { cn } = await import('../cn');
  assert.equal(typeof cn, 'function');
  assert.equal(cn('a', 'b'), 'a b');
});

test('ui tokens export has the expected color keys (PRD §2.5.1)', async () => {
  const { colors } = await import('../tokens');
  for (const key of [
    'bg',
    'surface',
    'surface2',
    'border',
    'text',
    'textMuted',
    'primary',
    'fresh',
    'warning',
    'danger',
    'info',
  ]) {
    assert.ok(key in colors, `colors.${key} is missing`);
    assert.match(
      colors[key as keyof typeof colors],
      /^var\(--color-/,
      `colors.${key} should reference a CSS custom property`,
    );
  }
});
