import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
