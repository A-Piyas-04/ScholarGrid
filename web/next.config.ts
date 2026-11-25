import type { NextConfig } from "next";

const api = process.env.SCHOLARGRID_API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The browser talks to /api on the same origin; Next forwards it to the FastAPI server.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
  experimental: { proxyTimeout: 180_000 },
};

export default nextConfig;
