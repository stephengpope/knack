import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listChats } from "@/lib/chats";
import { Sidebar } from "@/components/app/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const chats = await listChats(session.user.id);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-[14px] text-foreground">
      <Sidebar
        chats={chats}
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
  );
}
