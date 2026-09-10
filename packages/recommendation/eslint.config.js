import base from '@multichef/eslint-config/base';

export default [
  ...base,
  {
    ignores: ['dist', '**/*.d.ts'],
  },
  {
    name: 'recommendation/purity',
    rules: {
      // Domain package: no I/O, no clock, no randomness, no environment.
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'Inject ctx.now instead (MC-032 purity rule).',
        },
        { object: 'Math', property: 'random', message: 'Scoring must be deterministic.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'No I/O in the recommendation package.' },
        { name: 'process', message: 'No env access in the recommendation package.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/*', '@multichef/database', '@multichef/nutrition', 'apps/*'],
              message: 'Out of package boundary (MC-032 ADR §7).',
            },
          ],
        },
      ],
    },
  },
];
