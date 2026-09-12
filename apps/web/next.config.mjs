// MC-002: validate the web-side env at config-load time.
//
// `next.config.mjs` is parsed by Next's SWC pipeline using Node's
// native ESM resolver, so it must consume the *built* artefact from
// @multichef/config (not the raw TS source). The turbo `build`
// dependency for apps/web is wired to `^build`, which means
// @multichef/config#build runs first and emits dist/. We then load
// the validation function from there.

import { loadWebEnv, EnvValidationError } from "@multichef/config";

let parsed;
try {
  parsed = loadWebEnv();
} catch (err) {
  if (err instanceof EnvValidationError) {
    throw new Error(`[next.config.mjs] ${err.message}`);
  }
  throw err;
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // MC-034: web imports runtime values (Zod schemas) from
  // @multichef/contracts, a TS-source workspace package that uses
  // NodeNext-style "./x.js" specifiers. Compile its sources and map
  // the .js specifiers back onto .ts files.
  transpilePackages: ["@multichef/contracts"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
  env: {
    NEXT_PUBLIC_APP_BASE_URL: parsed.NEXT_PUBLIC_APP_BASE_URL,
  },
};

export default nextConfig;
