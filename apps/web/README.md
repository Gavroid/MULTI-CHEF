# @multichef/web

Next.js 15 web client. App Router, TypeScript strict, mobile-first.

## Stack

- **Framework**: Next.js 15.5 (App Router, server components by default).
- **Runtime**: React 19.
- **Styling**: Tailwind v3.4 (PostCSS pipeline) + CSS custom properties
  for design tokens. See `src/app/globals.css` for the full token set
  (light + dark themes via `data-theme` on `<html>`).
- **UI primitives**: `@multichef/ui` — see `../../packages/ui/`.

## Scripts

```bash
pnpm dev                # next dev on WEB_PORT (default 3000)
pnpm build              # next build
pnpm start              # next start
pnpm lint               # eslint .
pnpm typecheck          # tsc --noEmit
pnpm test               # node --test (smoke + design-system)
pnpm clean              # wipe .next / .turbo
```

## Routes

| Route         | Purpose                                                             |
| ------------- | ------------------------------------------------------------------- |
| `/`           | Landing page (MC-012 demo: brand palette + typography + UI primes). |
| `/design`     | Internal design-system playground — every primitive in every state. |
| `/_not-found` | Default 404.                                                        |

## File layout

```
src/
├── app/
│   ├── layout.tsx           Root layout (HTML/body + globals.css)
│   ├── page.tsx             Landing
│   ├── design/
│   │   ├── page.tsx         Design demo (server component)
│   │   └── _DesignDemoClient.tsx  Interactive demo (BottomSheet/Toast)
│   └── globals.css          Design tokens + Tailwind base/components/utilities
├── components/
│   └── ThemeToggle.tsx      Header theme switcher (light/dark)
├── hooks/
│   └── useTheme.ts          Theme state + localStorage persistence
└── __tests__/
    ├── smoke.test.tsx       Landing + globals + tailwind config checks
    └── design-system.test.tsx  End-to-end wiring assertions
```

## Adding a new component

1. Implement in `../../packages/ui/src/components/`.
2. Add the export to `../../packages/ui/src/index.ts`.
3. Add a `Section` for it in `src/app/design/page.tsx` so reviewers can
   eyeball every state.
4. Use the Tailwind tokens (`bg-primary`, `text-text-muted`, `rounded-md`,
   …) — never hardcode hex values or rems in component code.

## Theme tokens

All token values live in `src/app/globals.css`. Adding a new colour or
spacing step means:

1. Define `--your-token` in both `:root` (light) and `[data-theme="dark"]`
   blocks.
2. Register it in `tailwind.config.ts` under `theme.extend.colors` /
   `theme.extend.spacing` / etc.
3. Mirror it as a TS constant in `packages/ui/src/tokens.ts` so JS code
   (tests, analytics, dynamic styles) can reference it without parsing CSS.
