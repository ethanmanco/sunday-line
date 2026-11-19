export const SITE_NAME = "Sunday Line";
export const REGION_SLUG = "shreveport";
export const DATA_URL = `/data/${REGION_SLUG}/roads.json`;
export const GITHUB_URL = "https://github.com/ethanmanco/sunday-line";
export const MORE_PROJECTS_URL = "https://mancolabs.dev/lab/";
export const CONTACT_EMAIL = "ethanmanco@gmail.com";

/** Absolute site address, for share links and preview images. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3210");
