import { requireAdmin } from "@/lib/session";
import { listKeys } from "@/lib/api-keys";
import { getAppSettings } from "@/lib/settings";
import { fetchGatewayModels } from "@/lib/gateway-models";
import { listEndpoints } from "@/lib/endpoints";
import { AdministrationView } from "@/components/administration/administration-view";

export default async function AdministrationPage() {
  // Admin-only: regular users are redirected to "/".
  const admin = await requireAdmin();
  const [keys, settings, catalog, endpoints] = await Promise.all([
    listKeys(),
    getAppSettings(),
    fetchGatewayModels(),
    listEndpoints(),
  ]);
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
