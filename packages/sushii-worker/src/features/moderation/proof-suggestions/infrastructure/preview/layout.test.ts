import { describe, expect, test } from "bun:test";

import { type DividerRow, type MessageRow, selectRows } from "./layout";
import {
  SPAMBOT_ID,
  alice,
  bob,
  msg,
  postIt,
  request,
  spamFixture,
  spambot,
  vega,
} from "./testFixtures";

const messages = (rows: ReturnType<typeof selectRows>) =>
  rows.filter((r): r is MessageRow => r.kind === "message");
const dividers = (rows: ReturnType<typeof selectRows>) =>
  rows.filter((r): r is DividerRow => r.kind === "divider");

describe("selectRows", () => {
  test("keeps at most two context messages before, between and after targets", () => {
    const rows = selectRows(
      request([
        msg(alice, "18:00:00", "a1"),
        msg(bob, "18:01:00", "b1"),
        msg(vega, "18:02:00", "v1"),
        msg(spambot, "18:03:00", "spam 1"),
        msg(alice, "18:04:00", "a2"),
        msg(bob, "18:05:00", "b2"),
        msg(spambot, "18:06:00", "spam 2"),
        msg(alice, "18:07:00", "a3"),
        msg(bob, "18:08:00", "b3"),
        msg(vega, "18:09:00", "v3"),
      ]),
    );

    expect(messages(rows).map((r) => r.message.content)).toEqual([
      "b1",
      "v1",
      "spam 1",
      "a2",
      "b2",
      "spam 2",
      "a3",
      "b3",
    ]);
    expect(dividers(rows)).toHaveLength(0);
  });

  test("folds a longer context run into a divider with its count and span", () => {
    const rows = selectRows(
      request([
        msg(spambot, "18:00:00", "spam 1"),
        msg(alice, "18:01:00", "first reply"),
        ...Array.from({ length: 14 }, (_, i) =>
          msg(i % 2 ? alice : bob, `18:0${2 + Math.floor(i / 3)}:00`, `c${i}`),
        ),
        msg(vega, "18:08:00", "last before"),
        msg(spambot, "18:09:00", "spam 2"),
      ]),
    );

    expect(
      rows.map((r) => (r.kind === "message" ? r.message.content : r.type)),
    ).toEqual(["spam 1", "first reply", "context", "last before", "spam 2"]);
    expect(dividers(rows)[0]).toEqual({
      kind: "divider",
      type: "context",
      count: 14,
      minutes: 4,
    });
  });

  test("collapses identical consecutive target messages with a time range", () => {
    const rows = selectRows(
      request([
        msg(spambot, "18:29:00", "FREE NITRO", { deleted: true }),
        msg(spambot, "18:29:30", "FREE NITRO", { deleted: true }),
        msg(spambot, "18:30:10", "FREE NITRO", { deleted: true }),
        msg(spambot, "18:30:20", "FREE NITRO", { deleted: false }),
        msg(alice, "18:30:30", "FREE NITRO"),
      ]),
    );

    const rowsOut = messages(rows);
    expect(rowsOut.map((r) => r.count)).toEqual([3, 1, 1]);
    expect(rowsOut[0].firstAt.toISOString()).toBe("2026-11-10T18:29:00.000Z");
    expect(rowsOut[0].lastAt.toISOString()).toBe("2026-11-10T18:30:10.000Z");
    expect(rowsOut[2].isTarget).toBe(false);
  });

  test("keeps the newest 8 target rows and counts the rest as hidden earlier", () => {
    const rows = selectRows(
      request(
        [
          msg(alice, "18:00:00", "hello"),
          ...Array.from({ length: 12 }, (_, i) =>
            msg(
              spambot,
              `18:${String(10 + i).padStart(2, "0")}:00`,
              `spam ${i}`,
            ),
          ),
        ],
        { hiddenEarlierCount: 200 },
      ),
    );

    const targets = messages(rows).filter((r) => r.isTarget);
    expect(targets).toHaveLength(8);
    expect(targets[0].message.content).toBe("spam 4");
    expect(rows[0]).toEqual({
      kind: "divider",
      type: "earlier",
      count: 204,
      name: "spambot",
    });
    expect(messages(rows).some((r) => r.message.content === "hello")).toBe(
      false,
    );
  });

  test("counts collapsed messages in the hidden total", () => {
    const rows = selectRows(spamFixture());
    const targets = messages(rows).filter((r) => r.isTarget);
    const shown = targets.reduce((sum, r) => sum + r.count, 0);
    const hidden = dividers(rows).find((d) => d.type === "earlier")?.count ?? 0;

    expect(targets).toHaveLength(8);
    expect(shown + hidden).toBe(215);
  });

  test("treats app responses triggered by the target as target rows", () => {
    const triggered = { triggeredBy: "spambot", triggeredById: SPAMBOT_ID };
    const rows = selectRows(
      request([
        msg(alice, "18:32:00", "teaser"),
        msg(postIt, "18:33:00", "leak", triggered),
      ]),
    );
    expect(messages(rows).map((r) => r.isTarget)).toEqual([false, true]);
    expect(
      selectRows(
        request([msg(postIt, "18:33:00", "leak", triggered)], {
          hiddenEarlierCount: 2,
        }),
      )[0],
    ).toEqual({ kind: "divider", type: "earlier", count: 2, name: "spambot" });
  });

  test("does not treat app replies to other members as target rows", () => {
    const rows = selectRows(
      request(
        [
          msg(postIt, "18:33:00", "reply to alice", {
            triggeredBy: "alice",
            triggeredById: alice.id,
          }),
          msg(spambot, "18:34:00", "spam"),
        ],
        { hiddenEarlierCount: 1 },
      ),
    );
    expect(messages(rows).map((r) => r.isTarget)).toEqual([false, true]);
    expect(dividers(rows)[0]).toMatchObject({ name: "spambot" });
  });

  test("names the target from their own app reply, not another member's", () => {
    const rows = selectRows(
      request(
        [
          msg(postIt, "18:33:00", "reply to alice", {
            triggeredBy: "alice",
            triggeredById: alice.id,
          }),
          msg(postIt, "18:34:00", "reply to spambot", {
            triggeredBy: "spambot",
            triggeredById: SPAMBOT_ID,
          }),
        ],
        { hiddenEarlierCount: 1 },
      ),
    );
    expect(messages(rows).map((r) => r.isTarget)).toEqual([false, true]);
    expect(dividers(rows)[0]).toEqual({
      kind: "divider",
      type: "earlier",
      count: 1,
      name: "spambot",
    });
  });

  test("shows the last context messages when no target message is left", () => {
    const rows = selectRows(
      request(
        ["a", "b", "c", "d", "e"].map((content, i) =>
          msg(i % 2 ? alice : bob, `18:0${i}:00`, content),
        ),
      ),
    );

    expect(dividers(rows)).toEqual([]);
    expect(messages(rows).map((r) => r.message.content)).toEqual([
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  test("keeps the earlier divider when no target message is left", () => {
    const rows = selectRows(
      request([msg(alice, "18:00:00", "a")], { hiddenEarlierCount: 5 }),
    );

    expect(rows[0]).toEqual({
      kind: "divider",
      type: "earlier",
      count: 5,
      name: "user",
    });
    expect(messages(rows)).toHaveLength(1);
  });

  test("returns nothing for an empty request", () => {
    expect(selectRows(request([]))).toEqual([]);
  });
});
