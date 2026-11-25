"use client";

import { useEffect } from "react";

/**
 * Something on a page broke (11.81). The map and the bar stay; this panel
 * offers a retry instead of a blank screen.
 */
export default function MapPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="empty" role="alert">
      <p>Something went wrong showing this. Check your connection and try again.</p>
      <p>
        <button type="button" className="chip" onClick={reset}>Try again</button>{" "}
        <a className="chip" href="/">All roads</a>
      </p>
    </div>
  );
}
