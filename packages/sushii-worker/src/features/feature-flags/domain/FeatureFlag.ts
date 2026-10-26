export const FEATURE_FLAGS = ["member_screening"] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export interface FeatureFlagEntry {
  guildId: string;
  flag: FeatureFlag;
  enabledBy: string;
  enabledAt: Date;
}
