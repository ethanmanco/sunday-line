// Notifications (11.40): what each kind says and where it goes. Rows are
// written by the database (supabase/migrations/20261130000000_notifications.sql).

import { getSupabase } from "./supabase";
import type { AppNotification } from "../supabase/functions/_shared/notificationText";

export { describe, type AppNotification, type NotificationKind } from "../supabase/functions/_shared/notificationText";

export async function loadNotifications(): Promise<AppNotification[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("notifications")
    .select("*, actor:profiles!notifications_actor_id_fkey(username, display_name), group:groups(short_id)")
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) return null;
  return (data as unknown as AppNotification[]) ?? [];
}

export async function markAllRead(): Promise<void> {
  await getSupabase()?.rpc("mark_notifications_read");
  if (typeof window !== "undefined") window.dispatchEvent(new Event("sl-notifications"));
}
