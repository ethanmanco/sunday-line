"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/push";

/** Registers the service worker on load, so the site can be installed and receive pushes (11.43). */
export default function ServiceWorker() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
