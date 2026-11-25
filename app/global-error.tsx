"use client";

/** The whole app broke (11.81): a plain page with a way back, instead of a blank screen. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#14171c", color: "#e8ebef", fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Sunday Line hit a problem</h1>
        <p>Check your connection and try again.</p>
        <p>
          <button type="button" onClick={reset} style={{ padding: "10px 16px", borderRadius: 999, border: 0, background: "#f5a524", color: "#14171c", fontWeight: 600 }}>
            Try again
          </button>{" "}
          <a href="/" style={{ color: "#f5a524", marginLeft: 12 }}>Reload</a>
        </p>
      </body>
    </html>
  );
}
