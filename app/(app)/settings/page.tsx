import { requireUser } from "@/lib/session";
import { SettingsView } from "@/components/settings/settings-view";
import { secretsList } from "@/lib/user-secrets";
import { getGithubAccount } from "@/lib/github-account";
import { listProjects } from "@/lib/projects";
import { PROVIDER_PRESETS, oauthRedirectUri } from "@/lib/oauth/providers";

export default async function SettingsPage() {
  const user = await requireUser();
  const [secrets, redirectUri, githubAccount, projects] = await Promise.all([
    secretsList(user.id),
    oauthRedirectUri(),
    getGithubAccount(user.id),
    listProjects(user.id),
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
      githubAccount={githubAccount}
      projects={projects}
    />
  );
}
