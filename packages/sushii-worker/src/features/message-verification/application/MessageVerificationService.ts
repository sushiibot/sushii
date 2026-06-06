import type { DrizzleMessageVerificationRepository } from "../infrastructure/DrizzleMessageVerificationRepository";
import type {
  MessageVerificationRecord,
  SubmitMessageData,
  UpsertResult,
} from "./types";

export class MessageVerificationService {
  constructor(
    private readonly repository: DrizzleMessageVerificationRepository,
  ) {}

  async submitMessage(
    submitterUserId: string,
    message: SubmitMessageData,
  ): Promise<UpsertResult> {
    return this.repository.upsert({ submitterUserId, ...message });
  }

  async lookupByCode(code: string): Promise<MessageVerificationRecord | null> {
    return this.repository.findByCode(code);
  }
}
