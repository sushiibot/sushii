import type { IpGrabberProviderId } from "@/features/ip-grabber-links/domain/providers";
import type { LogType } from "@/shared/domain/entities/GuildConfig";

export type { LogType };

export type GuildSettingsPatch =
  | { kind: "logChannel"; log: LogType; channelId: string | null }
  | {
      kind: "timeoutDm";
      commandEnabled: boolean;
      nativeEnabled: boolean;
      text: string | null;
    }
  | { kind: "warnDm"; text: string | null }
  | { kind: "banDm"; enabled: boolean; text: string | null }
  | { kind: "kickDm"; enabled: boolean; text: string | null }
  | { kind: "welcomeChannel"; channelId: string | null }
  | { kind: "joinMessage"; enabled: boolean; text: string | null }
  | { kind: "leaveMessage"; enabled: boolean; text: string | null }
  | { kind: "automodExemptRoles"; roleIds: string[] }
  | { kind: "automodAlertsChannel"; channelId: string | null }
  | {
      kind: "flag";
      setting:
        | "lookupOptIn"
        | "automodSpam"
        | "automodScamImage"
        | "sushiiUpdates";
      enabled: boolean;
    };

/** `channelIds` is the full desired set, not a delta. */
export interface MessageLogIgnorePatch {
  kind: "messageLogIgnored";
  channelIds: string[];
}

export interface ScreeningPatch {
  kind: "screening";
  channelId: string | null;
  checkAvatars: boolean;
}

export interface IpGrabberPatch {
  kind: "ipGrabbers";
  ruleId: string | null;
  providers: IpGrabberProviderId[];
}

export type SettingsPatch =
  | GuildSettingsPatch
  | MessageLogIgnorePatch
  | ScreeningPatch
  | IpGrabberPatch;
