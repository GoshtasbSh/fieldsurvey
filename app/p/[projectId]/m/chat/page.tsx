import { assertSurfaceAllowed } from "@/lib/mobile/role-gate";
import { listChatMessages, listProjectMembers } from "@/lib/queries/chat";
import { createServerSupabase } from "@/lib/supabase/server";
import { ChatPanel } from "@/components/chat/chat-panel";

/**
 * Mobile Chat tab — reuses the cross-shell ChatPanel that the desktop
 * Team tab uses. Admin + member get the full read/write experience.
 * Guest gets a friendly placeholder explaining that chat will be
 * available once they convert to a member account (the existing chat
 * pipeline is gated on a Supabase user_id; the guest read-only mode is
 * a follow-up).
 */
export default async function MobileChatPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const role = await assertSurfaceAllowed(projectId, "chat");

  if (role === "guest") {
    return <GuestChatPlaceholder />;
  }

  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return <GuestChatPlaceholder />;
  }

  const [initial, members] = await Promise.all([
    listChatMessages(projectId, 200),
    listProjectMembers(projectId),
  ]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--m-bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ChatPanel
        projectId={projectId}
        currentUserId={user.id}
        members={members}
        initial={initial}
        canWrite
      />
    </div>
  );
}

function GuestChatPlaceholder() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: 32,
        textAlign: "center",
        color: "var(--m-ink-2)",
        background: "var(--m-bg)",
      }}
    >
      <div style={{ maxWidth: 280 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--m-accent)",
            marginBottom: 8,
          }}
        >
          Guest mode
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--m-ink)" }}>
          Chat is available once you have a member account.
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.5, marginTop: 10 }}>
          For now, keep adding points and use the <b>Report</b> tab to send
          a message to the project admins.
        </p>
      </div>
    </div>
  );
}
