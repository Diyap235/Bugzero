import type { NextConfig } from "next";

const configuredApiUrl = new URL(process.env.BUGZERO_API_URL ?? "http://127.0.0.1:3001");
if (configuredApiUrl.hostname === "localhost") configuredApiUrl.hostname = "127.0.0.1";
const apiUrl = configuredApiUrl.toString().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@bugzero/contracts"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async rewrites() {
    return [{
      source: "/api/bugzero/:path*",
      destination: `${apiUrl}/:path*`,
    }];
  },
};

export default nextConfig;
