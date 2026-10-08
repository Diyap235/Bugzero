import type { NextConfig } from "next";

const apiUrl = (process.env.BUGZERO_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");

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
