import { db, schema } from "@/lib/db";
import { AuthForm } from "@/components/auth/auth-form";
import { CreateAdminForm } from "@/components/auth/create-admin-form";
import { emailConfigured } from "@/lib/email";

// Always check live — the create-admin form must appear only until the first
// user exists, then never again.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const [[existing], emailEnabled] = await Promise.all([
    db.select({ id: schema.user.id }).from(schema.user).limit(1),
    emailConfigured(),
  ]);

  // Fresh deployment, no users yet → bootstrap the first admin here.
  if (!existing) return <CreateAdminForm />;

  // "Forgot?" only makes sense when email can actually deliver the reset link.
  return <AuthForm showForgot={emailEnabled} />;
}
