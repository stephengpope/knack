"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      setSent(true);
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-input shadow-[0_18px_50px_-34px_var(--shadow)]">
      <CardHeader>
        <CardTitle className="font-heading text-2xl font-medium">
          Reset password
        </CardTitle>
        <CardDescription>
          {sent
            ? "If an account exists for that email, a reset link is on its way."
            : "Enter your email and we'll send you a reset link."}
        </CardDescription>
      </CardHeader>
      {!sent && (
        <form onSubmit={onSubmit}>
          <CardContent>
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
          </CardContent>
          <CardFooter className="mt-2 flex flex-col gap-4">
            <Button
              type="submit"
              disabled={loading}
              className="knack-gradient knack-glow h-11 w-full font-bold text-white"
            >
              {loading ? <Spinner /> : "Send reset link"}
            </Button>
          </CardFooter>
        </form>
      )}
      <CardFooter>
        <Link
          href="/login"
          className="mx-auto text-sm font-semibold text-accent-text hover:underline"
        >
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
