import type {
  PermissionName,
  PermissionUsage,
  PermissionUsageDetector,
} from "../PermissionUsage";

export interface MessageInput {
  guildId: string;
  authorId: string;
  channelId: string;
  occurredAt: Date;
  /** True for a resolved @everyone or @here, which Discord only grants with Mention Everyone. */
  mentionsEveryone: boolean;
  mentionsNonMentionableRole: boolean;
  tts: boolean;
}

export class MessageUsageDetector
  implements PermissionUsageDetector<MessageInput>
{
  readonly source = "message" as const;

  readonly observes: readonly PermissionName[] = [
    "MentionEveryone",
    "SendTTSMessages",
  ];

  detect(message: MessageInput): PermissionUsage[] {
    const permissions: PermissionName[] = [];

    if (message.mentionsEveryone || message.mentionsNonMentionableRole) {
      permissions.push("MentionEveryone");
    }

    if (message.tts) {
      permissions.push("SendTTSMessages");
    }

    return permissions.map((permission) => ({
      guildId: message.guildId,
      userId: message.authorId,
      permission,
      source: this.source,
      channelId: message.channelId,
      occurredAt: message.occurredAt,
    }));
  }
}
