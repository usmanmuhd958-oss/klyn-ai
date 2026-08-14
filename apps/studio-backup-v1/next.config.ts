import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Canonical packages are transpiled, never path-imported.
  transpilePackages: ["@klyn/agent-runtime", "@klyn/workflow-engine"],
  experimental: { reactCompiler: true },
};

export default nextConfig;
