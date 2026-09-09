// PostCSS config — Tailwind v3 + autoprefixer.
// Tailwind v4 changes the syntax to a CSS-first config; we use v3 for the
// proven Next.js 15 integration path (see ADR-0014).

const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
