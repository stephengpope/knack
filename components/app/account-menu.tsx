"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ChevronsUpDown,
  Sun,
  Moon,
  Settings,
  ShieldCheck,
  LifeBuoy,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name: string) {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U"
  );
}

export function AccountMenu({
  user,
}: {
  user: { name: string; email: string; image: string | null; role: string };
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const isAdmin = user.role === "admin";

  async function logout() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="border-t border-border p-3.5">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-accent">
          <Avatar name={user.name} image={user.image} />
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-bold">{user.name}</div>
            <div className="text-xs text-ink-faint">
              {isAdmin ? "Admin" : "Member"}
            </div>
          </div>
          <ChevronsUpDown className="size-4 text-ink-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="w-61"
          sideOffset={8}
        >
          <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
            <Avatar name={user.name} image={user.image} size={38} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">
                {user.name}
              </div>
              <div className="truncate text-xs text-ink-faint">
                {user.email}
              </div>
            </div>
          </DropdownMenuLabel>

          {/* theme toggle */}
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span className="flex-1 text-sm font-semibold">Theme</span>
            <div className="flex rounded-md border border-input bg-muted p-0.5">
              <ThemeBtn
                active={theme !== "dark"}
                onClick={() => setTheme("light")}
              >
                <Sun className="size-3.5" /> Light
              </ThemeBtn>
              <ThemeBtn
                active={theme === "dark"}
                onClick={() => setTheme("dark")}
              >
                <Moon className="size-3.5" /> Dark
              </ThemeBtn>
            </div>
          </div>
          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => router.push("/settings")}>
            <Settings className="size-4" /> User Settings
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem onClick={() => router.push("/administration")}>
              <ShieldCheck className="size-4" /> Administration
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a
              href="https://www.skool.com/ai-architects"
              target="_blank"
              rel="noreferrer"
            >
              <LifeBuoy className="size-4" /> Help & support
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut className="size-4" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Avatar({
  name,
  image,
  size = 36,
}: {
  name: string;
  image: string | null;
  size?: number;
}) {
  if (image) {
    return (
      <Image
        src={image}
        alt={name}
        width={size}
        height={size}
        unoptimized
        className="shrink-0 rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="knack-gradient flex shrink-0 items-center justify-center rounded-lg font-extrabold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(name)}
    </div>
  );
}

function ThemeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs font-bold transition-colors",
        active
          ? "bg-background text-accent-text shadow-sm"
          : "text-ink-soft",
      )}
    >
      {children}
    </button>
  );
}
