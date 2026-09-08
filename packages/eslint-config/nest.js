// NestJS-side ESLint config (apps/api). Extends node + adds decorator-friendly tweaks.
import base from './node.js';

export default [
  ...base,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
