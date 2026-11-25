// Web push on this device (11.43): register the service worker, and turn
// phone or desktop notifications on and off.

import { VAPID_PUBLIC_KEY } from "./config";
import { getSupabase } from "./supabase";

export type PushState =
  | "unsupported" // this browser can't do web push
  | "ios-install" // iPhone or iPad: works only once added to the Home Screen
  | "blocked" // the person said no in the browser; only browser settings can undo it
  | "off"
  | "on";

/** Register the service worker (installable app, push). Safe to call more than once. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  // In development the app's file names stay the same as they change, so the
  // worker keeps no copies there (11.83).
  return navigator.serviceWorker.register(process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1").catch(() => null);
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIos() && !standalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask the browser, subscribe, and save this device. Returns the new state. */
export async function turnPushOn(): Promise<PushState> {
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  if (!reg) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const json = sub.toJSON();
  const { error } = (await getSupabase()?.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  })) ?? { error: new Error("no database") };
  if (error) {
    await sub.unsubscribe().catch(() => {});
    throw error;
  }
  return "on";
}

/** Stop pushes to this device (also used when signing out). */
export async function turnPushOff(): Promise<PushState> {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await getSupabase()?.rpc("remove_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}
