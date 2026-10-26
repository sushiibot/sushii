import { describe, expect, mock, test } from "bun:test";
import { EmbedBuilder } from "discord.js";
import type { Logger } from "pino";

import type { Feedback } from "../domain/Feedback";
import {
  FeedbackWebhookPublisher,
  buildFeedbackEmbed,
} from "./FeedbackWebhookPublisher";

const BASE: Feedback = {
  id: 1,
  userId: "150443906511667200",
  guildId: "167058919611564043",
  source: "error_report",
  kind: "broken",
  feature: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  content: "It errored right after I picked the channel.",
  createdAt: new Date("2026-10-26T12:00:00Z"),
};

describe("buildFeedbackEmbed", () => {
  test("error report includes the error ID", () => {
    const embed = buildFeedbackEmbed(BASE, {
      username: "tzuyu",
      guildName: "ONCE",
    }).toJSON();

    expect(embed.title).toBe("Feedback: error report");
    expect(embed.fields).toEqual([
      { name: "Kind", value: "🐛 Something's not working", inline: true },
      {
        name: "Reporter",
        value: "<@150443906511667200> tzuyu (150443906511667200)",
        inline: true,
      },
      { name: "Server", value: "ONCE (167058919611564043)", inline: true },
      { name: "Error ID", value: "```4bf92f3577b34da6a3ce929d0e0e4736```" },
    ]);
  });

  test("panel feedback from DMs uses the feature label and no error ID", () => {
    const embed = buildFeedbackEmbed(
      {
        ...BASE,
        source: "panel",
        kind: "praise",
        feature: "permission-audit",
        traceId: null,
        guildId: null,
      },
      { username: "tzuyu", guildName: null },
    ).toJSON();

    expect(embed.title).toBe("Feedback: Permission audit");
    expect(embed.fields?.map((f) => f.name)).toEqual([
      "Kind",
      "Reporter",
      "Server",
    ]);
    expect(embed.fields?.[2].value).toBe("DM");
  });

  test("an uncached guild shows only its ID", () => {
    const embed = buildFeedbackEmbed(BASE, {
      username: "tzuyu",
      guildName: null,
    }).toJSON();

    expect(embed.fields?.[2].value).toBe("167058919611564043");
  });
});

const HOSTILE = [
  "[free nitro](https://evil.example)",
  "-# tiny",
  ">>> quoted",
  "<@&1> @everyone <#2> </cmd:3> <t:0:R>",
  "https://x",
  "```js",
  "escape``` the fence",
].join("\n");

test("feedback content is rendered inside a code block that can't be closed early", () => {
  const embed = buildFeedbackEmbed(
    { ...BASE, content: HOSTILE },
    { username: "tzuyu", guildName: "ONCE" },
  ).toJSON();

  const description = embed.description ?? "";
  expect(description.startsWith("```\n")).toBe(true);
  expect(description.endsWith("\n```")).toBe(true);
  const inner = description.slice(4, -4);
  expect(inner).not.toContain("`");
  expect(inner).toBe(HOSTILE.replaceAll("`", "\u02CB"));
});

test.each([
  ["1000 backticks", "`".repeat(1000)],
  ["1000 emoji", "😀".repeat(1000)],
  ["oversized stored text", "😀".repeat(3000)],
])("the code block fits the embed limit with %s", (_case, content) => {
  const embed = buildFeedbackEmbed(
    { ...BASE, content },
    { username: "tzuyu", guildName: "ONCE" },
  ).toJSON();

  const description = embed.description ?? "";
  expect(description.length).toBeLessThanOrEqual(4096);
  expect(description.endsWith("\n```")).toBe(true);
  expect(description).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test("reporter and server names are markdown-escaped", () => {
  const embed = buildFeedbackEmbed(BASE, {
    username: "__under__",
    guildName: "*star* [x](https://evil.example)",
  }).toJSON();

  expect(embed.fields?.[1].value).toBe(
    "<@150443906511667200> \\_\\_under\\_\\_ (150443906511667200)",
  );
  expect(embed.fields?.[2].value).toBe(
    "\\*star\\* \\[x](https://evil.example) (167058919611564043)",
  );
});

describe("FeedbackWebhookPublisher", () => {
  const logger = { info: mock(() => undefined) } as unknown as Logger;
  const reporter = { username: "tzuyu", guildName: "ONCE" };

  test("skips without a client", async () => {
    const publisher = new FeedbackWebhookPublisher(null, logger);

    expect(await publisher.publish(BASE, reporter)).toBe("not_configured");
    expect(logger.info).toHaveBeenCalledWith(
      { feedbackId: BASE.id },
      "FEEDBACK_WEBHOOK_URL not set, skipping feedback post",
    );
  });

  test("sends the embed with mentions disabled", async () => {
    const send = mock(() => Promise.resolve({} as never));
    const publisher = new FeedbackWebhookPublisher({ send }, logger);

    expect(await publisher.publish(BASE, reporter)).toBe("published");
    expect(send).toHaveBeenCalledWith({
      username: "sushii feedback",
      embeds: [expect.any(EmbedBuilder)],
      allowedMentions: { parse: [] },
    });
  });
});
