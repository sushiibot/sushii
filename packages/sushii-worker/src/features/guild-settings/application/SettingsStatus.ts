import type { ScreeningSettingsState } from "@/features/member-screening/application/ScreeningSettingsPort";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type {
  SettingsEditTarget,
  SettingsTab,
} from "../domain/SettingsTargets";

export type ChannelProblem =
  | { kind: "missing_channel" }
  | { kind: "missing_permissions"; permissions: string[] };

export type ChannelHealth = { kind: "ok" } | ChannelProblem;

export type AttentionProblem =
  | ChannelProblem
  | { kind: "no_channel" }
  | { kind: "needs_mod_log" };

export type RowState =
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "not_set" }
  | { kind: "attention"; problem: AttentionProblem };

export interface AttentionItem {
  tab: SettingsTab;
  row: SettingsEditTarget;
  problem: AttentionProblem;
}

export interface SettingsStatus {
  logging: Record<"modlog" | "memberlog" | "msglog" | "reactionlog", RowState>;
  moderation: Record<
    "dm-timeout" | "dm-warn" | "dm-ban" | "dm-kick",
    RowState
  > & {
    lookup: RowState;
  };
  automod: {
    scam: RowState;
    spam: RowState;
    screening: RowState | null;
    exempt: RowState;
    alerts: RowState;
  };
  welcome: Record<"welcome-channel" | "join" | "leave", RowState>;
  attention: AttentionItem[];
  tabAttention: Record<SettingsTab, boolean>;
}

const ON: RowState = { kind: "on" };
const OFF: RowState = { kind: "off" };
const NOT_SET: RowState = { kind: "not_set" };

function onOff(enabled: boolean): RowState {
  return enabled ? ON : OFF;
}

function attention(problem: AttentionProblem): RowState {
  return { kind: "attention", problem };
}

export function computeSettingsStatus(input: {
  config: GuildConfig;
  screening: ScreeningSettingsState | null;
  channelHealth: ReadonlyMap<string, ChannelHealth>;
}): SettingsStatus {
  const { config, screening, channelHealth } = input;
  const logs = config.loggingSettings;
  const mod = config.moderationSettings;
  const msgs = config.messageSettings;

  // A channel missing from the map wasn't checked, so it isn't reported as broken.
  const problemOf = (channelId: string): ChannelProblem | null => {
    const health = channelHealth.get(channelId);
    if (!health || health.kind === "ok") {
      return null;
    }

    return health;
  };

  // Join and leave messages are plain content, so Embed Links doesn't matter there.
  const welcomeProblemOf = (channelId: string): ChannelProblem | null => {
    const problem = problemOf(channelId);
    if (problem?.kind !== "missing_permissions") {
      return problem;
    }

    const permissions = problem.permissions.filter((p) => p !== "Embed Links");
    return permissions.length > 0
      ? { kind: "missing_permissions", permissions }
      : null;
  };

  const logRow = (channelId: string | null, enabled: boolean): RowState => {
    if (!channelId || !enabled) {
      return OFF;
    }

    const problem = problemOf(channelId);
    return problem ? attention(problem) : ON;
  };

  const welcomeMessageRow = (
    enabled: boolean,
    text: string | null,
  ): RowState => {
    if (!enabled || !text?.trim()) {
      return OFF;
    }

    if (!msgs.messageChannel) {
      return attention({ kind: "no_channel" });
    }

    const problem = welcomeProblemOf(msgs.messageChannel);
    return problem ? attention(problem) : ON;
  };

  const channelRow = (
    channelId: string | null,
    check: (channelId: string) => ChannelProblem | null,
  ): RowState => {
    if (!channelId) {
      return NOT_SET;
    }

    const problem = check(channelId);
    return problem ? attention(problem) : ON;
  };

  // Native timeout DMs are sent from the audit log handler, which skips everything without a mod log.
  const timeoutDmRow = (): RowState => {
    const modLogConfigured = !!logs.modLogChannel && logs.modLogEnabled;
    if (mod.timeoutNativeDmEnabled && !modLogConfigured) {
      return attention({ kind: "needs_mod_log" });
    }

    return onOff(mod.timeoutCommandDmEnabled || mod.timeoutNativeDmEnabled);
  };

  const screeningRow = (state: ScreeningSettingsState): RowState => {
    if (state.enabled && state.logChannelId) {
      const problem = problemOf(state.logChannelId);
      if (problem) {
        return attention(problem);
      }
    }

    // Mirrors isScreeningActive (member-screening/domain/isScreeningActive.ts); a
    // non-null state already means the flag is on, but its settings type differs.
    return onOff(state.enabled && state.logChannelId !== null);
  };

  const logging: SettingsStatus["logging"] = {
    modlog: logRow(logs.modLogChannel, logs.modLogEnabled),
    memberlog: logRow(logs.memberLogChannel, logs.memberLogEnabled),
    msglog: logRow(logs.messageLogChannel, logs.messageLogEnabled),
    reactionlog: logRow(logs.reactionLogChannel, logs.reactionLogEnabled),
  };

  const moderation: SettingsStatus["moderation"] = {
    "dm-timeout": timeoutDmRow(),
    "dm-warn": ON,
    "dm-ban": onOff(mod.banDmEnabled),
    "dm-kick": onOff(mod.kickDmEnabled),
    lookup: onOff(mod.lookupDetailsOptIn),
  };

  const automod: SettingsStatus["automod"] = {
    scam: onOff(mod.automodScamImageEnabled),
    spam: onOff(mod.automodSpamEnabled),
    screening: screening ? screeningRow(screening) : null,
    exempt: mod.automodExemptRoleIds.length > 0 ? ON : NOT_SET,
    alerts: channelRow(mod.automodAlertsChannelId, problemOf),
  };

  const welcome: SettingsStatus["welcome"] = {
    "welcome-channel": channelRow(msgs.messageChannel, welcomeProblemOf),
    join: welcomeMessageRow(msgs.joinMessageEnabled, msgs.joinMessage),
    leave: welcomeMessageRow(msgs.leaveMessageEnabled, msgs.leaveMessage),
  };

  const rows: [SettingsTab, SettingsEditTarget, RowState | null][] = [
    ["logging", "modlog", logging.modlog],
    ["logging", "memberlog", logging.memberlog],
    ["logging", "msglog", logging.msglog],
    ["logging", "reactionlog", logging.reactionlog],
    ["moderation", "dm-timeout", moderation["dm-timeout"]],
    ["moderation", "dm-warn", moderation["dm-warn"]],
    ["moderation", "dm-ban", moderation["dm-ban"]],
    ["moderation", "dm-kick", moderation["dm-kick"]],
    ["automod", "screening", automod.screening],
    ["automod", "exempt", automod.exempt],
    ["automod", "alerts", automod.alerts],
    ["welcome", "welcome-channel", welcome["welcome-channel"]],
    ["welcome", "join", welcome.join],
    ["welcome", "leave", welcome.leave],
  ];

  const welcomeChannelUsed =
    welcome.join.kind !== "off" || welcome.leave.kind !== "off";
  const alertsChannelUsed =
    mod.automodScamImageEnabled || mod.automodSpamEnabled;

  const attentionItems: AttentionItem[] = [];
  for (const [tab, row, state] of rows) {
    if (state?.kind !== "attention") {
      continue;
    }

    // Shown on the row only: an unused broken channel, or the default native timeout DM setup.
    if (
      (row === "welcome-channel" && !welcomeChannelUsed) ||
      (row === "alerts" && !alertsChannelUsed) ||
      state.problem.kind === "needs_mod_log"
    ) {
      continue;
    }

    // The welcome-channel row already reports its own channel problem once.
    const sharedChannelProblem =
      (row === "join" || row === "leave") &&
      state.problem.kind !== "no_channel";
    if (!sharedChannelProblem) {
      attentionItems.push({ tab, row, problem: state.problem });
    }
  }

  const tabHas = (tab: SettingsTab): boolean =>
    attentionItems.some((item) => item.tab === tab);

  return {
    logging,
    moderation,
    automod,
    welcome,
    attention: attentionItems,
    tabAttention: {
      overview: attentionItems.length > 0,
      logging: tabHas("logging"),
      moderation: tabHas("moderation"),
      automod: tabHas("automod"),
      welcome: tabHas("welcome"),
    },
  };
}
