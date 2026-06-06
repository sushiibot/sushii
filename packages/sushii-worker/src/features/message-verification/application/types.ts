export interface AttachmentMetadata {
  filename: string;
  contentType: string | null;
  size: number;
}

export interface SubmitMessageData {
  messageId: string;
  channelId: string;
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
