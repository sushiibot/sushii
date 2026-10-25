import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";

import {
  REP_INCREMENT,
  SOCIAL_COOLDOWN_HOURS,
  calculateStreak,
  rollRepAmount,
} from "../domain";
import type { FishyResult, RepResult } from "../domain";
import type { Collectible } from "../domain/collection/Catalog";
import {
  fishingCondition,
  rollPayout,
  selectCollectible,
} from "../domain/collection/Catalog";
import type { FishyCollectionRepository } from "../domain/repositories/FishyCollectionRepository";

const users = schema.usersInAppPublic;
const collection = schema.userFishyCollection;
const results = schema.fishyInteractionResults;
type Transaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

export class DrizzleFishyCollectionRepository
  implements FishyCollectionRepository
{
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly roll: (item: Collectible) => number = rollPayout,
  ) {}

  private async lockUsers(
    tx: Transaction,
    invokerId: string,
    targetId: string,
  ) {
    const ids = [...new Set([invokerId, targetId])]
      .map(BigInt)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // Inserts and locks use the same order, including first-time reciprocal gifts.
    const rows = new Map<string, typeof users.$inferSelect>();
    for (const id of ids) {
      await tx.insert(users).values({ id }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(users)
        .where(eq(users.id, id))
        .for("update");
      rows.set(id.toString(), row);
    }
    const invoker = rows.get(invokerId);
    const target = rows.get(targetId);
    if (!invoker || !target) throw new Error("Could not lock social user rows");
    return { invoker, target };
  }

  async catchFishy(
    invokerId: string,
    targetId: string,
    interactionId: string,
    now = new Date(),
  ): Promise<FishyResult | Date> {
    return this.db.transaction(async (tx) => {
      const { invoker, target } = await this.lockUsers(tx, invokerId, targetId);
      const [previous] = await tx
        .select()
        .from(results)
        .where(eq(results.interactionId, BigInt(interactionId)));
      if (previous) {
        if (previous.userId !== invoker.id || previous.targetId !== target.id)
          throw new Error("Fishy interaction identity mismatch");
        return previous.result;
      }
      const next =
        invoker.lastFishies &&
        new Date(
          invoker.lastFishies.getTime() + SOCIAL_COOLDOWN_HOURS * 3600000,
        );
      if (next && next > now) return next;
      const streak = calculateStreak(
        invoker.lastFishies,
        invoker.fishyStreak,
        now,
      );
      const condition = fishingCondition(now);
      const item = selectCollectible(condition);
      const baseAmount = this.roll(item);
      const caughtAmount = Math.round(baseAmount * streak.multiplier);
      await tx
        .update(users)
        .set({ lastFishies: now, fishyStreak: streak.streak })
        .where(eq(users.id, invoker.id));
      const [updated] = await tx
        .update(users)
        .set({ fishies: sql`${users.fishies} + ${caughtAmount}` })
        .where(eq(users.id, target.id))
        .returning({ fishies: users.fishies });
      const [entry] = await tx
        .insert(collection)
        .values({
          userId: invoker.id,
          collectibleId: item.id,
          firstCaughtAt: now,
          lastCaughtAt: now,
        })
        .onConflictDoUpdate({
          target: [collection.userId, collection.collectibleId],
          set: {
            catchCount: sql`${collection.catchCount} + 1`,
            lastCaughtAt: now,
          },
        })
        .returning();
      const result: FishyResult = {
        baseAmount,
        caughtAmount,
        oldAmount: target.fishies.toString(),
        newAmount: updated.fishies.toString(),
        streak,
        collectibleId: item.id,
        condition,
        catchCount: entry.catchCount,
        firstDiscovery: entry.catchCount === 1,
      };
      await tx.insert(results).values({
        interactionId: BigInt(interactionId),
        userId: invoker.id,
        targetId: target.id,
        result,
        createdAt: now,
      });
      return result;
    });
  }

  async giveRep(
    invokerId: string,
    targetId: string,
    now = new Date(),
  ): Promise<RepResult | Date> {
    return this.db.transaction(async (tx) => {
      const { invoker, target } = await this.lockUsers(tx, invokerId, targetId);
      const next =
        invoker.lastRep &&
        new Date(invoker.lastRep.getTime() + SOCIAL_COOLDOWN_HOURS * 3600000);
      if (next && next > now) return next;
      const streak = calculateStreak(invoker.lastRep, invoker.repStreak, now);
      const amount = rollRepAmount(streak.multiplier);
      await tx
        .update(users)
        .set({ lastRep: now, repStreak: streak.streak })
        .where(eq(users.id, invoker.id));
      const [updated] = await tx
        .update(users)
        .set({ rep: sql`${users.rep} + ${amount}` })
        .where(eq(users.id, target.id))
        .returning({ rep: users.rep });
      return {
        amount,
        isStreakBonus: amount > REP_INCREMENT,
        oldAmount: target.rep.toString(),
        newAmount: updated.rep.toString(),
        streak,
      };
    });
  }

  async getCollection(userId: string) {
    return this.db
      .select({
        collectibleId: collection.collectibleId,
        catchCount: collection.catchCount,
        firstCaughtAt: collection.firstCaughtAt,
        lastCaughtAt: collection.lastCaughtAt,
      })
      .from(collection)
      .where(eq(collection.userId, BigInt(userId)));
  }
}
