"use client";

import { useEffect, useState } from "react";
import { pushState, turnPushOff, turnPushOn, type PushState } from "@/lib/push";

/** "Notifications on this device" at the top of the notifications page (11.43). */
export default function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);

  async function toggle(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      setState(on ? await turnPushOn() : await turnPushOff());
    } catch {
      setError("Couldn't turn them on. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (state === null || state === "unsupported") return null;
  return (
    <section className="push-box" aria-label="Notifications on this device">
      {state === "on" ? (
        <>
          <p><b>On for this device.</b> You&apos;ll get these as notifications, even with Sunday Line closed.</p>
          <button type="button" className="button ghost small" disabled={busy} onClick={() => toggle(false)}>Turn off</button>
        </>
      ) : state === "off" ? (
        <>
          <p>Get these as notifications on this device, even with Sunday Line closed.</p>
          <button type="button" className="button small" disabled={busy} onClick={() => toggle(true)}>
            {busy ? "Turning on..." : "Turn on notifications"}
          </button>
        </>
      ) : state === "blocked" ? (
        <p className="fine">Notifications are blocked for this site. You can allow them in your browser&apos;s site settings.</p>
      ) : (
        <p className="fine">
          To get notifications on an iPhone or iPad, add Sunday Line to your Home Screen first: tap Share, then Add to
          Home Screen. Then open it from there and come back here.
        </p>
      )}
      {error && <p className="hint warn" role="alert">{error}</p>}
    </section>
  );
}
