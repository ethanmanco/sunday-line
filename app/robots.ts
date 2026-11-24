import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

// Search engines (11.67): the public pages, and where the sitemap is. Private
// pages (your account, messages, invite links) stay out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/auth", "/j/", "/me", "/messages", "/notifications", "/signin", "/spots"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
