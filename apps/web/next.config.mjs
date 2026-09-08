/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Future-proof: target Node 24 runtime; trim experimental defaults we do not need.
  poweredByHeader: false,
  // Mobile-first viewport defaults are wired via the root <meta> in app/layout.tsx.
  // Pin the workspace root so Next.js does not infer it from a stale /root/workspace/package-lock.json.
  outputFileTracingRoot: process.cwd(),
  // Disable Next devtools. Next 15.5.25 devtools trips an RSC bundler bug
  // ("Could not find the module ... segment-explorer-node.js") in pnpm
  // workspaces. Devtools are not needed for the MC-001 smoke flow; revisit
  // once Next.js fixes the upstream issue or we move to a different bundler.
  devIndicators: false,
};

export default nextConfig;
