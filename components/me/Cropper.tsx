"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CropRect } from "@/lib/images";

const MAX_ZOOM = 4;

/**
 * Crop a picture to a fixed shape before upload. Drag to move, pinch, scroll,
 * or use the slider to zoom. Arrow keys move and +/- zoom for keyboard users.
 */
export default function Cropper({ file, aspect, round, title, onCancel, onDone }: {
  file: File;
  aspect: number;
  round?: boolean;
  title: string;
  onCancel: () => void;
  onDone: (rect: CropRect) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState({ w: 320, h: 320 / aspect });
  const [zoom, setZoom] = useState(1);
  // Latest zoom, so quick repeated key presses or wheel ticks build on each other.
  const zoomRef = useRef(1);
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    let bm: ImageBitmap | null = null;
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((b) => {
        bm = b;
        setBitmap(b);
        setCenter({ x: b.width / 2, y: b.height / 2 });
      })
      .catch(() => setFailed(true));
    return () => bm?.close();
  }, [file]);

  // Fit the frame to the dialog width.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setSize({ w, h: w / aspect });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // Scale that makes the picture just cover the frame, times the zoom.
  const scale = bitmap ? Math.max(size.w / bitmap.width, size.h / bitmap.height) * zoom : 1;

  const clamp = useCallback(
    (c: { x: number; y: number }, s = scale) => {
      if (!bitmap) return c;
      const hw = size.w / s / 2;
      const hh = size.h / s / 2;
      return {
        x: Math.min(Math.max(c.x, hw), bitmap.width - hw),
        y: Math.min(Math.max(c.y, hh), bitmap.height - hh),
      };
    },
    [bitmap, size, scale],
  );

  const rect = useCallback((): CropRect | null => {
    if (!bitmap) return null;
    const c = clamp(center);
    const sw = size.w / scale;
    const sh = size.h / scale;
    return { sx: c.x - sw / 2, sy: c.y - sh / 2, sw, sh };
  }, [bitmap, center, clamp, size, scale]);

  // Draw.
  useEffect(() => {
    const cv = canvas.current;
    const r = rect();
    if (!cv || !bitmap || !r) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, cv.width, cv.height);
  }, [bitmap, rect, size]);

  function setZoomKeepingCenter(z: number) {
    const nz = Math.min(Math.max(z, 1), MAX_ZOOM);
    if (!bitmap) return;
    const ns = Math.max(size.w / bitmap.width, size.h / bitmap.height) * nz;
    zoomRef.current = nz;
    setZoom(nz);
    setCenter((c) => clamp(c, ns));
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoomKeepingCenter((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.dist);
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setCenter((c) => clamp({ x: c.x - dx / scale, y: c.y - dy / scale }));
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = 20 / scale;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setCenter((c) => clamp({ x: c.x + dx, y: c.y + dy }));
    } else if (e.key === "+" || e.key === "=") {
      setZoomKeepingCenter(zoomRef.current * 1.15);
    } else if (e.key === "-") {
      setZoomKeepingCenter(zoomRef.current / 1.15);
    }
  }

  // Scroll to zoom (needs a non-passive listener to stop the page scrolling).
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoomKeepingCenter(zoomRef.current * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  });

  return (
    <dialog ref={dialog} className="cropper" aria-labelledby="crop-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="crop-title">{title}</h2>
      {failed ? (
        <p className="hint warn" role="alert">Couldn&apos;t read that picture. Try another one.</p>
      ) : (
        <>
          <div ref={frame} className={`crop-frame${round ? " round" : ""}`} style={{ height: size.h }}>
            <canvas
              ref={canvas}
              tabIndex={0}
              aria-label="Picture to crop. Drag or use the arrow keys to move it, plus and minus to zoom."
              style={{ width: size.w, height: size.h }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
            />
            {round && <div className="crop-ring" aria-hidden="true" />}
          </div>
          <label className="crop-zoom">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoomKeepingCenter(Number(e.target.value))}
            />
          </label>
          <p className="fine">Drag to move. Pinch, scroll, or use the slider to zoom.</p>
        </>
      )}
      <div className="row">
        <button type="button" className="button" disabled={!bitmap} onClick={() => { const r = rect(); if (r) onDone(r); }}>
          Use this
        </button>
        <button type="button" className="button ghost" onClick={onCancel}>Cancel</button>
      </div>
    </dialog>
  );
}
