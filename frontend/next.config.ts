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
      source: "/api/auth/me",
      destination: "http://localhost:8080/auth/me",
    },
  ];
  },
};

export default nextConfig;