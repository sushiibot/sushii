import { eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { botEmojisInAppPublic } from "@/infrastructure/database/schema";

import type { BotEmojiNameType } from "../domain";
import { BotEmoji } from "../domain/entities/BotEmoji";
import type { BotEmojiRepository } from "../domain/repositories/BotEmojiRepository";
import type { EmojiMap } from "../domain/types";

/**
 * Drizzle implementation of BotEmojiRepository.
 */
export class DrizzleBotEmojiRepository implements BotEmojiRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async getEmojis<T extends readonly BotEmojiNameType[]>(
    names: T,
  ): Promise<EmojiMap<T>> {
    if (names.length === 0) {
      return Object.freeze({}) as EmojiMap<T>;
    }

    // Find only the requested emojis
    const rows = await this.db
      .select()
      .from(botEmojisInAppPublic)
      .where(inArray(botEmojisInAppPublic.name, [...names]));

    const emojiMap = new Map<string, string>();
    for (const row of rows) {
      emojiMap.set(row.name, `<:${row.name}:${row.id}>`);
    }

    // Build the result object with empty strings for missing emojis
    const result = {} as Record<string, string>;
    for (const name of names) {
      result[name] = emojiMap.get(name) || "";
    }

    return Object.freeze(result) as EmojiMap<T>;
  }

  async getEmojiByName(name: BotEmojiNameType): Promise<BotEmoji | null> {
    const rows = await this.db
      .select()
      .from(botEmojisInAppPublic)
      .where(eq(botEmojisInAppPublic.name, name))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return new BotEmoji(
      row.name as BotEmojiNameType,
      row.id,
      row.sha256,
      row.createdAt,
      row.updatedAt,
    );
  }

  async getAllEmojis(): Promise<BotEmoji[]> {
    const rows = await this.db.select().from(botEmojisInAppPublic);

    return rows.map(
      (row) =>
        new BotEmoji(
          row.name as BotEmojiNameType,
          row.id,
          row.sha256,
          row.createdAt,
          row.updatedAt,
        ),
    );
  }

  async saveEmoji(emoji: BotEmoji): Promise<void> {
    await this.db.insert(botEmojisInAppPublic).values({
      name: emoji.name,
      id: emoji.id,
      sha256: emoji.sha256,
      createdAt: emoji.createdAt,
      updatedAt: emoji.updatedAt,
    });
  }

  async updateEmoji(emoji: BotEmoji): Promise<void> {
    await this.db
      .update(botEmojisInAppPublic)
      .set({
        id: emoji.id,
        sha256: emoji.sha256,
        updatedAt: emoji.updatedAt,
      })
      .where(eq(botEmojisInAppPublic.name, emoji.name));
  }

  async deleteEmoji(name: BotEmojiNameType): Promise<void> {
    await this.db
      .delete(botEmojisInAppPublic)
      .where(eq(botEmojisInAppPublic.name, name));
  }

  async exists(name: BotEmojiNameType): Promise<boolean> {
    const rows = await this.db
      .select({ name: botEmojisInAppPublic.name })
      .from(botEmojisInAppPublic)
      .where(eq(botEmojisInAppPublic.name, name))
      .limit(1);

    return rows.length > 0;
  }
}
