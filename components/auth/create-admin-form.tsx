"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signIn } from "@/lib/auth-client";
import { createFirstAdmin } from "@/app/(auth)/login/actions";
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

/**
 * Shown on `/login` only when the deployment has no users yet. Creates the
 * first admin and signs them in. After this, `/login` reverts to the normal
 * invite-only sign-in form.
 */
export function CreateAdminForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await createFirstAdmin({ email, password, name });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const signedIn = await signIn.email({ email, password });
      if (signedIn.error) {
        toast.success("Admin created — sign in to continue.");
        router.push("/login");
        router.refresh();
        return;
      }
      toast.success("Welcome to Knack");
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
          Set up Knack
        </CardTitle>
        <CardDescription>
          Create the first admin account to finish setting up your deployment.
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
        </CardContent>
        <CardFooter className="mt-2">
          <Button
            type="submit"
            disabled={loading}
            className="knack-gradient knack-glow h-11 w-full text-[15px] font-bold text-white"
          >
            {loading ? <Spinner /> : "Create admin account"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
