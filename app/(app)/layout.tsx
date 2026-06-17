import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listChats } from "@/lib/chats";
import { Sidebar } from "@/components/app/sidebar";
import { ChatStoreProvider } from "@/components/app/chat-store";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const chats = await listChats(session.user.id);

  return (
    <ChatStoreProvider serverChats={chats}>
      <div className="flex h-dvh w-full overflow-hidden bg-background text-[14px] text-foreground">
        <Sidebar
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image ?? null,
            role: (session.user as { role?: string }).role ?? "user",
          }}
        />
        <main className="relative flex min-w-0 flex-1 flex-col bg-background">
          {children}
        </main>
      </div>
    </ChatStoreProvider>
  );
}
