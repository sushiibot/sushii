import type { User } from "discord.js";

import type { UserProfileRepository } from "@/features/user-profile";
import type dayjs from "@/shared/domain/dayjs";
import logger from "@/shared/infrastructure/logger";

import type { RepResult } from "../domain";
import { REP_INCREMENT, calculateStreak, rollRepAmount } from "../domain";
import type { CooldownService } from "./CooldownService";

export class ReputationService {
  constructor(
    private readonly userProfileRepository: UserProfileRepository,
    private readonly cooldownService: CooldownService,
  ) {}

  async repForUser(
    invoker: User,
    target: User,
  ): Promise<RepResult | dayjs.Dayjs> {
    // Rep requires different users - cannot rep yourself
    if (invoker.id === target.id) {
      throw new Error("You cannot give reputation to yourself!");
    }

    // Fetch both profiles
    const [targetProfile, invokerProfile] = await Promise.all([
      this.userProfileRepository.getByIdOrDefault(target.id),
      this.userProfileRepository.getByIdOrDefault(invoker.id),
    ]);

    // Check cooldown for invoker
    const cooldownTime = this.cooldownService.checkRepCooldown(invokerProfile);
    if (cooldownTime) {
      return cooldownTime;
    }

    // Streak belongs to the invoker
    const now = new Date();
    const streak = calculateStreak(
      invokerProfile.getLastRep(),
      invokerProfile.getRepStreak(),
      now,
    );

    const amount = rollRepAmount(streak.multiplier);
    const isStreakBonus = amount > REP_INCREMENT;

    const oldAmount = targetProfile.getRep().toString();
    const newRep = targetProfile.getRep() + BigInt(amount);

    // Update target's rep (gets the reputation point)
    const updatedTarget = targetProfile.updateRep(newRep);

    // Update invoker's last rep timestamp only
    const updatedInvoker = invokerProfile.recordRep(now, streak.streak);

    // Save both profiles
    await Promise.all([
      this.userProfileRepository.save(updatedTarget),
      this.userProfileRepository.save(updatedInvoker),
    ]);

    logger.info(
      {
        invokerId: invoker.id,
        targetId: target.id,
        amount,
        streak: streak.streak,
        multiplier: streak.multiplier,
        oldAmount,
        newAmount: newRep.toString(),
      },
      "Rep given successfully",
    );

    return {
      amount,
      isStreakBonus,
      oldAmount,
      newAmount: newRep.toString(),
      streak,
    };
  }
}
