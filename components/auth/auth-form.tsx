"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export function AuthForm({ showForgot = true }: { showForgot?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await signIn.email({ email, password });
      if (res.error) {
        toast.error(res.error.message ?? "Something went wrong");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-input shadow-[0_18px_50px_-34px_var(--shadow)]">
      <CardHeader>
        <CardTitle className="font-heading text-2xl font-bold">
          Welcome back
        </CardTitle>
        <CardDescription>Sign in to continue to Knack.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {showForgot && (
                <Link
                  href="/forgot-password"
                  className="text-xs text-accent-text hover:underline"
                >
                  Forgot?
                </Link>
              )}
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
              autoComplete="current-password"
            />
          </div>
        </CardContent>
        <CardFooter className="mt-2">
          <Button
            type="submit"
            disabled={loading}
            className="knack-gradient knack-glow h-11 w-full text-[15px] font-bold text-white"
          >
            {loading ? <Spinner /> : "Sign in"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
