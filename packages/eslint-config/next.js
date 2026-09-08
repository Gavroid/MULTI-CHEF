// Next.js-side ESLint config (apps/web). Extends base + browser globals.
import base from './base.js';
import globals from 'globals';

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
