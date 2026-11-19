"use client";

import { use } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import Thread from "@/components/messages/Thread";
import { rememberReturn } from "@/lib/supabase";

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { ready, user } = useAuth();
  if (!ready) return <div className="page narrow"><p>Loading...</p></div>;
  if (!user) {
    return (
      <div className="page narrow">
        <p><Link href="/signin" onClick={() => rememberReturn(`/messages/${id}`)}>Sign in</Link> to see this conversation.</p>
      </div>
    );
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return <div className="page narrow"><p>This conversation isn&apos;t available. <Link href="/messages">Back to messages</Link></p></div>;
  }
  return <Thread conversationId={id} />;
}
