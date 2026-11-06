import { fetchView } from "$lib/server/analytics";
import type {
  PromptFunnelRow,
  ProofRow,
  RetentionRow,
  UpdateReachRow,
  UsageRow,
} from "$lib/types";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const [usage, retention, promptFunnel, updateReach, proof] =
    await Promise.all([
      fetchView<UsageRow>("usage_weekly"),
      fetchView<RetentionRow>("retention_weekly"),
      fetchView<PromptFunnelRow>("prompt_funnel_weekly"),
      fetchView<UpdateReachRow>("update_reach"),
      fetchView<ProofRow>("proof_weekly"),
    ]);

  return { usage, retention, promptFunnel, updateReach, proof };
};
