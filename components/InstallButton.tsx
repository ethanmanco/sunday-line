"use client";

import { useEffect, useRef, useState } from "react";

/** Chrome's install prompt event (not in the TypeScript DOM types yet). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/**
 * A download button in the top bar of the mobile website (11.46): Android opens
 * the browser's install prompt; iPhone, where a site can't start the install,
 * shows the three steps. Hidden in the installed app and on desktop.
 */
export default function InstallButton() {
  const [mode, setMode] = useState<"android" | "ios" | null>(null);
  const [steps, setSteps] = useState(false);
  const prompt = useRef<InstallPromptEvent | null>(null);

  useEffect(() => {
    const phone = window.matchMedia("(pointer: coarse) and (max-width: 899px)").matches;
    if (!phone || standalone()) return;
    if (isIos()) {
      setMode("ios");
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      prompt.current = e as InstallPromptEvent;
      setMode("android");
    };
    const onInstalled = () => setMode(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSteps(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps]);

  if (!mode) return null;

  async function install() {
    if (mode === "ios") return setSteps(true);
    const p = prompt.current;
    if (!p) return;
    await p.prompt();
    const { outcome } = await p.userChoice;
    prompt.current = null;
    if (outcome === "accepted") setMode(null);
  }

  return (
    <>
      <button type="button" className="install-button" aria-label="Add Sunday Line to your home screen" onClick={install}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 4v11M7 10.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 19.5h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {steps && (
        <div className="install-steps-backdrop" onClick={() => setSteps(false)}>
          <section className="install-steps" role="dialog" aria-modal="true" aria-label="Add Sunday Line to your Home Screen" onClick={(e) => e.stopPropagation()}>
            <h2>Add to your Home Screen</h2>
            <ol>
              <li>
                Tap Share{" "}
                <svg viewBox="0 0 24 24" width="18" height="18" aria-label="(the square with an arrow)" role="img">
                  <path d="M12 3v12M8 7l4-4 4 4M6 11v9h12v-9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>{" "}
                in Safari&apos;s toolbar.
              </li>
              <li>Choose <b>Add to Home Screen</b>. You may need to scroll the list down.</li>
              <li>Keep <b>Open as Web App</b> on, then tap <b>Add</b>.</li>
            </ol>
            <p className="fine">Then open Sunday Line from your Home Screen and sign in with the emailed code.</p>
            <button type="button" className="button" onClick={() => setSteps(false)}>Got it</button>
          </section>
        </div>
      )}
    </>
  );
}
