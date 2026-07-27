import { describe, expect, it } from "bun:test";

import { AltIdentity } from "../../domain/entities/AltIdentity";
import { AltIdentityMember } from "../../domain/entities/AltIdentityMember";
import type { AltIdentityWithMembers } from "../../domain/types";
import { buildAltIdentityContainer } from "./AltIdentityView";

const GUILD_ID = "111111111111111111";
const MOD_A = "444444444444444444";
const MOD_B = "555555555555555555";

const BATCH_AT = new Date("2026-01-01T00:00:00Z");
const EARLIER_AT = new Date("2025-06-01T00:00:00Z");

interface MemberSpec {
  userId: string;
  linkedBy?: string;
  linkedAt?: Date;
  reason?: string | null;
}

function makeIdentity(members: MemberSpec[]): AltIdentityWithMembers {
  return {
    identity: AltIdentity.fromData({
      id: 1,
      guildId: GUILD_ID,
      nickname: null,
      createdAt: EARLIER_AT,
    }),
    members: members.map((spec) =>
      AltIdentityMember.fromData({
        identityId: 1,
        guildId: GUILD_ID,
        userId: spec.userId,
        linkedBy: spec.linkedBy ?? MOD_A,
        linkedAt: spec.linkedAt ?? BATCH_AT,
        reason: spec.reason ?? null,
      }),
    ),
  };
}

function renderedText(identity: AltIdentityWithMembers, options = {}): string {
  const container = buildAltIdentityContainer(identity, options);
  const section = container.toJSON().components[0] as {
    components: { content: string }[];
  };

  return section.components[0].content;
}

function userId(index: number): string {
  return `7000000000000${String(index).padStart(5, "0")}`;
}

describe("buildAltIdentityContainer", () => {
  it("renders a lone member on a single line", () => {
    const text = renderedText(makeIdentity([{ userId: userId(1) }]));

    expect(text).toContain(`<@${userId(1)}> — linked by <@${MOD_A}>`);
    expect(text).not.toContain("Linked by");
  });

  it("collapses a batch sharing linker, time, and reason into one group", () => {
    const text = renderedText(
      makeIdentity([
        { userId: userId(1), reason: "ban evasion" },
        { userId: userId(2), reason: "ban evasion" },
        { userId: userId(3), reason: "ban evasion" },
      ]),
    );

    expect(text).toContain(`Linked by <@${MOD_A}>`);
    expect(text).toContain(
      `<@${userId(1)}>, <@${userId(2)}>, <@${userId(3)}>`,
    );
    // One header for the whole batch, not one per member.
    expect(text.split("Linked by").length - 1).toBe(1);
  });

  it("starts a new group when the linker differs", () => {
    const text = renderedText(
      makeIdentity([
        { userId: userId(1), linkedAt: EARLIER_AT, linkedBy: MOD_B },
        { userId: userId(2), linkedAt: EARLIER_AT, linkedBy: MOD_B },
        { userId: userId(3) },
        { userId: userId(4) },
      ]),
    );

    expect(text).toContain(`Linked by <@${MOD_B}>`);
    expect(text).toContain(`Linked by <@${MOD_A}>`);
  });

  it("bolds highlighted members", () => {
    const text = renderedText(
      makeIdentity([
        { userId: userId(1) },
        { userId: userId(2) },
        { userId: userId(3) },
      ]),
      { highlightUserIds: [userId(2)] },
    );

    expect(text).toContain(`**<@${userId(2)}>**`);
    expect(text).toContain(`<@${userId(1)}>`);
  });

  it("keeps highlighted members visible on an identity too large to render whole", () => {
    const members: MemberSpec[] = Array.from({ length: 200 }, (_, i) => ({
      userId: userId(i),
      linkedAt: EARLIER_AT,
      linkedBy: MOD_B,
    }));
    members.push({ userId: userId(900) });

    const text = renderedText(makeIdentity(members), {
      highlightUserIds: [userId(900)],
    });

    expect(text).toContain(`**<@${userId(900)}>**`);
    expect(text).toContain("more*");
  });

  it("stays within the text display limit for a very large identity", () => {
    const members: MemberSpec[] = Array.from({ length: 500 }, (_, i) => ({
      userId: userId(i),
    }));

    const content = renderedText(makeIdentity(members));

    expect(content.length).toBeLessThanOrEqual(4000);
  });

  it("counts every unrendered member in the '+N more' line", () => {
    const members: MemberSpec[] = Array.from({ length: 500 }, (_, i) => ({
      userId: userId(i),
    }));

    const content = renderedText(makeIdentity(members));

    const shown = (content.match(/<@7000000000000\d{5}>/g) ?? []).length;
    const omitted = Number(/\*\+(\d+) more\*/.exec(content)?.[1]);

    // The linker mention is on the group header, not a member entry.
    expect(shown + omitted).toBe(500);
  });
});
