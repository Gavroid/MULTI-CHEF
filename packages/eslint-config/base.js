// Shared ESLint v9 flat-config base for the multichef monorepo.
// Used by apps/* and packages/*. Kept intentionally small in MC-001.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      // Next.js auto-generates this file with a triple-slash reference that
      // our typescript-eslint rules do not understand. It is provided by the
      // framework, so we exclude it from lint checks.
      '**/next-env.d.ts',
      // Nest CLI / Next CLI artefacts.
      '**/.swc/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      // Framework-provided references (e.g. Next.js next-env.d.ts) disable
      // them locally; our rule should not flag the file even when it leaks.
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
  prettier,
];
