import type { User } from "discord.js";

import type { UserProfileRepository } from "@/features/user-profile";
import type dayjs from "@/shared/domain/dayjs";
import logger from "@/shared/infrastructure/logger";

import type { RepResult } from "../domain";
import { REP_INCREMENT } from "../domain";
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

    const oldAmount = targetProfile.getRep().toString();
    const newRep = targetProfile.getRep() + BigInt(REP_INCREMENT);

    // Update target's rep (gets the reputation point)
    const updatedTarget = targetProfile.updateRep(newRep);

    // Update invoker's last rep timestamp only
    const updatedInvoker = invokerProfile.updateLastRepTimestamp();

    // Save both profiles
    await Promise.all([
      this.userProfileRepository.save(updatedTarget),
      this.userProfileRepository.save(updatedInvoker),
    ]);

    logger.info(
      {
        invokerId: invoker.id,
        targetId: target.id,
        oldAmount,
        newAmount: newRep.toString(),
      },
      "Rep given successfully",
    );

    return {
      oldAmount,
      newAmount: newRep.toString(),
    };
  }
}
