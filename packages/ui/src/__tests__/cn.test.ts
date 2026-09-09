import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cn } from '../cn';

test('cn joins string class names', () => {
  assert.equal(cn('a', 'b', 'c'), 'a b c');
});

test('cn ignores falsy values', () => {
  assert.equal(cn('a', false, null, undefined, '', 'b'), 'a b');
});

test('cn flattens nested arrays and objects', () => {
  // clsx turns objects into conditional classes: { active: true } → 'active'
  assert.equal(cn(['a', { b: true, c: false }]), 'a b');
});

test('cn resolves conflicting Tailwind utilities (later wins)', () => {
  // tailwind-merge behaviour: conflicting padding classes collapse to the last.
  assert.equal(cn('px-2', 'px-4'), 'px-4');
  assert.equal(cn('text-fresh', 'text-danger'), 'text-danger');
});
