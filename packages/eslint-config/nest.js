// NestJS-side ESLint config (apps/api). Extends node + adds decorator-friendly tweaks.
//
// Audit R17: registers a custom rule that requires @Body() in NestJS
// controllers to be wrapped in `new ZodValidationPipe(Schema)` — see
// ADR-0024 and docs/audit/AUDIT-R16-SUMMARY.md (MC-103). Without this
// rule, contributors can re-introduce the MC-103 regression by typing
// `@Body() body: SomeDto` and skipping pipe-level validation.
import base from './node.js';
import requireZodBodySchema from '../../apps/api/eslint-rules/require-zod-body-schema.mjs';

export default [
  ...base,
  {
    plugins: {
      multichef: {
        rules: {
          'require-zod-body-schema': requireZodBodySchema,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Rule self-gates on *.controller.ts filenames; safe to enable globally.
      'multichef/require-zod-body-schema': 'warn',
    },
  },
];
