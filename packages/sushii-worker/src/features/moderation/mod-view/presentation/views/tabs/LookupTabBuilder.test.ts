import { describe, expect, it } from "bun:test";
import { ComponentType, ContainerBuilder } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModViewResult } from "@/features/moderation/mod-view/application/ModViewService";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";

import type { ModViewTabContentOptions } from "../ModViewMessageBuilder";
import { addLookupTabContent } from "./LookupTabBuilder";

const GUILD_ID = "111111111111111111";
const TARGET_ID = "222222222222222222";

const emojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

const userInfo: UserInfo = {
  id: TARGET_ID,
  username: "target",
  avatarURL: "https://example.com/avatar.png",
  joinedAt: null,
  isBot: false,
};

function extractTextContents(container: ContainerBuilder): string[] {
  const texts: string[] = [];

  function walk(node: Record<string, unknown>): void {
    if (
      node.type === ComponentType.TextDisplay &&
      typeof node.content === "string"
    ) {
      texts.push(node.content);
    }
    if (Array.isArray(node.components)) {
      for (const child of node.components as Record<string, unknown>[]) {
        walk(child);
      }
    }
  }

  walk(container.toJSON() as unknown as Record<string, unknown>);
  return texts;
}

function makeBan(overrides: Partial<UserLookupBan>): UserLookupBan {
  return {
    guildId: "999999999999999999",
    guildName: "Some Server",
    guildFeatures: [],
    guildMembers: 1000,
    reason: "test reason",
    actionTime: new Date(),
    lookupDetailsOptIn: true,
    ...overrides,
  };
}

function render(
  bans: UserLookupBan[],
  currentGuildLookupOptIn = true,
): string[] {
  const data: ModViewResult = {
    userInfo,
    history: {
      userInfo,
      moderationHistory: [],
      totalCases: 0,
      linkedIdentity: null,
    },
    lookup: {
      userInfo,
      crossServerBans: bans,
      currentGuildLookupOptIn,
    },
    names: { userInfo, history: [], eligibilityDenied: false },
    identity: null,
    standing: null,
  };

  const options: ModViewTabContentOptions = {
    data,
    disabled: false,
    user: { id: TARGET_ID, username: "target", globalName: null } as never,
    member: null,
    guildId: GUILD_ID,
    emojis,
  };

  const container = new ContainerBuilder();
  addLookupTabContent(container, options);
  return extractTextContents(container);
}

describe("LookupTabBuilder — privacy", () => {
  it("shows the member count and reason when both guilds opted in", () => {
    const ban = makeBan({
      guildFeatures: ["VERIFIED"],
      guildMembers: 5000,
      reason: "raiding",
      lookupDetailsOptIn: true,
    });

    const texts = render([ban]);
    const body = texts.join("\n");

    expect(body).toContain("5,000 members");
    expect(body).toContain("raiding");
  });

  it("withholds the member count and reason on an anonymised entry, while badges remain", () => {
    const ban = makeBan({
      guildFeatures: ["VERIFIED"],
      guildMembers: 5000,
      reason: "raiding",
      lookupDetailsOptIn: false, // the other server hasn't opted in
    });

    const texts = render([ban]);
    const body = texts.join("\n");

    // Absence: no exact size, no reason text leaks through.
    expect(body).not.toContain("5,000 members");
    expect(body).not.toContain("members");
    expect(body).not.toContain("raiding");
    // Presence: the anonymised label and the classification badge remain.
    expect(body).toContain("Anonymous");
    expect(body).toContain("Verified");
  });

  it("also withholds details when only the current guild has not opted in", () => {
    const ban = makeBan({
      guildMembers: 2500,
      reason: "spamming",
      lookupDetailsOptIn: true, // the banning server opted in...
    });

    // ...but this guild did not, so mutual opt-in still fails.
    const texts = render([ban], false);
    const body = texts.join("\n");

    expect(body).not.toContain("2,500 members");
    expect(body).not.toContain("spamming");
    expect(body).toContain("Anonymous");
  });
});

describe("LookupTabBuilder — ordering", () => {
  it("states the size-descending ordering in the scope block", () => {
    const bans = [
      makeBan({ guildMembers: 5000 }),
      makeBan({ guildMembers: 200 }),
    ];

    const texts = render(bans);
    expect(texts[0]).toContain("largest servers first");
  });
});
