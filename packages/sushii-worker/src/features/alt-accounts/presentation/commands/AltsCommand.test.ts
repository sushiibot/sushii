import { beforeEach, describe, expect, it, mock } from "bun:test";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { pino } from "pino";
import { Err, Ok } from "ts-results";

import { makeAltIdentity } from "@/test/fixtures/altIdentity";

import type { LinkAccountsOutcome, LinkAccountsService } from "../../application/LinkAccountsService";
import { MAX_LINKED_ACCOUNTS } from "../../application/LinkAccountsService";
import type { ListIdentitiesService } from "../../application/ListIdentitiesService";
import type { SetNicknameService } from "../../application/SetNicknameService";
import type { UnlinkAccountService } from "../../application/UnlinkAccountService";
import type { ViewIdentityService } from "../../application/ViewIdentityService";
import { AltsCommand } from "./AltsCommand";

const GUILD_ID = "111111111111111111";
const MOD_ID = "555555555555555555";
const USER_A = "222222222222222222";
const USER_B = "333333333333333333";
const USER_C = "444444444444444444";
const USER_D = "666666666666666666";

function makeUser(id: string, bot = false) {
  return { id, bot };
}

function makeOutcome(): LinkAccountsOutcome {
  return {
    identity: makeAltIdentity({ id: 1, guildId: GUILD_ID }),
    identityCreated: true,
    addedUserIds: [USER_A, USER_B],
    alreadyLinkedUserIds: [],
    mergedIdentityIds: [],
    keptNickname: null,
    adoptedNickname: null,
    discardedNicknames: [],
    skippedBotIds: [],
  };
}

function makeInteraction(
  subcommand: string,
  options: Record<string, unknown>,
  fetchedUsers: Record<string, { id: string; bot: boolean }> = {},
) {
  const reply = mock(() => Promise.resolve());
  const deferReply = mock(() => Promise.resolve());
  const editReply = mock(() => Promise.resolve());
  const membersFetch = mock(() => Promise.reject(new Error("no gateway")));
  const usersFetch = mock((id: string) =>
    fetchedUsers[id]
      ? Promise.resolve(fetchedUsers[id])
      : Promise.reject(new Error("Unknown User")),
  );

  return {
    reply,
    deferReply,
    editReply,
    inCachedGuild: () => true,
    guildId: GUILD_ID,
    guild: {
      id: GUILD_ID,
      members: { cache: new Map(), fetch: membersFetch },
    },
    client: { users: { cache: new Map(), fetch: usersFetch } },
    user: { id: MOD_ID },
    options: {
      getSubcommand: () => subcommand,
      getUser: (name: string) => options[name] ?? null,
      getString: (name: string) => (options[name] as string | undefined) ?? null,
      resolved: { users: new Map() },
    },
  };
}

describe("AltsCommand", () => {
  it("requires Ban Members permission by default", () => {
    const command = new AltsCommand(
      {} as LinkAccountsService,
      {} as UnlinkAccountService,
      {} as ViewIdentityService,
      {} as SetNicknameService,
      {} as ListIdentitiesService,
      pino({ level: "silent" }),
    );

    expect(command.command.default_member_permissions).toBe(
      PermissionFlagsBits.BanMembers.toString(),
    );
  });

  describe("link", () => {
    let linkAccountsService: LinkAccountsService;
    let command: AltsCommand;

    beforeEach(() => {
      linkAccountsService = {
        link: mock(() => Promise.resolve(Err("You can't link an account to itself."))),
      } as unknown as LinkAccountsService;

      command = new AltsCommand(
        linkAccountsService,
        {} as UnlinkAccountService,
        {} as ViewIdentityService,
        {} as SetNicknameService,
        {} as ListIdentitiesService,
        pino({ level: "silent" }),
      );
    });

    it("shows a clear error for a self-link", async () => {
      const interaction = makeInteraction("link", {
        account_1: makeUser(USER_A),
        account_2: makeUser(USER_A),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "You can't link an account to itself.",
        }),
      );
    });

    it("shows a clear error for a bot account", async () => {
      linkAccountsService.link = mock(() =>
        Promise.resolve(Err("Bot accounts can't be linked.")),
      );

      const interaction = makeInteraction("link", {
        account_1: makeUser(USER_A, true),
        account_2: makeUser(USER_B),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Bot accounts can't be linked.",
        }),
      );
    });

    it("replies immediately when no additional accounts are given", async () => {
      const interaction = makeInteraction("link", {
        account_1: makeUser(USER_A),
        account_2: makeUser(USER_B),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalled();
    });

    it("resolves additional accounts from mixed IDs and mentions", async () => {
      linkAccountsService.link = mock(() => Promise.resolve(Ok(makeOutcome())));

      const interaction = makeInteraction(
        "link",
        {
          account_1: makeUser(USER_A),
          account_2: makeUser(USER_B),
          additional_accounts: `${USER_C}, <@${USER_D}>`,
        },
        {
          [USER_C]: makeUser(USER_C),
          [USER_D]: makeUser(USER_D),
        },
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(interaction.deferReply).toHaveBeenCalled();
      expect(linkAccountsService.link).toHaveBeenCalledWith(
        expect.objectContaining({
          additional: [
            { id: USER_C, isBot: false },
            { id: USER_D, isBot: false },
          ],
        }),
      );
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: ["IsComponentsV2"] }),
      );
    });

    it("still links the required accounts when an entry is unrecognized", async () => {
      linkAccountsService.link = mock(() => Promise.resolve(Ok(makeOutcome())));

      const interaction = makeInteraction("link", {
        account_1: makeUser(USER_A),
        account_2: makeUser(USER_B),
        additional_accounts: "not-an-id @everyone",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(linkAccountsService.link).toHaveBeenCalledWith(
        expect.objectContaining({ additional: [] }),
      );
      // Nothing resolvable to fetch, so there's no reason to defer.
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: ["IsComponentsV2"] }),
      );
    });

    it("rejects an over-cap list before fetching anything", async () => {
      linkAccountsService.link = mock(() => Promise.resolve(Ok(makeOutcome())));

      const tooMany = Array.from(
        { length: MAX_LINKED_ACCOUNTS + 1 },
        (_, i) => `7777777777777${String(i).padStart(5, "0")}`,
      ).join(" ");

      const interaction = makeInteraction("link", {
        account_1: makeUser(USER_A),
        account_2: makeUser(USER_B),
        additional_accounts: tooMany,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(linkAccountsService.link).not.toHaveBeenCalled();
      expect(interaction.client.users.fetch).not.toHaveBeenCalled();
      // Rejected before deferring, so the error stays ephemeral.
      expect(interaction.deferReply).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("more than"),
          flags: MessageFlags.Ephemeral,
        }),
      );
    });
  });

  describe("view", () => {
    it("shows a 'no linked accounts' response when there is no identity", async () => {
      const viewIdentityService = {
        view: mock(() => Promise.resolve(Ok(null))),
      } as unknown as ViewIdentityService;

      const command = new AltsCommand(
        {} as LinkAccountsService,
        {} as UnlinkAccountService,
        viewIdentityService,
        {} as SetNicknameService,
        {} as ListIdentitiesService,
        pino({ level: "silent" }),
      );

      const interaction = makeInteraction("view", { user: makeUser(USER_A) });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: ["IsComponentsV2"] }),
      );
    });
  });

  describe("list", () => {
    it("shows a 'no tracked identities' response for an empty guild", async () => {
      const listIdentitiesService = {
        count: mock(() => Promise.resolve(0)),
        listPage: mock(() => Promise.resolve([])),
      } as unknown as ListIdentitiesService;

      const command = new AltsCommand(
        {} as LinkAccountsService,
        {} as UnlinkAccountService,
        {} as ViewIdentityService,
        {} as SetNicknameService,
        listIdentitiesService,
        pino({ level: "silent" }),
      );

      const interaction = makeInteraction("list", {});

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: 32768 }),
      );
    });
  });
});
