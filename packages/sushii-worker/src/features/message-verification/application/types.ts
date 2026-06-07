export interface AttachmentMetadata {
  filename: string;
  contentType: string | null;
  size: number;
  url?: string;
}

export type ChannelContext =
  | { type: "dm" }
  | { type: "group_dm"; name: string | null; recipients: string[] }
  | {
      type: "guild";
      guildId: string;
      guildName: string | null;
      memberCount: number | null;
      channelName: string | null;
    };

export interface SubmitMessageData {
  messageId: string;
  channelId: string;
  channelContext: ChannelContext | null;
  authorId: string;
  authorUsername: string;
  content: string;
  messageTimestamp: Date;
  attachments: AttachmentMetadata[];
}

export interface NewMessageVerificationData extends SubmitMessageData {
  submitterUserId: string;
}

export interface MessageVerificationRecord extends NewMessageVerificationData {
  code: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertResult {
  code: string;
  isRefresh: boolean;
}

export function isVerificationRefreshed(
  record: Pick<MessageVerificationRecord, "createdAt" | "updatedAt">,
): boolean {
  return record.updatedAt.getTime() !== record.createdAt.getTime();
}
