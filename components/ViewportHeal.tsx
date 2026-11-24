"use client";

import { useEffect } from "react";

/**
 * Installed iPhone app (11.70): coming back to the app after a while, iOS
 * sometimes hands the page a shorter screen than it really has, leaving a black
 * strip at the bottom until the app is closed. When the app is shown again (or a
 * text box closes) and the screen is shorter than its tallest height at this
 * width, hide and show the page once: that makes WebKit measure the screen
 * again. Scroll positions are put back, so nothing moves.
 */
const SETTLE_MS = 150;
const SLACK_PX = 4;

function editing(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

function relayout() {
  const body = document.body;
  const scrolled: [Element, number, number][] = [];
  for (const el of body.querySelectorAll("*")) {
    if (el.scrollTop || el.scrollLeft) scrolled.push([el, el.scrollTop, el.scrollLeft]);
  }
  const page: [number, number] = [window.scrollX, window.scrollY];
  const before = body.style.display;
  body.style.display = "none";
  void body.offsetHeight;
  body.style.display = before;
  void body.offsetHeight;
  for (const [el, top, left] of scrolled) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  window.scrollTo(page[0], page[1]);
}

export default function ViewportHeal() {
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    if (nav.standalone !== true) return;

    // Tallest height seen at each width, so turning the phone is never "too short".
    const tallest = new Map<number, number>();
    const note = () => {
      const w = window.innerWidth;
      tallest.set(w, Math.max(tallest.get(w) ?? 0, window.innerHeight));
    };
    note();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.visibilityState !== "visible" || editing(document.activeElement)) return;
        const max = tallest.get(window.innerWidth) ?? 0;
        if (window.innerHeight < max - SLACK_PX) relayout();
        note();
      }, SETTLE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    window.addEventListener("resize", note);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("focusout", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", note);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("focusout", check);
    };
  }, []);
  return null;
}
