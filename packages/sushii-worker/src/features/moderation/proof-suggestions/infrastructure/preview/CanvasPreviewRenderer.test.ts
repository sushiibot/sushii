import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, test } from "bun:test";

import { AvatarResolver } from "./AvatarResolver";
import {
  CanvasPreviewRenderer,
  FOOTER_TEXT,
  MAX_HEIGHT,
  MAX_PENDING_RENDERS,
  PAD,
  PREVIEW_WIDTH,
  type Prepared,
  PreviewRendererBusyError,
  TEXT_W,
  dividerText,
  layoutHeader,
  planPreview,
  tagPillsWidth,
  truncate,
  withRenderSlot,
} from "./CanvasPreviewRenderer";
import { font } from "./fonts";
import {
  SPAMBOT_ID,
  alice,
  appResponseFixture,
  author,
  bob,
  koreanEmojiFixture,
  msg,
  request,
  spamFixture,
  spambot,
  vega,
} from "./testFixtures";

const cdnStub = {
  guildMemberAvatar: () => "member",
  avatar: () => "user",
  defaultAvatar: () => "default",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const renderer = new CanvasPreviewRenderer(
  new AvatarResolver(cdnStub, async () => new Response(null, { status: 404 })),
);

test("preview footer and dividers describe what is omitted", () => {
  expect(FOOTER_TEXT).toBe(
    "sushii preview from logged messages · not saved as proof",
  );
  expect(dividerText({ type: "context", count: 14, minutes: 5 })).toBe(
    "14 messages from others over 5 min",
  );
  expect(dividerText({ type: "earlier", count: 150, name: "spambot" })).toBe(
    "150 earlier messages from spambot not shown",
  );
  expect(
    dividerText({
      type: "cut",
      count: 25,
      earlier: { count: 12, name: "spambot" },
    }),
  ).toBe("25 earlier messages not shown (12 from spambot)");
});

async function expectPng(result: Awaited<ReturnType<typeof renderer.render>>) {
  expect(result.png.subarray(0, 4)).toEqual(PNG_SIGNATURE);
  expect(result.width).toBe(PREVIEW_WIDTH);
  expect(result.height).toBeGreaterThan(0);
  expect(result.height).toBeLessThanOrEqual(MAX_HEIGHT * 2);
  expect(result.png.readUInt32BE(16)).toBe(result.width);
  expect(result.png.readUInt32BE(20)).toBe(result.height);
}

describe("CanvasPreviewRenderer", () => {
  test("renders the 214-message spam fixture within the height cap", async () => {
    await expectPng(await renderer.render(spamFixture()));
  });

  test("renders Korean, emoji, spoilers and attachments", async () => {
    await expectPng(await renderer.render(koreanEmojiFixture()));
  });

  test("renders an app response with its trigger line", async () => {
    await expectPng(await renderer.render(appResponseFixture()));
  });

  test("cuts the oldest rows when long messages exceed the height cap", async () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const messages = Array.from({ length: 8 }, (_, i) => [
      msg(alice, `18:${10 + i}:00`, long),
      msg(spambot, `18:${10 + i}:30`, `${long}\n${i}`, { deleted: true }),
    ]).flat();

    await expectPng(await renderer.render(request(messages)));
  });

  test("runs concurrent renders without failing", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => renderer.render(appResponseFixture())),
    );
    for (const result of results) {
      await expectPng(result);
    }
  });

  test("reserves room for tag pills on the first line of grouped rows", () => {
    const long = "claim your free nitro now ".repeat(6);
    const { items } = planPreview(
      request([
        msg(spambot, "18:10:00", `${long}1`, { deleted: true }),
        msg(spambot, "18:10:05", `${long}2`, {
          deleted: true,
          automodFlagged: true,
        }),
      ]),
    );
    const grouped = items.find(
      (item): item is Extract<Prepared, { kind: "message" }> =>
        item.kind === "message" && item.grouped,
    );
    if (!grouped) {
      throw new Error("expected a grouped row");
    }
    const reserved = tagPillsWidth(
      createCanvas(1, 1).getContext("2d"),
      grouped.row,
    );
    const firstLine = grouped.lines[0].reduce((sum, run) => sum + run.width, 0);

    const fresh = createCanvas(1, 1).getContext("2d");
    fresh.font = font("Body", 15);
    for (const run of grouped.lines.flat().filter((r) => r.kind === "text")) {
      expect(run.width).toBeCloseTo(fresh.measureText(run.text).width, 3);
    }
    expect(reserved).toBeGreaterThan(0);
    expect(firstLine).toBeLessThanOrEqual(TEXT_W - reserved);
    expect(grouped.lines.length).toBeGreaterThan(1);
  });

  test.each([0, 12])(
    "counts all omitted messages and target messages after a height cut (hidden=%s)",
    (hidden) => {
      const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
      const messages = Array.from({ length: 8 }, (_, i) => [
        msg(alice, `18:${10 + i}:00`, long),
        msg(spambot, `18:${10 + i}:30`, `${long}\n${i}`, { deleted: true }),
      ]).flat();
      const { items, height } = planPreview(
        request(messages, { hiddenEarlierCount: hidden }),
      );
      const first = items[0];
      if (first.kind !== "divider") {
        throw new Error("expected a divider first");
      }

      expect(height).toBeLessThanOrEqual(MAX_HEIGHT);
      expect(first.divider).toMatchObject({
        type: "cut",
        earlier: { name: "spambot" },
      });
      expect(dividerText(first.divider)).toMatch(
        /^\d+ earlier messages not shown \(\d+ from spambot\)$/,
      );
      if (first.divider.type !== "cut") {
        throw new Error("expected cut");
      }
      const keptTargets = items.reduce(
        (n, item) =>
          n +
          (item.kind === "message" && item.row.isTarget ? item.row.count : 0),
        0,
      );
      expect(first.divider.earlier?.count).toBe(hidden + 8 - keptTargets);
      const keptMessages = items.reduce(
        (n, item) => n + (item.kind === "message" ? item.row.count : 0),
        0,
      );
      expect(first.divider.count).toBe(hidden + 16 - keptMessages);
      expect(items.filter((item) => item.kind === "divider")).toHaveLength(1);
    },
  );

  test("a long name doesn't push the count out of the cut divider", () => {
    expect(
      dividerText({
        type: "cut",
        count: 13,
        earlier: { count: 27, name: "W".repeat(32) },
      }),
    ).toStartWith("13 earlier messages not shown (27 from ");
  });

  test("renders 10 target and 10 context 4,000-char unbroken messages", async () => {
    const body = "A".repeat(4000);
    const messages = Array.from({ length: 10 }, (_, i) => [
      msg(spambot, `18:${10 + i}:00`, `${body}${i}`),
      msg(alice, `18:${10 + i}:30`, `${body}b${i}`),
    ]).flat();
    await expectPng(await renderer.render(request(messages)));
  });

  test("rejects renders beyond the pending limit", async () => {
    const { promise: gate, resolve: release } =
      Promise.withResolvers<undefined>();
    const blocking = new CanvasPreviewRenderer(
      new AvatarResolver(
        cdnStub,
        async () => {
          await gate;
          return new Response(null, { status: 404 });
        },
        { timeoutMs: 10_000 },
      ),
    );
    const slow = author(spambot.id, "spambot", { userAvatarHash: "abc" });
    const req = request([msg(slow, "18:00:00", "hi")]);

    const pending = Array.from({ length: MAX_PENDING_RENDERS }, () =>
      blocking.render(req),
    );
    await expect(blocking.render(req)).rejects.toBeInstanceOf(
      PreviewRendererBusyError,
    );

    release(undefined);
    for (const result of await Promise.all(pending)) {
      await expectPng(result);
    }
  });

  test("truncates only text that doesn't fit", () => {
    const ctx = createCanvas(1, 1).getContext("2d");
    ctx.font = font("Body", 15);

    expect(truncate(ctx, "spambot 😀", 200)).toBe("spambot 😀");
    const long = truncate(ctx, "😀".repeat(50_000), 200);
    expect(long.endsWith("…")).toBe(true);
    expect(ctx.measureText(long).width).toBeLessThanOrEqual(200);
  });

  test("renders an empty request and one without target messages", async () => {
    await expectPng(await renderer.render(request([])));
    await expectPng(
      await renderer.render(
        request([msg(alice, "18:00:00", "hi")], { hiddenEarlierCount: 3 }),
      ),
    );
  });

  test("never stacks two dividers after a height cut", () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const messages = Array.from({ length: 8 }, (_, i) => [
      msg(spambot, `18:${10 + i}:00`, `${long}\n${i}`, { deleted: true }),
      msg(alice, `18:${10 + i}:10`, "a"),
      msg(bob, `18:${10 + i}:20`, "b"),
      msg(vega, `18:${10 + i}:30`, "c"),
      msg(alice, `18:${10 + i}:40`, "d"),
    ]).flat();
    const { items, height } = planPreview(request(messages));

    expect(height).toBeLessThanOrEqual(MAX_HEIGHT);
    expect(items[0]).toMatchObject({ kind: "divider" });
    for (let i = 1; i < items.length; i++) {
      expect(
        items[i - 1].kind === "divider" && items[i].kind === "divider",
      ).toBe(false);
    }
  });

  describe("header", () => {
    const ctx = createCanvas(1, 1).getContext("2d");
    const longName = "W".repeat(38);
    const app = author("1012345678901234567", `${longName} Bot`, {
      isApp: true,
    });
    const flags = {
      deleted: true,
      automodFlagged: true,
      triggeredBy: "spammer",
      triggeredById: SPAMBOT_ID,
    };
    const headerOf = (messages: ReturnType<typeof msg>[]) => {
      const item = planPreview(request(messages)).items.find(
        (i): i is Extract<Prepared, { kind: "message" }> =>
          i.kind === "message" && !i.grouped,
      );
      if (!item) {
        throw new Error("expected a message row");
      }
      return layoutHeader(ctx, item.row, request(messages).actionTime);
    };

    test("shrinks the name so every pill stays inside the image", () => {
      const header = headerOf([
        msg(app, "18:28:00", "x", flags),
        msg(app, "18:29:00", "x", flags),
      ]);

      expect(header.parts.map((p) => p.label)).toEqual([
        "APP",
        "9–8m before",
        "×2",
        "DELETED",
        "AUTOMOD FLAGGED",
      ]);
      expect(header.name.endsWith("…")).toBe(true);
      expect(header.right).toBeLessThanOrEqual(PREVIEW_WIDTH / 2 - PAD);
    });

    test("fits a ×999 badge", () => {
      const header = headerOf(
        Array.from({ length: 999 }, () => msg(app, "18:28:00", "x", flags)),
      );

      expect(header.parts.some((p) => p.label === "×999")).toBe(true);
      expect(header.right).toBeLessThanOrEqual(PREVIEW_WIDTH / 2 - PAD);
    });

    test("leaves short names whole", () => {
      const header = headerOf([
        msg(spambot, "18:28:00", "x", { deleted: true }),
      ]);
      expect(header.name).toBe("spambot");
    });
  });
});

describe("render slots", () => {
  test("lets at most two renders draw at once", async () => {
    let active = 0;
    let maxActive = 0;
    const gates = Array.from({ length: 5 }, () =>
      Promise.withResolvers<undefined>(),
    );
    const started: number[] = [];
    const tasks = gates.map((gate, i) =>
      withRenderSlot(async () => {
        started.push(i);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active -= 1;
      }),
    );
    await Bun.sleep(0);
    expect(started).toEqual([0, 1]);

    gates[0].resolve(undefined);
    await Bun.sleep(0);
    expect(started).toEqual([0, 1, 2]);

    for (const gate of gates) {
      gate.resolve(undefined);
    }
    await Promise.all(tasks);
    expect(maxActive).toBe(2);
  });

  test("releases the slot when a render throws", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        withRenderSlot(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    }
    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) => withRenderSlot(async () => i)),
    );
    expect(results).toEqual([0, 1, 2]);
  });

  test("keeps rendering after many throwing renders", async () => {
    const bad = request([
      { ...msg(spambot, "18:00:00", "x"), createdAt: new Date("nope") },
    ]);
    for (let i = 0; i < 20; i++) {
      await expect(renderer.render(bad)).rejects.toThrow();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("render slots leaked")), 5_000);
    });
    const results = await Promise.race([
      Promise.all(
        Array.from({ length: 4 }, () => renderer.render(appResponseFixture())),
      ),
      timeout,
    ]).finally(() => clearTimeout(timer));
    for (const result of results) {
      await expectPng(result);
    }
  });
});
