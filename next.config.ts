import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  // Road pages read the data file on the server.
  // Road pages and preview images read the data file and fonts on the server.
  outputFileTracingIncludes: {
    "/road/[id]": ["./public/data/**/*.json"],
    "/road/[id]/opengraph-image": ["./public/data/**/*.json", "./assets/fonts/*.ttf"],
    "/opengraph-image": ["./public/data/**/*.json", "./assets/fonts/*.ttf"],
    "/about": ["./public/data/**/*.json"],
  },
  async headers() {
    return [
      {
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
