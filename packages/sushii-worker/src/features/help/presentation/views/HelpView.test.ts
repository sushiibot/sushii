import { describe, expect, test } from "bun:test";
import type {
  APIButtonComponent,
  APIComponentInContainer,
  APIContainerComponent,
  APITextDisplayComponent,
  PermissionsBitField,
} from "discord.js";
import { ComponentType } from "discord.js";

import {
  ALL_EMOJIS,
  KNOWN_MENTIONS,
  NO_EMOJIS,
  PERMISSIONS,
  UNKNOWN_MENTIONS,
  catalogCommandList,
} from "@/test/fixtures/help";

import type { HelpAudience } from "../../domain/helpCatalog";
import { resolveVisibleHelp } from "../helpVisibility";
import type { HelpEmojis, HelpViewInput } from "./HelpView";
import { buildHelpPage } from "./HelpView";

const OWNER_ID = "150443906511667200";
const BEFORE_NEW_ENDS = new Date("2026-10-26T12:00:00Z");
const AFTER_NEW_ENDS = new Date("2026-11-25T00:00:00Z");

function render(
  audience: HelpAudience,
  permissions: PermissionsBitField,
  overrides: Partial<HelpViewInput> = {},
): APIContainerComponent {
  const payload = buildHelpPage({
    audience,
    visible: resolveVisibleHelp(catalogCommandList(), permissions),
    emojis: ALL_EMOJIS as HelpEmojis,
    mentions: KNOWN_MENTIONS,
    guildId: "167058919611564043",
    ownerId: OWNER_ID,
    now: BEFORE_NEW_ENDS,
    ...overrides,
  });
  return payload.components[0].toJSON();
}

function texts(container: APIContainerComponent): string[] {
  return container.components
    .filter(
      (c): c is APITextDisplayComponent => c.type === ComponentType.TextDisplay,
    )
    .map((c) => c.content);
}

function tabs(container: APIContainerComponent): APIButtonComponent[] {
  const row = container.components.find(
    (c) => c.type === ComponentType.ActionRow,
  );
  return row?.type === ComponentType.ActionRow
    ? (row.components as APIButtonComponent[])
    : [];
}

function countComponents(
  components: readonly APIComponentInContainer[],
): number {
  return components.reduce(
    (n, c) =>
      n +
      1 +
      ("components" in c
        ? countComponents(c.components as APIComponentInContainer[])
        : 0),
    0,
  );
}

describe("buildHelpPage tabs", () => {
  test("member sees no tab row", () => {
    const page = render("members", PERMISSIONS.member);

    expect(tabs(page)).toEqual([]);
    expect(texts(page).join("\n")).not.toContain("Moderation");
    expect(texts(page).join("\n")).not.toContain("Server setup");
  });

  test("moderator sees Members and Moderators", () => {
    const labels = tabs(render("members", PERMISSIONS.moderator)).map(
      (b) => "label" in b && b.label,
    );

    expect(labels).toEqual(["Members", "Moderators"]);
  });

  test("admin sees all three tabs with the active one disabled", () => {
    const buttons = tabs(render("moderators", PERMISSIONS.admin));

    expect(
      buttons.map((b) => [
        "label" in b && b.label,
        b.style,
        b.disabled ?? false,
      ]),
    ).toEqual([
      ["Members", 2, false],
      ["Moderators", 1, true],
      ["Admins", 2, false],
    ]);
    expect(buttons.map((b) => "custom_id" in b && b.custom_id)).toEqual([
      `help:tab:members:${OWNER_ID}`,
      `help:tab:moderators:${OWNER_ID}`,
      `help:tab:admins:${OWNER_ID}`,
    ]);
  });

  test("commands with subcommands link their main subcommand", () => {
    const content = texts(render("members", PERMISSIONS.member)).join("\n");

    expect(content).toContain(
      "</notification add:1300000000000000000> · Get pinged when someone says a keyword",
    );
    expect(content).not.toContain("</notification:");
  });

  test("Manage Server without Ban Members skips the Moderators tab", () => {
    const labels = tabs(render("members", PERMISSIONS.manageGuildOnly)).map(
      (b) => "label" in b && b.label,
    );

    expect(labels).toEqual(["Members", "Admins"]);
  });

  test("Moderators tab lists only moderator categories, with apps", () => {
    const content = texts(render("moderators", PERMISSIONS.admin)).join("\n");

    expect(content).toContain("### <:ban:");
    expect(content).toContain("Cases & lookup");
    expect(content).toContain(
      "-# Right-click → Apps: **Mod View**, **View Reaction Starters**",
    );
    expect(content).not.toContain("What sushii can do");
    expect(content).not.toContain("Server setup");
  });
});

describe("buildHelpPage New line", () => {
  test("admin sees both new commands", () => {
    const content = texts(render("members", PERMISSIONS.admin));

    expect(content).toContain(
      "<:sparkle:1400000000000000100> **New:** </permission-audit:1300000000000000000> · </fishy-collection:1300000000000000000>",
    );
  });

  test("member does not see the admin-only new command", () => {
    const content = texts(render("members", PERMISSIONS.member)).join("\n");

    expect(content).toContain(
      "**New:** </fishy-collection:1300000000000000000>\n",
    );
    expect(content).not.toContain("permission-audit");
  });

  test("marks new commands in their category", () => {
    const content = texts(render("members", PERMISSIONS.member)).join("\n");

    expect(content).toContain(
      "</fishy-collection:1300000000000000000> <:sparkle:1400000000000000100> · Browse your fishy discoveries",
    );
  });

  test("drops the New line and markers once newUntil passes", () => {
    const content = texts(
      render("members", PERMISSIONS.admin, { now: AFTER_NEW_ENDS }),
    ).join("\n");

    expect(content).not.toContain("**New:**");
    expect(content).not.toContain("<:sparkle:");
  });
});

describe("buildHelpPage fallbacks", () => {
  test("missing emoji renders no icon", () => {
    const content = texts(
      render("members", PERMISSIONS.member, { emojis: NO_EMOJIS }),
    );

    expect(content).toContain(
      "### Fun & social\n</fishy:1300000000000000000> · Catch some fish!\n</rep:1300000000000000000> · Give someone reputation\n</fishy-collection:1300000000000000000> · Browse your fishy discoveries\n</fishy-leaderboard:1300000000000000000> · Top fishers in this server\n</rep-leaderboard:1300000000000000000> · Top reputation in this server",
    );
    expect(content).toContain(
      "**New:** </fishy-collection:1300000000000000000>",
    );
  });

  test("unknown command IDs fall back to inline code", () => {
    const content = texts(
      render("members", PERMISSIONS.member, { mentions: UNKNOWN_MENTIONS }),
    ).join("\n");

    expect(content).toContain("`/fishy` · Catch some fish!");
    expect(content).toContain(
      "-# Search any command: `/help` `command:` · Full docs: <https://sushii.bot>",
    );
  });
});

describe("buildHelpPage budget", () => {
  for (const audience of ["members", "moderators", "admins"] as const) {
    test(`${audience} tab fits in 40 components and 4000 characters`, () => {
      const page = render(audience, PERMISSIONS.admin);
      const characters = texts(page).join("").length;

      expect(1 + countComponents(page.components)).toBeLessThanOrEqual(40);
      expect(characters).toBeLessThanOrEqual(4000);
    });
  }
});
