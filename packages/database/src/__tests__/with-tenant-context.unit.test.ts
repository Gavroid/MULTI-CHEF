// T25-A (audit round 25): withTenantContext — security-critical хелпер
// (RLS-контекст для всех tenant-запросов). Unit-тесты на мок-клиенте
// фиксируют контракт set_config: переменные, transaction-local флаг и
// проброс результата/ошибки из callback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTenantContext } from '../index.js';

type RecordedQuery = { text: string; values: string[] };

function makeFakeClient(queries: RecordedQuery[], fnResult?: unknown) {
  const executeRaw = (query: TemplateStringsArray, ...values: string[]) => {
    queries.push({ text: query.join('?'), values: values as string[] });
    return Promise.resolve(fnResult);
  };
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: executeRaw }),
    $executeRaw: executeRaw,
  } as never;
}

test('withTenantContext: ставит оба GUC через set_config (transaction-local)', async () => {
  const queries: RecordedQuery[] = [];
  const client = makeFakeClient(queries);
  const result = await withTenantContext(
    { householdId: 'HH1', userId: 'U1' },
    async (tx) => {
      assert.ok(tx, 'tx передан в callback');
      return 'ok';
    },
    { client },
  );
  assert.equal(result, 'ok');
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.text, /set_config\('app\.household_id', \?, true\)/);
  assert.match(queries[0]!.text, /set_config\('app\.user_id', \?, true\)/);
  assert.deepEqual(queries[0]!.values, ['HH1', 'U1']);
});

test('withTenantContext: отсутствующие ключи → пустые строки (fail-closed)', async () => {
  const queries: RecordedQuery[] = [];
  const client = makeFakeClient(queries);
  await withTenantContext({}, async () => 'x', { client });
  assert.deepEqual(queries[0]!.values, ['', '']);
});

test('withTenantContext: пробрасывает ошибку callback (rollback)', async () => {
  const client = makeFakeClient([], undefined);
  await assert.rejects(
    withTenantContext(
      { householdId: 'H' },
      async () => {
        throw new Error('boom');
      },
      { client },
    ),
    /boom/,
  );
});
