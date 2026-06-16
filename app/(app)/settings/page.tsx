import { requireUser } from "@/lib/session";
import { listUserKeys } from "@/lib/api-keys";
import { getUserSettings } from "@/lib/settings";
import { fetchGatewayModels } from "@/lib/gateway-models";
import { listEndpoints } from "@/lib/endpoints";
import { SettingsView } from "@/components/settings/settings-view";

export default async function SettingsPage() {
  const user = await requireUser();
  const [keys, settings, catalog, endpoints] = await Promise.all([
    listUserKeys(user.id),
    getUserSettings(user.id),
    fetchGatewayModels(),
    listEndpoints(user.id),
  ]);
  const last4 = Object.fromEntries(keys.map((k) => [k.provider, k.last4]));

  return (
    <SettingsView
      user={{ name: user.name, email: user.email }}
      last4={last4}
      settings={settings}
      catalog={catalog}
      endpoints={endpoints}
    />
  );
}
