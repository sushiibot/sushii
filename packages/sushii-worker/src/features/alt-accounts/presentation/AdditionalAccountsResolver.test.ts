import { describe, expect, it, mock } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";

import {
  parseAccountTokens,
  resolveAdditionalAccounts,
  validateAccountTokens,
} from "./AdditionalAccountsResolver";
import { MAX_LINKED_ACCOUNTS } from "../application/LinkAccountsService";

const USER_A = "222222222222222222";
const USER_B = "333333333333333333";
const USER_C = "444444444444444444";
const USER_D = "666666666666666666";

describe("parseAccountTokens", () => {
  it("accepts bare IDs, mentions, and legacy nickname mentions", () => {
    const result = parseAccountTokens(`${USER_A} <@${USER_B}> <@!${USER_A}>`);

    expect(result.userIds).toEqual([USER_A, USER_B]);
    expect(result.invalidTokens).toEqual([]);
  });

  it("splits on commas and newlines as well as spaces", () => {
    const result = parseAccountTokens(`${USER_A},${USER_B}\n<@${USER_A}>`);

    expect(result.userIds).toEqual([USER_A, USER_B]);
    expect(result.invalidTokens).toEqual([]);
  });

  it("reports unrecognized entries instead of dropping them", () => {
    const result = parseAccountTokens(`${USER_A} @everyone not-an-id`);

    expect(result.userIds).toEqual([USER_A]);
    expect(result.invalidTokens).toEqual(["@everyone", "not-an-id"]);
  });

  it("rejects a number longer than the largest possible snowflake", () => {
    const result = parseAccountTokens("12345678901234567890123");

    expect(result.userIds).toEqual([]);
    expect(result.invalidTokens).toEqual(["12345678901234567890123"]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(parseAccountTokens("   ")).toEqual({
      userIds: [],
      invalidTokens: [],
    });
  });
});

describe("validateAccountTokens", () => {
  it("rejects more IDs than the cap allows", () => {
    const userIds = Array.from(
      { length: MAX_LINKED_ACCOUNTS + 1 },
      (_, i) => `7777777777777${String(i).padStart(5, "0")}`,
    );

    expect(validateAccountTokens({ userIds, invalidTokens: [] }).err).toBe(true);
  });

  it("accepts a list at the cap", () => {
    const userIds = Array.from(
      { length: MAX_LINKED_ACCOUNTS },
      (_, i) => `7777777777777${String(i).padStart(5, "0")}`,
    );

    expect(validateAccountTokens({ userIds, invalidTokens: [] }).ok).toBe(true);
  });
});

function makeInteraction(options: {
  bulkMembers?: Record<string, { id: string; bot: boolean }>;
  bulkThrows?: boolean;
  fetchableUsers?: Record<string, { id: string; bot: boolean }>;
}) {
  const { bulkMembers = {}, bulkThrows = false, fetchableUsers = {} } = options;

  const membersFetch = mock(() =>
    bulkThrows
      ? Promise.reject(new Error("no gateway"))
      : Promise.resolve(
          new Map(
            Object.entries(bulkMembers).map(([id, user]) => [id, { user }]),
          ),
        ),
  );
  const usersFetch = mock((id: string) =>
    fetchableUsers[id]
      ? Promise.resolve(fetchableUsers[id])
      : Promise.reject(new Error("Unknown User")),
  );

  return {
    guild: { members: { cache: new Map(), fetch: membersFetch } },
    client: { users: { cache: new Map(), fetch: usersFetch } },
    options: { resolved: { users: new Map() } },
    usersFetch,
  };
}

describe("resolveAdditionalAccounts", () => {
  it("keeps IDs aligned when the bulk fetch only returns some members", async () => {
    const interaction = makeInteraction({
      bulkMembers: { [USER_B]: { id: USER_B, bot: false } },
      fetchableUsers: {
        [USER_A]: { id: USER_A, bot: false },
        [USER_C]: { id: USER_C, bot: true },
      },
    });

    const result = await resolveAdditionalAccounts(
      interaction as unknown as ChatInputCommandInteraction<"cached">,
      [USER_A, USER_B, USER_C, USER_D],
    );

    // Order must match the input, not the order fetches resolved in.
    expect(result.targets).toEqual([
      { id: USER_A, isBot: false },
      { id: USER_B, isBot: false },
      { id: USER_C, isBot: true },
    ]);
    expect(result.unresolvedIds).toEqual([USER_D]);
  });

  it("falls back to per-user fetches when the bulk fetch throws", async () => {
    const interaction = makeInteraction({
      bulkThrows: true,
      fetchableUsers: { [USER_A]: { id: USER_A, bot: false } },
    });

    const result = await resolveAdditionalAccounts(
      interaction as unknown as ChatInputCommandInteraction<"cached">,
      [USER_A, USER_B],
    );

    expect(result.targets).toEqual([{ id: USER_A, isBot: false }]);
    expect(result.unresolvedIds).toEqual([USER_B]);
  });

  it("skips fetching users already in cache", async () => {
    const interaction = makeInteraction({ bulkThrows: true });
    interaction.client.users.cache.set(USER_A, { id: USER_A, bot: false });

    const result = await resolveAdditionalAccounts(
      interaction as unknown as ChatInputCommandInteraction<"cached">,
      [USER_A],
    );

    expect(result.targets).toEqual([{ id: USER_A, isBot: false }]);
    expect(interaction.usersFetch).not.toHaveBeenCalled();
  });
});
