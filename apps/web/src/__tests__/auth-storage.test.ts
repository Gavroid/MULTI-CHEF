// auth-storage tests — localStorage round-trip + edge cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';

interface MemoryStorage {
  data: Map<string, string>;
}

function newMemoryStorage(): MemoryStorage {
  return { data: new Map<string, string>() };
}

function installStorage(mem: MemoryStorage): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g['window'] = {
    localStorage: {
      getItem: (k: string) => mem.data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.data.set(k, v);
      },
      removeItem: (k: string) => {
        mem.data.delete(k);
      },
      clear: () => mem.data.clear(),
      key: (i: number) => Array.from(mem.data.keys())[i] ?? null,
      get length() {
        return mem.data.size;
      },
    },
  };
}

const authStorage = await import('../lib/auth-storage');

const sampleUser = {
  id: 'u1',
  email: 'a@b.c',
  status: 'ACTIVE' as const,
  tz: 'Europe/Moscow',
  locale: 'ru',
  isGuestConverted: false,
};

test('saveLocalUser writes a non-secret summary to localStorage', () => {
  const mem = newMemoryStorage();
  installStorage(mem);
  authStorage.saveLocalUser(sampleUser, { id: 'h1' });
  const raw = mem.data.get('mc_user');
  assert.ok(raw);
  const parsed = JSON.parse(raw ?? '{}');
  assert.equal(parsed.id, 'u1');
  assert.equal(parsed.email, 'a@b.c');
  assert.equal(parsed.householdId, 'h1');
  // Defensive: no token-shaped key may leak.
  assert.equal('sessionToken' in parsed, false);
  assert.equal('password' in parsed, false);
});

test('readLocalUser returns null when nothing is stored', () => {
  const mem = newMemoryStorage();
  installStorage(mem);
  assert.equal(authStorage.readLocalUser(), null);
});

test('readLocalUser returns the parsed StoredUser', () => {
  const mem = newMemoryStorage();
  installStorage(mem);
  authStorage.saveLocalUser(sampleUser, { id: 'h42' });
  const stored = authStorage.readLocalUser();
  assert.ok(stored);
  // T46-C/D (E23): locale/tz now persist in the marker.
  assert.deepEqual(stored, {
    id: 'u1',
    email: 'a@b.c',
    householdId: 'h42',
    locale: 'ru',
    tz: 'Europe/Moscow',
  });
});

test('readLocalUser returns null on malformed JSON (no crash)', () => {
  const mem = newMemoryStorage();
  installStorage(mem);
  mem.data.set('mc_user', '{not json');
  assert.equal(authStorage.readLocalUser(), null);
});

test('readLocalUser returns null when the shape is incomplete', () => {
  const mem = newMemoryStorage();
  installStorage(mem);
  mem.data.set('mc_user', JSON.stringify({ id: 'u1' })); // missing email + householdId
  assert.equal(authStorage.readLocalUser(), null);
});

test('clearLocalUser removes the marker', () => {
  const mem = newMemoryStorage();
  installStorage(mem);
  authStorage.saveLocalUser(sampleUser, { id: 'h1' });
  assert.ok(mem.data.has('mc_user'));
  authStorage.clearLocalUser();
  assert.equal(mem.data.has('mc_user'), false);
});

test('hasLocalUser mirrors readLocalUser !== null', () => {
  const mem = newMemoryStorage();
  installStorage(mem);
  assert.equal(authStorage.hasLocalUser(), false);
  authStorage.saveLocalUser(sampleUser, { id: 'h1' });
  assert.equal(authStorage.hasLocalUser(), true);
});
