import dayjs from "@/shared/domain/dayjs";
import type { UserProfile } from "@/features/user-profile";
import { SOCIAL_COOLDOWN_HOURS } from "../domain";

export class CooldownService {
  checkFishyCooldown(user: UserProfile): dayjs.Dayjs | null {
    const lastFishies = user.getLastFishies();
    if (!lastFishies) {
      return null;
    }

    const lastFishiesTime = dayjs.utc(lastFishies);
    const nextFishyTime = lastFishiesTime.add(SOCIAL_COOLDOWN_HOURS, "hours");
    
    if (nextFishyTime.isAfter(dayjs.utc())) {
      return nextFishyTime;
    }

    return null;
  }

  checkRepCooldown(user: UserProfile): dayjs.Dayjs | null {
    const lastRep = user.getLastRep();
    if (!lastRep) {
      return null;
    }

    const lastRepTime = dayjs.utc(lastRep);
    const nextRepTime = lastRepTime.add(SOCIAL_COOLDOWN_HOURS, "hours");
    
    if (nextRepTime.isAfter(dayjs.utc())) {
      return nextRepTime;
    }

    return null;
  }
}