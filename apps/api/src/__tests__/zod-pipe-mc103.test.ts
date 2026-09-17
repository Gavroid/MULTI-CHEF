// MC-103 (Audit R16) — pipe-level Zod validation unit tests.
//
// AC-1: empty email rejected (VALIDATION_ERROR, field-level error).
// AC-2: malformed email format rejected.
// AC-3: pipe catches invalid input WITHOUT service-layer guards.
// AC-4: valid input passes through; short password rejected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RegisterBody } from '../auth/auth.dto.js';

interface PipeResponse {
  code?: string;
  message?: string;
  details?: { fields?: Record<string, string[]> };
}

const pipe = new ZodValidationPipe(RegisterBody);

function meta() {
  return { type: 'body' as const, metatype: undefined, data: undefined };
}

function asValidation(err: unknown): PipeResponse | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { getResponse?: () => unknown; response?: unknown };
  const raw = e.getResponse ? e.getResponse() : e.response;
  if (typeof raw !== 'object' || raw === null) return null;
  return raw as PipeResponse;
}

test('AC-1: pipe rejects {} with VALIDATION_ERROR + field errors', () => {
  assert.throws(
    () => pipe.transform({}, meta()),
    (err: unknown) => {
      const r = asValidation(err);
      return r?.code === 'VALIDATION_ERROR' && r?.details?.fields !== undefined;
    },
  );
});

test('AC-1: pipe rejects empty email', () => {
  assert.throws(
    () => pipe.transform({ email: '', password: 'abcdefgh' }, meta()),
    (err: unknown) => asValidation(err)?.code === 'VALIDATION_ERROR',
  );
});

test('AC-2: pipe rejects "not-an-email" with field-level email error', () => {
  assert.throws(
    () => pipe.transform({ email: 'not-an-email', password: 'abcdefgh' }, meta()),
    (err: unknown) => {
      const r = asValidation(err);
      const fields = r?.details?.fields;
      return (
        r?.code === 'VALIDATION_ERROR' &&
        fields !== undefined &&
        Array.isArray(fields['email']) &&
        fields['email'].length > 0
      );
    },
  );
});

test('AC-2: pipe rejects email without @', () => {
  assert.throws(
    () => pipe.transform({ email: 'foo', password: 'abcdefgh' }, meta()),
    (err: unknown) => asValidation(err)?.code === 'VALIDATION_ERROR',
  );
});

test('AC-2: pipe rejects email with spaces', () => {
  assert.throws(
    () => pipe.transform({ email: 'foo @bar.com', password: 'abcdefgh' }, meta()),
    (err: unknown) => asValidation(err)?.code === 'VALIDATION_ERROR',
  );
});

test('AC-4: valid body passes through with toLowerCase applied', () => {
  const out = pipe.transform({ email: 'Foo@Example.COM', password: 'abcdefgh' }, meta()) as {
    email: string;
    password: string;
  };
  assert.equal(out.email, 'foo@example.com');
  assert.equal(out.password, 'abcdefgh');
});

test('AC-4: pipe rejects short password with field-level error', () => {
  assert.throws(
    () => pipe.transform({ email: 'valid@example.com', password: 'abc' }, meta()),
    (err: unknown) => {
      const r = asValidation(err);
      const fields = r?.details?.fields;
      return (
        r?.code === 'VALIDATION_ERROR' &&
        fields !== undefined &&
        Array.isArray(fields['password']) &&
        fields['password'].length > 0
      );
    },
  );
});

test('fallback: pipe without schema argument is a no-op', () => {
  const noop = new ZodValidationPipe();
  assert.deepEqual(noop.transform({ email: 'garbage' }, meta()), {
    email: 'garbage',
  });
});

test('fallback: pipe with empty body returns the empty body', () => {
  const noop = new ZodValidationPipe();
  assert.deepEqual(noop.transform({}, meta()), {});
});
