import { DashboardSummary } from "@/domains/dashboard/components/DashboardSummary";
import { getDashboardSummary } from "@/domains/dashboard/services/dashboard.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function DashboardPage() {
  const actor = await getCurrentUser();
  const summary = await getDashboardSummary(actor);

  return <DashboardSummary summary={summary} />;
}
