"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { analyticsUrl, countingAllowed } from "@/lib/viewCount";

/**
 * Vercel Web Analytics (11.68), for unique visitors. Cookieless. Gets the same
 * cleaned-up addresses as our own counter, and nothing from browsers with Do
 * Not Track or Global Privacy Control, or a device the admin left out.
 */
function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  if (!countingAllowed()) return null;
  const url = analyticsUrl(event.url);
  return url ? { ...event, url } : null;
}

export default function VercelAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
