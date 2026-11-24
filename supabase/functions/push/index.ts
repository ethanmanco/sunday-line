// Web push sender (11.43). The database calls this (pg_net) with a new
// notification's id; it sends that notification to the member's devices.
//
// No secret is needed to call it: it only ever sends real notifications that
// haven't been pushed yet, to the member they belong to, and claims each one
// so it goes out once. It reaches the database only through two functions
// (claim_push, drop_push_device) that only the service role may run.
// Secrets (set with `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   the site's push keys
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { describe, pushText, type AppNotification } from "../_shared/notificationText.ts";

const SITE = "https://sundayline.app";

interface Device {
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return new Response("bad request", { status: 400 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Claim it: only fresh, unsent, unread notifications go out, and only once.
  const { data: n, error } = await sb.rpc("claim_push", { p_id: id });
  if (error) console.error("push: claim failed", error.message);
  if (!n) return new Response("nothing to send");
  const devices = (n.devices ?? []) as Device[];
  if (!devices.length) return new Response("no devices");

  const note = n as AppNotification & { user_id: string };
  const { href } = describe(note, () => "a road");

  // Messages and mentions show the start of the latest message (11.76). The
  // notification exists only if the member may read that chat.
  let said: { body: string | null; photo: boolean } | null = null;
  if ((note.kind === "message" || note.kind === "mention") && note.conversation_id && note.actor_id) {
    const { data: m } = await sb.from("messages").select("body, media_path")
      .eq("conversation_id", note.conversation_id).eq("sender_id", note.actor_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (m) said = { body: m.body, photo: Boolean(m.media_path) };
  }
  const { title, body: text } = pushText(note, () => "A road", said);

  // The number on the app icon: unread notifications, like the bell.
  const { count } = await sb.from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", note.user_id).is("read_at", null);

  const payload = JSON.stringify({
    title: title || "Sunday Line",
    body: text,
    badge: count ?? undefined,
    url: `${SITE}${href}`,
    // One notification per chat on the device; others stand alone.
    tag: note.kind === "message" && note.conversation_id ? `chat-${note.conversation_id}` : note.id,
  });

  webpush.setVapidDetails(SITE, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  let sent = 0;
  for (const d of devices) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // The device unsubscribed or the browser dropped it: forget it.
      if (code === 404 || code === 410) await sb.rpc("drop_push_device", { p_endpoint: d.endpoint });
      else console.error("push: send failed", code ?? (e as Error).message);
    }
  }
  return new Response(`sent ${sent} of ${devices.length}`);
});
