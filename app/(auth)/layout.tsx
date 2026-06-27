import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logomark } from "@/components/brand/logo";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (session) redirect("/");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <Logomark size={32} />
        <span className="text-2xl font-extrabold tracking-display">Knack</span>
      </div>
      <div className="w-full max-w-100">{children}</div>
      <p className="mt-8 text-xs text-ink-faint">Your AI agent.</p>
    </div>
  );
}
