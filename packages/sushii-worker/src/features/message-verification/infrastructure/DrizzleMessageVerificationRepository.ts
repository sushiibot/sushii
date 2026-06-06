import { DatabaseError } from "pg";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";

import type {
  AttachmentMetadata,
  MessageVerificationRecord,
  NewMessageVerificationData,
  UpsertResult,
} from "../application/types";
import { isVerificationRefreshed } from "../application/types";

type DbType = NodePgDatabase<typeof schema>;

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;
const MAX_RETRIES = 5;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function isCodePkViolation(err: unknown): boolean {
  return (
    err instanceof DatabaseError &&
    err.code === "23505" &&
    err.constraint === "message_verifications_pkey"
  );
}

export class DrizzleMessageVerificationRepository {
  constructor(private readonly db: DbType) {}

  async upsert(data: NewMessageVerificationData): Promise<UpsertResult> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const code = generateCode();

      try {
        const result = await this.db
          .insert(schema.messageVerificationsInAppPublic)
          .values({
            code,
            submitterUserId: data.submitterUserId,
            messageId: data.messageId,
            channelId: data.channelId,
            channelContext: data.channelContext,
            authorId: data.authorId,
            authorUsername: data.authorUsername,
            content: data.content,
            messageTimestamp: data.messageTimestamp,
            attachments: data.attachments,
          })
          .onConflictDoUpdate({
            target: [
              schema.messageVerificationsInAppPublic.submitterUserId,
              schema.messageVerificationsInAppPublic.messageId,
            ],
            set: {
              channelId: data.channelId,
              channelContext: data.channelContext,
              authorId: data.authorId,
              authorUsername: data.authorUsername,
              content: data.content,
              messageTimestamp: data.messageTimestamp,
              attachments: data.attachments,
              updatedAt: sql`now()`,
            },
          })
          .returning({
            code: schema.messageVerificationsInAppPublic.code,
            createdAt: schema.messageVerificationsInAppPublic.createdAt,
            updatedAt: schema.messageVerificationsInAppPublic.updatedAt,
          });

        const row = result[0];
        if (!row) {
          throw new Error("Upsert returned no rows");
        }

        const isRefresh = isVerificationRefreshed(row);

        return { code: row.code, isRefresh };
      } catch (err) {
        if (isCodePkViolation(err) && attempt < MAX_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }

    throw new Error("Failed to generate unique verification code after max retries");
  }

  async findByCode(code: string): Promise<MessageVerificationRecord | null> {
    const result = await this.db
      .select()
      .from(schema.messageVerificationsInAppPublic)
      .where(eq(schema.messageVerificationsInAppPublic.code, code))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];
    return {
      code: row.code,
      submitterUserId: row.submitterUserId,
      messageId: row.messageId,
      channelId: row.channelId,
      channelContext: row.channelContext ?? null,
      authorId: row.authorId,
      authorUsername: row.authorUsername,
      content: row.content,
      messageTimestamp: row.messageTimestamp,
      attachments: row.attachments as AttachmentMetadata[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
