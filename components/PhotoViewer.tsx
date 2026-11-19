"use client";

import { useEffect, useRef, useState } from "react";

interface Photo {
  src: string;
  alt: string;
}

/** Open a photo full screen, over everything. */
export function openPhoto(src: string, alt = "Photo") {
  window.dispatchEvent(new CustomEvent<Photo>("sl-photo", { detail: { src, alt } }));
}

/** The full-screen photo viewer, mounted once for the whole site. */
export default function PhotoViewer() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      opener.current = document.activeElement;
      setPhoto((e as CustomEvent<Photo>).detail);
    };
    window.addEventListener("sl-photo", onOpen);
    return () => window.removeEventListener("sl-photo", onOpen);
  }, []);

  useEffect(() => {
    if (!photo) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPhoto(null);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [photo]);

  if (!photo) return null;
  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={photo.alt} onClick={() => setPhoto(null)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.src} alt={photo.alt} onClick={(e) => e.stopPropagation()} />
      <button ref={closeBtn} type="button" className="photo-close" aria-label="Close photo" onClick={() => setPhoto(null)}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}
