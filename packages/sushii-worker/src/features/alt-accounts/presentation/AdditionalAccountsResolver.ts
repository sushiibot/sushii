import type { ChatInputCommandInteraction } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { LinkTarget } from "../application/LinkAccountsService";
import { MAX_LINKED_ACCOUNTS } from "../application/LinkAccountsService";

// Snowflakes are unsigned 64-bit, so 2^64-1 (20 digits) is the hard ceiling.
const ACCOUNT_TOKEN_RE = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/;

export interface ParsedAccountTokens {
  /** Valid snowflakes, in input order, deduplicated. */
  userIds: string[];
  /** Raw tokens that were neither a bare ID nor a user mention. */
  invalidTokens: string[];
}

/**
 * Splits on whitespace and commas, then validates each token whole. Matching
 * whole tokens rather than scraping for digit runs is what makes reporting
 * unrecognized input possible at all.
 */
export function parseAccountTokens(raw: string): ParsedAccountTokens {
  const userIds = new Set<string>();
  const invalidTokens: string[] = [];

  for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
    const match = ACCOUNT_TOKEN_RE.exec(token);

    if (match) {
      userIds.add(match[1] ?? match[2]);
    } else {
      invalidTokens.push(token);
    }
  }

  return { userIds: [...userIds], invalidTokens };
}

export interface ResolvedAdditionalAccounts {
  targets: LinkTarget[];
  /** Well-formed snowflakes Discord had no user for. */
  unresolvedIds: string[];
}

/**
 * Validates parsed tokens before any Discord fetch, so an obviously bad list is
 * rejected while the reply can still be ephemeral.
 */
export function validateAccountTokens(
  parsed: ParsedAccountTokens,
): Result<void, string> {
  if (parsed.userIds.length > MAX_LINKED_ACCOUNTS) {
    return Err(
      `You can't link more than ${MAX_LINKED_ACCOUNTS} accounts at once.`,
    );
  }

  return Ok.EMPTY;
}

export async function resolveAdditionalAccounts(
  interaction: ChatInputCommandInteraction<"cached">,
  userIds: string[],
): Promise<ResolvedAdditionalAccounts> {
  const targets: LinkTarget[] = [];
  const pending: string[] = [];

  for (const userId of userIds) {
    const cached =
      interaction.options.resolved?.users?.get(userId) ??
      interaction.guild.members.cache.get(userId)?.user ??
      interaction.client.users.cache.get(userId);

    if (cached) {
      targets.push({ id: cached.id, isBot: cached.bot });
    } else {
      pending.push(userId);
    }
  }

  if (pending.length > 0) {
    try {
      // Short timeout: the gateway chunk request otherwise hangs for 120s.
      const members = await interaction.guild.members.fetch({
        user: pending,
        time: 5_000,
      });

      for (const member of members.values()) {
        targets.push({ id: member.user.id, isBot: member.user.bot });
      }
    } catch {
      // Bulk fetch is opportunistic — fall through to per-ID fetches.
    }
  }

  const stillMissing = pending.filter(
    (userId) => !targets.some((target) => target.id === userId),
  );
  const unresolvedIds: string[] = [];

  const fetched = await Promise.allSettled(
    stillMissing.map(async (userId) => ({
      userId,
      user: await interaction.client.users.fetch(userId),
    })),
  );

  fetched.forEach((result, index) => {
    if (result.status === "fulfilled") {
      targets.push({ id: result.value.user.id, isBot: result.value.user.bot });
    } else {
      unresolvedIds.push(stillMissing[index]);
    }
  });

  // Restore the order the mod typed — fetches resolve out of order.
  targets.sort((a, b) => userIds.indexOf(a.id) - userIds.indexOf(b.id));

  return { targets, unresolvedIds };
}
