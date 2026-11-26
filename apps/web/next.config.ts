import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const currentDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: join(currentDir, "../../"),
  transpilePackages: [
    "@cartridgefi/shared-types",
    "@cartridgefi/codama-clients",
    "@cartridgefi/ui-system",
    "@cartridgefi/sdk",
    "@cartridgefi/react",
  ],
  reactStrictMode: true,
};

export default nextConfig;
