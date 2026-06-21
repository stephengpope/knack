import { requireUser } from "@/lib/session";
import { getCronView } from "@/lib/cron/view";
import { CronView } from "@/components/cron/cron-view";

export default async function CronPage() {
  const user = await requireUser();
  const groups = await getCronView(user.id);
  return <CronView groups={groups} />;
}
