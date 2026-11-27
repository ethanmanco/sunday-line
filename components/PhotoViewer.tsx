"use client";

import { useEffect, useRef, useState } from "react";

export interface Photo {
  src: string;
  alt: string;
  /** Shown under the photo (11.93). */
  caption?: string | null;
}

/** Open a photo full screen, over everything. */
export function openPhoto(src: string, alt = "Photo") {
  openPhotos([{ src, alt }], 0);
}

/** Open a set of photos full screen at one of them; arrows and the arrow keys move through the set (11.45). */
export function openPhotos(photos: Photo[], index = 0) {
  if (!photos.length) return;
  window.dispatchEvent(new CustomEvent<{ photos: Photo[]; index: number }>("sl-photo", { detail: { photos, index } }));
}

/** The full-screen photo viewer, mounted once for the whole site. */
export default function PhotoViewer() {
  const [set, setSet] = useState<{ photos: Photo[]; index: number } | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      opener.current = document.activeElement;
      setSet((e as CustomEvent<{ photos: Photo[]; index: number }>).detail);
    };
    window.addEventListener("sl-photo", onOpen);
    return () => window.removeEventListener("sl-photo", onOpen);
  }, []);

  const open = set !== null;
  const count = set?.photos.length ?? 0;
  const step = (d: number) => setSet((s) => (s ? { ...s, index: (s.index + d + s.photos.length) % s.photos.length } : s));

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSet(null);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (!set) return null;
  const photo = set.photos[set.index];
  return (
    <div
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={photo.alt}
      onClick={() => setSet(null)}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null || count < 2) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.src} alt={photo.alt} onClick={(e) => e.stopPropagation()} />
      {photo.caption && <p className={`photo-caption${count > 1 ? " above-count" : ""}`} onClick={(e) => e.stopPropagation()}>{photo.caption}</p>}
      <button ref={closeBtn} type="button" className="photo-close" aria-label="Close photo" onClick={() => setSet(null)}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
      </button>
      {count > 1 && (
        <>
          <button type="button" className="photo-step prev" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); step(-1); }}>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button type="button" className="photo-step next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1); }}>
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span className="photo-position" aria-live="polite">{set.index + 1} / {count}</span>
        </>
      )}
    </div>
  );
}
