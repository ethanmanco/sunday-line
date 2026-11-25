"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import PlaceSearch from "./PlaceSearch";
import Avatar from "./Avatar";
import { useAuth } from "./AuthProvider";
import { useMapShell } from "@/lib/mapShell";
import { accountsEnabled } from "@/lib/supabase";
import { countLabel, useUnreadMessages, useUnreadNotifications } from "@/lib/useUnread";
import { useSiteAdmin } from "@/lib/useSiteAdmin";
import type { View } from "@/lib/roads";

const VIEW_PILLS: { key: View; label: string }[] = [
  { key: "drivers", label: "Driver's roads" },
  { key: "scenic", label: "Scenic" },
  { key: "gravel", label: "Gravel" },
  { key: "bounties", label: "Bounties" },
];

/**
 * The installed phone app's top (11.51), in place of the top bar: the map runs
 * up under the status bar like Google Maps, with a floating search, a messages
 * button and your avatar (notification count on it, like Instagram), and the
 * road lists as pills. Everything else is in the menu under your avatar.
 * CSS shows it only in the installed app in portrait (html.app-on, set in the
 * layout before the first paint; ?app=1 tries it in a phone browser, ?app=0 stops).
 */
export default function AppBar({ home, children }: { home: boolean; children?: React.ReactNode }) {
  const shell = useMapShell();
  const { ready, user, profile } = useAuth();
  const pathname = usePathname();
  const messages = useUnreadMessages();
  const notes = useUnreadNotifications();
  const [menu, setMenu] = useState(false);
  const youButton = useRef<HTMLButtonElement>(null);
  // Stable, so the open menu doesn't re-grab focus on every map move; focus
  // goes back to the button that opened it (11.82).
  const closeMenu = useCallback(() => {
    setMenu(false);
    youButton.current?.focus();
  }, []);
  const signedIn = accountsEnabled && ready && !!user && !!profile;

  // A new page closes the menu.
  useEffect(() => setMenu(false), [pathname]);

  const view = shell?.filters.view;
  const pill = usePillGestures((key) => {
    if (!shell) return;
    shell.setShowRoads(true);
    shell.setFilters({ ...shell.filters, view: key });
  }, () => {
    if (shell?.isSheet) shell.setSheet("full");
  });
  return (
    <div className="app-bar">
      <div className="app-bar-row">
        <div className="app-search">
          <Link
            href="/"
            className="app-home"
            aria-label="Sunday Line home"
            onClick={(e) => {
              const el = e.currentTarget;
              setTimeout(() => el.blur(), 150);
              if (pathname === "/") {
                e.preventDefault();
                window.dispatchEvent(new Event("sl-home"));
              }
            }}
          >
            <span className="brand-mark" aria-hidden="true" />
          </Link>
          <PlaceSearch />
        </div>
        {signedIn && (
          <Link href="/messages" className="app-round" aria-label={messages ? `Messages, ${messages} unread` : "Messages"}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            {messages > 0 && <span className="app-count" aria-hidden="true">{countLabel(messages)}</span>}
          </Link>
        )}
        <button
          ref={youButton}
          type="button"
          className="app-round app-you"
          aria-expanded={menu}
          aria-label={signedIn ? (notes ? `You, ${notes} new notifications` : "You") : "Menu"}
          onClick={() => {
            // The road list tucks away so the menu isn't on top of it (11.89).
            if (!menu && home && shell?.isSheet && shell.sheet !== "closed") shell.setSheet("closed");
            setMenu(!menu);
          }}
        >
          {signedIn ? (
            <Avatar person={profile!} size={40} />
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          {notes > 0 && <span className="app-count" aria-hidden="true">{countLabel(notes)}</span>}
        </button>
      </div>
      <div className="app-pills">
        {home && shell && VIEW_PILLS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="map-chip"
            aria-pressed={shell.showRoads && view === p.key}
            {...pill(p.key)}
          >
            {p.label}
          </button>
        ))}
        {children}
      </div>
      {menu && <YouMenu signedIn={signedIn} notes={notes} onClose={closeMenu} />}
    </div>
  );
}

/**
 * The road list pills (11.90): a tap picks the list, as before, with no wait.
 * A second tap on the same pill soon after, or holding it for half a second,
 * also opens the list. Moving the finger (scrolling the pills) cancels a hold.
 */
function usePillGestures(pick: (key: View) => void, openList: () => void) {
  const lastTap = useRef<{ key: View; at: number } | null>(null);
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const stopHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  useEffect(() => stopHold, []);

  return (key: View) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      stopHold();
      const h = { x: e.clientX, y: e.clientY, fired: false, timer: 0 };
      h.timer = window.setTimeout(() => {
        h.fired = true;
        pick(key);
        openList();
      }, 500);
      hold.current = h;
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = hold.current;
      if (h && !h.fired && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) stopHold();
    },
    onPointerUp: stopHold,
    onPointerCancel: stopHold,
    onPointerLeave: stopHold,
    // A long press on a phone would otherwise bring up the copy menu.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (hold.current?.fired) {
        hold.current = null;
        lastTap.current = null;
        return;
      }
      const now = Date.now();
      const again = lastTap.current?.key === key && now - lastTap.current.at < 350;
      pick(key);
      if (again) {
        openList();
        lastTap.current = null;
      } else {
        lastTap.current = { key, at: now };
      }
    },
  });
}

function YouMenu({ signedIn, notes, onClose }: { signedIn: boolean; notes: number; onClose: () => void }) {
  const { profile } = useAuth();
  const admin = useSiteAdmin();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const row = (href: string, label: string, icon: React.ReactNode, count = 0) => (
    <Link href={href} className="you-row" onClick={onClose}>
      {icon}
      <span>{label}</span>
      {count > 0 && <span className="badge">{countLabel(count)}</span>}
    </Link>
  );
  const svg = (d: React.ReactNode) => (
    <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  );

  return (
    <>
      <button type="button" className="you-scrim" aria-label="Close the menu" onClick={onClose} />
      <div className="you-menu" ref={box} role="dialog" aria-label={signedIn ? "You" : "Menu"}>
        {signedIn && profile && (
          <>
            <div className="you-head">
              <Avatar person={profile} size={48} />
              <div>
                <b>{profile.display_name}</b>
                <span className="fine">@{profile.username}</span>
              </div>
            </div>
            <div className="you-buttons">
              <Link href={`/u/${profile.username}`} className="button" onClick={onClose}>Your profile</Link>
              <Link href="/me" className="button ghost" onClick={onClose}>Edit profile</Link>
            </div>
            {row("/notifications", "Notifications", svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>), notes)}
            {row("/spots", "Your spots", svg(<><path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></>))}
            {admin && row("/admin/stats", "Site stats", svg(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>))}
          </>
        )}
        {row("/groups", "Groups", svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="8.5" r="2.6" /><path d="M17 13.6c2.4.3 4 2.1 4 4.9" /></>))}
        {row("/people", "People", svg(<><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6" /></>))}
        {row("/about", "About and map credits", svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>))}
        {!signedIn && accountsEnabled && (
          <div className="you-buttons">
            <Link href="/signin" className="button" onClick={onClose}>Sign in</Link>
          </div>
        )}
      </div>
    </>
  );
}
