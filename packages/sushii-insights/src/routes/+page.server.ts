import { fetchView } from "$lib/server/analytics";
import type {
  CommandUsageRow,
  DailyUsageRow,
  PromptFunnelRow,
  ProofRow,
  RetentionRow,
  ServerActivityRow,
  UpdateReachRow,
  UsageRow,
} from "$lib/types";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const [
    usage,
    currentWeek,
    daily,
    commands,
    serverActivity,
    retention,
    promptFunnel,
    updateReach,
    proof,
  ] = await Promise.all([
    fetchView<UsageRow>("usage_weekly"),
    fetchView<UsageRow>("usage_current_week"),
    fetchView<DailyUsageRow>("usage_daily"),
    fetchView<CommandUsageRow>("command_usage"),
    fetchView<ServerActivityRow>("server_activity"),
    fetchView<RetentionRow>("retention_weekly"),
    fetchView<PromptFunnelRow>("prompt_funnel_weekly"),
    fetchView<UpdateReachRow>("update_reach"),
    fetchView<ProofRow>("proof_weekly"),
  ]);

  return {
    usage,
    currentWeek,
    daily,
    commands,
    serverActivity,
    retention,
    promptFunnel,
    updateReach,
    proof,
    generatedAt: new Date().toISOString(),
  };
};
