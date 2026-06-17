import { requireUser } from "@/lib/session";
import { SettingsView } from "@/components/settings/settings-view";
import { listSecrets } from "@/lib/user-secrets";
import { PROVIDER_PRESETS, oauthRedirectUri } from "@/lib/oauth/providers";

export default async function SettingsPage() {
  const user = await requireUser();
  const [secrets, redirectUri] = await Promise.all([
    listSecrets(user.id),
    oauthRedirectUri(),
  ]);
  const providers = PROVIDER_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    defaultScopes: p.defaultScopes,
    custom: !!p.custom,
    hint: p.hint ?? null,
  }));

  return (
    <SettingsView
      name={user.name}
      email={user.email}
      secrets={secrets}
      redirectUri={redirectUri}
      providers={providers}
    />
  );
}
