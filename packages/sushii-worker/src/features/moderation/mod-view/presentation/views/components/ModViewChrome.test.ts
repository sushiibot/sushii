import { describe, expect, it } from "bun:test";
import { Collection, ComponentType, ContainerBuilder } from "discord.js";
import type { GuildMember, User } from "discord.js";

import { addIdentityHeader, addOverflowLine } from "./ModViewChrome";

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
    if (node.accessory && typeof node.accessory === "object") {
      walk(node.accessory as Record<string, unknown>);
    }
  }

  walk(container.toJSON() as unknown as Record<string, unknown>);
  return texts;
}

describe("addOverflowLine — singular/plural counts", () => {
  it("uses the singular noun for a count of 1", () => {
    const container = new ContainerBuilder();
    addOverflowLine(container, 1, "account");

    expect(extractTextContents(container)).toEqual(["-# +1 more account"]);
  });

  it("uses the plural noun for any other count", () => {
    const container = new ContainerBuilder();
    addOverflowLine(container, 3, "account");

    expect(extractTextContents(container)).toEqual(["-# +3 more accounts"]);
  });
});

function makeRole(name: string, position: number, permissionBits: bigint) {
  return {
    name,
    position,
    permissions: { bitfield: permissionBits },
  };
}

describe("addIdentityHeader — role count singular/plural", () => {
  const user = {
    id: "222222222222222222",
    username: "target",
    globalName: null,
    createdTimestamp: Date.now(),
    displayAvatarURL: () => "https://example.com/avatar.png",
  } as unknown as User;

  it("states '1 role' when the member has exactly one non-@everyone role", () => {
    const roles = new Collection<string, ReturnType<typeof makeRole>>();
    roles.set("everyone", makeRole("@everyone", 0, 0n));
    roles.set("mod", makeRole("Moderator", 1, 8n));

    const member = {
      nickname: null,
      joinedTimestamp: null,
      roles: { cache: roles },
    } as unknown as GuildMember;

    const container = new ContainerBuilder();
    addIdentityHeader(container, user, member, null);

    const body = extractTextContents(container).join("\n");
    expect(body).toContain("1 role");
    expect(body).not.toContain("1 roles");
  });

  it("states 'N roles' when the member has more than one non-@everyone role", () => {
    const roles = new Collection<string, ReturnType<typeof makeRole>>();
    roles.set("everyone", makeRole("@everyone", 0, 0n));
    roles.set("mod", makeRole("Moderator", 1, 8n));
    roles.set("helper", makeRole("Helper", 2, 8n));

    const member = {
      nickname: null,
      joinedTimestamp: null,
      roles: { cache: roles },
    } as unknown as GuildMember;

    const container = new ContainerBuilder();
    addIdentityHeader(container, user, member, null);

    const body = extractTextContents(container).join("\n");
    expect(body).toContain("2 roles");
  });
});
