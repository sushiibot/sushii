import { beforeEach, describe, expect, it, mock } from "bun:test";
import { PermissionFlagsBits } from "discord.js";
import { pino } from "pino";
import { Err, Ok } from "ts-results";

import type { LinkAccountsService } from "../../application/LinkAccountsService";
import type { ListIdentitiesService } from "../../application/ListIdentitiesService";
import type { SetNicknameService } from "../../application/SetNicknameService";
import type { UnlinkAccountService } from "../../application/UnlinkAccountService";
import type { ViewIdentityService } from "../../application/ViewIdentityService";
import { AltsCommand } from "./AltsCommand";

const GUILD_ID = "111111111111111111";
const MOD_ID = "555555555555555555";
const USER_A = "222222222222222222";
const USER_B = "333333333333333333";

function makeUser(id: string, bot = false) {
  return { id, bot };
}

function makeInteraction(
  subcommand: string,
  options: Record<string, unknown>,
) {
  const reply = mock(() => Promise.resolve());

  return {
    reply,
    inCachedGuild: () => true,
    guildId: GUILD_ID,
    guild: { id: GUILD_ID },
    user: { id: MOD_ID },
    options: {
      getSubcommand: () => subcommand,
      getUser: (name: string) => options[name] ?? null,
      getString: (name: string) => (options[name] as string | undefined) ?? null,
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
        user_a: makeUser(USER_A),
        user_b: makeUser(USER_A),
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
        user_a: makeUser(USER_A, true),
        user_b: makeUser(USER_B),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await command.handler(interaction as any);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Bot accounts can't be linked.",
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
