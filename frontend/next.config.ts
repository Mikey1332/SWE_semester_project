import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
  return [
    {
      // Every /api/* call goes to the Go backend: /api/auth/me, /api/markets/1/buy, ...
      source: "/api/:path*",
      destination: "http://localhost:8080/:path*",
    },
  ];
  },
};

export default nextConfig;