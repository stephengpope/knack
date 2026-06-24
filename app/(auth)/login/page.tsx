import { db, schema } from "@/lib/db";
import { AuthForm } from "@/components/auth/auth-form";
import { CreateAdminForm } from "@/components/auth/create-admin-form";

// Always check live — the create-admin form must appear only until the first
// user exists, then never again.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .limit(1);

  // Fresh deployment, no users yet → bootstrap the first admin here.
  if (!existing) return <CreateAdminForm />;

  return <AuthForm />;
}
