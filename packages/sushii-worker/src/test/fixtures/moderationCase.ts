import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

export interface MakeModerationCaseOptions {
  guildId?: string;
  caseId?: string;
  actionType?: ActionType;
  userId?: string;
  userTag?: string;
  executorId?: string | null;
}

export function makeModerationCase(
  options: MakeModerationCaseOptions = {},
): ModerationCase {
  return ModerationCase.create(
    options.guildId ?? "111111111111111111",
    options.caseId ?? "1",
    options.actionType ?? ActionType.Warn,
    options.userId ?? "222222222222222222",
    options.userTag ?? "TestUser#0001",
    options.executorId ?? null,
    null,
  );
}
