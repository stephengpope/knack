import { requireAdmin } from "@/lib/session";
import { listKeys } from "@/lib/api-keys";
import { getAppSettings } from "@/lib/settings";
import { getAvailableModels } from "@/lib/available-models";
import { listEndpoints } from "@/lib/endpoints";
import { AdministrationView } from "@/components/administration/administration-view";

export default async function AdministrationPage() {
  // Admin-only: regular users are redirected to "/".
  const admin = await requireAdmin();
  const [keys, settings, available, endpoints] = await Promise.all([
    listKeys(),
    getAppSettings(),
    getAvailableModels(), // mode-aware: gateway catalog, provider lists, or endpoints
    listEndpoints(),
  ]);
  const catalog = available.models;
  const last4 = Object.fromEntries(keys.map((k) => [k.provider, k.last4]));

  return (
    <AdministrationView
      last4={last4}
      settings={settings}
      catalog={catalog}
      endpoints={endpoints}
      currentUserId={admin.id}
    />
  );
}
