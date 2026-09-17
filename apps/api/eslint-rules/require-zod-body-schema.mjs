// Custom ESLint rule: require @Body() in NestJS controllers to be wrapped
// in `new ZodValidationPipe(SomeZodSchema)` — see ADR-0024 + docs/audit/AUDIT-R16-SUMMARY.md
//
// Why: in NestJS 11 + Fastify, pipe-level validation cannot reliably
// discover the Zod schema via metatype.staticField (R15/MC-101 bug).
// The only safe pattern is to pass the schema explicitly to the pipe.
// Without a lint rule, contributors can re-introduce the MC-103 bug by
// typing `@Body() body: SomeDto` without a pipe.
//
// Pattern matched:
//   bad:  @Body() body: SomeDto
//   bad:  @Body(new ZodValidationPipe()) body: SomeDto
//   good: @Body(new ZodValidationPipe(SomeSchema)) body: SomeDto

/**
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require @Body() in NestJS controllers to use ZodValidationPipe(Schema)',
      recommended: false,
    },
    schema: [],
    messages: {
      missingPipe:
        '@Body() must be wrapped in `new ZodValidationPipe(Schema)`. See ADR-0024 and docs/audit/AUDIT-R16-SUMMARY.md (MC-103).',
      emptyPipe:
        '@Body(new ZodValidationPipe()) without a Zod schema is unreliable under NestJS 11 + Fastify (R15/MC-101 root cause). Pass the schema explicitly.',
    },
  },

  create(context) {
    // Only enforce on NestJS controller files. Anything else is out of scope.
    const filename = context.filename || context.getFilename();
    if (!/\.controller\.ts$/.test(filename)) {
      return {};
    }
    return {
      Decorator(node) {
        if (
          !node.expression ||
          node.expression.type !== 'CallExpression' ||
          !node.expression.callee ||
          node.expression.callee.type !== 'Identifier' ||
          node.expression.callee.name !== 'Body'
        ) {
          return;
        }
        const args = node.expression.arguments;
        // Case 1: @Body() — no arguments at all
        if (args.length === 0) {
          context.report({ node: node.expression, messageId: 'missingPipe' });
          return;
        }
        // Case 2: @Body(something) — check if it is ZodValidationPipe(Schema)
        const first = args[0];
        if (
          first.type !== 'NewExpression' ||
          !first.callee ||
          first.callee.type !== 'Identifier' ||
          first.callee.name !== 'ZodValidationPipe'
        ) {
          // Some other decorator arg (e.g. an options object) — ignore,
          // we only flag missing/empty ZodValidationPipe.
          return;
        }
        if (first.arguments.length === 0) {
          context.report({ node: first, messageId: 'emptyPipe' });
        }
      },
    };
  },
};
