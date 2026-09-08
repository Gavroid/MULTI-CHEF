import base from '@multichef/eslint-config/base';

export default [
  ...base,
  {
    ignores: ['dist', '**/*.d.ts', 'prisma/migrations/**'],
  },
];
