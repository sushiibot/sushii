import type { Client, GuildMember } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { AltAccountRepository } from "@/features/alt-accounts/domain/repositories";
import type { AltIdentityWithMembers } from "@/features/alt-accounts/domain/types";

import type {
  HistoryUserService,
  UserHistoryResult,
} from "../../cases/application/HistoryUserService";
import type {
  LookupUserService,
  UserLookupResult,
} from "../../cases/application/LookupUserService";
import type {
  NamesResult,
  NamesUserService,
} from "../../cases/application/NamesUserService";
import { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import type { TempBanRepository } from "../../shared/domain/repositories/TempBanRepository";
import { isPublicServer } from "../../shared/domain/services/PublicServerValidationService";
import type { TimeoutDetectionService } from "../../shared/domain/services/TimeoutDetectionService";
import type { UserInfo } from "../../shared/domain/types/UserInfo";

/** The target's current standing: whichever restriction, if any, is presently in force. */
export interface ModViewStanding {
  kind: "timeout" | "tempban";
  endsAt: Date;
}

export interface ModViewResult {
  userInfo: UserInfo;
  history: UserHistoryResult;
  /** `null` when the guild does not meet `isPublicServer` — the query is never run. */
  lookup: UserLookupResult | null;
  names: NamesResult;
  /**
   * The target's alt identity, including single-member identities. Distinct
   * from `history.linkedIdentity`, which `HistoryUserService` nulls out
   * unless the identity has more than one member — use that field for the
   * History tab's merge behavior, this one for the Alts tab.
   */
  identity: AltIdentityWithMembers | null;
  /**
   * `null` when nothing is currently in force — the header renders no
   * standing line at all in that case. Never a "clean" variant; presence is
   * the signal, so don't add one for the presentation layer to branch on.
   */
  standing: ModViewStanding | null;
}

export class ModViewService {
  constructor(
    private readonly client: Client,
    private readonly historyUserService: HistoryUserService,
    private readonly lookupUserService: LookupUserService,
    private readonly namesUserService: NamesUserService,
    private readonly altAccountRepository: AltAccountRepository,
    private readonly tempBanRepository: TempBanRepository,
    private readonly timeoutDetectionService: TimeoutDetectionService,
    private readonly logger: Logger,
  ) {}

  /**
   * `member` is resolved by the caller and passed in — never read from
   * `guild.members.cache` here. A cache miss would silently yield a null
   * standing, rendering a live timeout as "nothing in force", which is the
   * opposite of what the header's presence-is-the-signal contract promises.
   */
  async getModView(
    guildId: string,
    userId: string,
    member: GuildMember | null,
  ): Promise<Result<ModViewResult, string>> {
    const log = this.logger.child({ guildId, userId });

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return Err("Guild not found");
    }

    const lookupEnabled = isPublicServer(guild);

    const [
      historyResult,
      lookupResult,
      namesResult,
      identityResult,
      tempBanResult,
    ] = await Promise.all([
      this.historyUserService.getUserHistory(guildId, userId),
      lookupEnabled
        ? this.lookupUserService.lookupUser(guildId, userId)
        : Promise.resolve(null),
      this.namesUserService.getNames(guildId, userId),
      this.altAccountRepository.findIdentityByUserId(guildId, userId),
      this.tempBanRepository.findByGuildAndUserId(guildId, userId),
    ]);

    if (!historyResult.ok) {
      log.error(
        { error: historyResult.val },
        "Failed to load history for mod view",
      );
      return Err(historyResult.val);
    }

    if (lookupResult && !lookupResult.ok) {
      log.error(
        { error: lookupResult.val },
        "Failed to load lookup for mod view",
      );
      return Err(lookupResult.val);
    }

    if (!namesResult.ok) {
      log.error(
        { error: namesResult.val },
        "Failed to load names for mod view",
      );
      return Err(namesResult.val);
    }

    if (!identityResult.ok) {
      log.error(
        { error: identityResult.val },
        "Failed to load linked identity for mod view",
      );
      return Err(identityResult.val);
    }

    if (!tempBanResult.ok) {
      log.error(
        { error: tempBanResult.val },
        "Failed to load temp ban for mod view",
      );
      return Err(tempBanResult.val);
    }

    const timeoutExpiration = member
      ? this.timeoutDetectionService.getCurrentTimeoutExpiration(
          new ModerationTarget(member.user, member),
        )
      : null;

    const activeTempBan =
      tempBanResult.val && !tempBanResult.val.isExpired()
        ? tempBanResult.val
        : null;

    // A temp ban already revokes guild access, so on the rare chance both are
    // active at once it's the more restrictive state and wins for display.
    const standing: ModViewStanding | null = activeTempBan
      ? { kind: "tempban", endsAt: activeTempBan.expiresAt.toDate() }
      : timeoutExpiration
        ? { kind: "timeout", endsAt: timeoutExpiration.toDate() }
        : null;

    return Ok({
      userInfo: historyResult.val.userInfo,
      history: historyResult.val,
      lookup: lookupResult ? lookupResult.val : null,
      names: namesResult.val,
      identity: identityResult.val,
      standing,
    });
  }
}
