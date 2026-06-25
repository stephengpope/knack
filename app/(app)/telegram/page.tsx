import { requireUser } from "@/lib/session";
import { getTelegramAccount } from "@/lib/telegram-account";
import { getAppSettings } from "@/lib/settings";
import { TelegramView } from "@/components/telegram/telegram-view";

export default async function TelegramPage() {
  const user = await requireUser();
  const [account, settings] = await Promise.all([
    getTelegramAccount(user.id),
    getAppSettings(),
  ]);
  return (
    <TelegramView account={account} voiceConfigured={settings.voiceConfigured} />
  );
}
