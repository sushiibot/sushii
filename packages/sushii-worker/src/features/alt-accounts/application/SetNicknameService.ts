import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { AltAccountRepository } from "../domain/repositories/AltAccountRepository";

export const NICKNAME_MAX_LENGTH = 100;

export type SetNicknameOutcome = { kind: "noIdentity" } | { kind: "updated" };

export class SetNicknameService {
  constructor(
    private readonly altAccountRepository: AltAccountRepository,
    private readonly logger: Logger,
  ) {}

  private validateNicknameLength(
    nickname: string | null,
  ): Result<void, string> {
    if (nickname !== null && nickname.length > NICKNAME_MAX_LENGTH) {
      return Err(
        `Nickname must be ${NICKNAME_MAX_LENGTH} characters or fewer.`,
      );
    }

    return Ok.EMPTY;
  }

  async setNickname(
    guildId: string,
    userId: string,
    nickname: string | null,
  ): Promise<Result<SetNicknameOutcome, string>> {
    const validation = this.validateNicknameLength(nickname);
    if (validation.err) {
      return validation;
    }

    const identityResult = await this.altAccountRepository.findIdentityByUserId(
      guildId,
      userId,
    );

    if (identityResult.err) {
      this.logger.error(
        { err: identityResult.val, guildId, userId },
        "Failed to fetch alt identity for nickname update",
      );
      return Err(identityResult.val);
    }

    if (!identityResult.val) {
      return Ok({ kind: "noIdentity" });
    }

    const { identity } = identityResult.val;

    const setResult = await this.altAccountRepository.setNickname(
      guildId,
      identity.id,
      nickname,
    );

    if (setResult.err) {
      this.logger.error(
        { err: setResult.val, guildId, userId },
        "Failed to set alt identity nickname",
      );
      return Err(setResult.val);
    }

    return Ok({ kind: "updated" });
  }

  /**
   * Sets a nickname directly by identity ID — used by the `/alts view`
   * panel's nickname button, which already knows the identity ID from its
   * custom ID and has no single "target user" to resolve from.
   */
  async setNicknameByIdentityId(
    guildId: string,
    identityId: number,
    nickname: string | null,
  ): Promise<Result<void, string>> {
    const validation = this.validateNicknameLength(nickname);
    if (validation.err) {
      return validation;
    }

    const setResult = await this.altAccountRepository.setNickname(
      guildId,
      identityId,
      nickname,
    );

    if (setResult.err) {
      this.logger.error(
        { err: setResult.val, guildId, identityId },
        "Failed to set alt identity nickname",
      );
      return Err(setResult.val);
    }

    return Ok.EMPTY;
  }
}
