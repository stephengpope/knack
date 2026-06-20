"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { authClient, signIn } from "@/lib/auth-client";
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

function AcceptForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      toast.error("Invalid or missing invite token");
      return;
    }
    setLoading(true);
    try {
      const reset = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (reset.error) {
        toast.error(reset.error.message ?? "This invite link is invalid or expired");
        return;
      }
      // Sign in, then optionally update the display name.
      if (email) {
        const res = await signIn.email({ email, password });
        if (!res.error) {
          if (name.trim()) await authClient.updateUser({ name: name.trim() });
          toast.success("Welcome to Knack");
          router.push("/");
          router.refresh();
          return;
        }
      }
      toast.success("Password set — sign in to continue");
      router.push("/login");
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
          Set up your account
        </CardTitle>
        <CardDescription>
          Choose your name and a password to finish joining Knack.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="••••••••"
            />
          </div>
        </CardContent>
        <CardFooter className="mt-2">
          <Button
            type="submit"
            disabled={loading}
            className="knack-gradient knack-glow h-11 w-full font-bold text-white"
          >
            {loading ? <Spinner /> : "Create account"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptForm />
    </Suspense>
  );
}
