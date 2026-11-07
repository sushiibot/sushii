import { fetchView } from "$lib/server/analytics";
import type {
  CommandUsageRow,
  DailyUsageRow,
  FeatureAudienceRow,
  FeaturePartRow,
  PromptOutcomeRow,
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
    promptOutcomes,
    updateReach,
    proof,
    featureParts,
    featureAudience,
  ] = await Promise.all([
    fetchView<UsageRow>("usage_weekly"),
    fetchView<UsageRow>("usage_current_week"),
    fetchView<DailyUsageRow>("usage_daily"),
    fetchView<CommandUsageRow>("command_usage"),
    fetchView<ServerActivityRow>("server_activity"),
    fetchView<RetentionRow>("retention_weekly"),
    fetchView<PromptOutcomeRow>("prompt_outcomes"),
    fetchView<UpdateReachRow>("update_reach"),
    fetchView<ProofRow>("proof_weekly"),
    fetchView<FeaturePartRow>("feature_parts"),
    fetchView<FeatureAudienceRow>("feature_audience"),
  ]);

  return {
    usage,
    currentWeek,
    daily,
    commands,
    serverActivity,
    retention,
    promptOutcomes,
    updateReach,
    proof,
    featureParts,
    featureAudience,
    generatedAt: new Date().toISOString(),
  };
};
