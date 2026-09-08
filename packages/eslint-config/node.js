// Node-side ESLint config (apps/api, apps/worker).
import base from './base.js';

export default [
  ...base,
  {
    languageOptions: {
      sourceType: 'module',
    },
  },
];
