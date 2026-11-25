import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  // Development only: lets a second test account run at 127.0.0.1 next to localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // Road pages read the data file on the server.
  // Road pages and preview images read the data file and fonts on the server.
  outputFileTracingIncludes: {
    // Only the small files: road squares are fetched from the site's static files.
    "/road/[id]": ["./public/data/us/index.json", "./public/data/us/road-cells.json"],
    "/road/[id]/opengraph-image": ["./public/data/us/index.json", "./public/data/us/road-cells.json", "./assets/fonts/*.ttf"],
    "/opengraph-image": ["./public/data/us/index.json", "./assets/fonts/*.ttf"],
    "/about": ["./public/data/us/index.json"],
  },
  // OpenFreeMap's street tiles through this site, for browsers whose blocker
  // blocks them (11.80, lib/mapStyle.ts). Used only when they're blocked.
  async rewrites() {
    return [
      { source: "/streets", destination: "https://tiles.openfreemap.org/planet" },
      { source: "/streets/:path*", destination: "https://tiles.openfreemap.org/planet/:path*" },
    ];
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
