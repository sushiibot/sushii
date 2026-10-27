import { describe, expect, test } from "bun:test";

import { findUnjustifiedDefers } from "./check-defer";

describe("findUnjustifiedDefers", () => {
  test("flags a defer with no justification", () => {
    const source = "async function f() {\n  await i.deferUpdate();\n}";
    expect(findUnjustifiedDefers("a.ts", source)).toEqual([
      { file: "a.ts", line: 2 },
    ]);
  });

  test("accepts a `// defer:` comment directly above", () => {
    const source =
      "// defer: posts to an external webhook that can be rate limited\nawait interaction.deferReply({ flags });";
    expect(findUnjustifiedDefers("a.ts", source)).toEqual([]);
  });

  test("accepts the justification anywhere in the comment block above", () => {
    const source =
      "// defer: fetches every guild member\n// which can take seconds on large guilds\nawait i.deferReply();";
    expect(findUnjustifiedDefers("a.ts", source)).toEqual([]);
  });

  test("a plain comment or a blank line doesn't count", () => {
    expect(
      findUnjustifiedDefers(
        "a.ts",
        "// acknowledge first\nawait i.deferUpdate();",
      ),
    ).toHaveLength(1);
    expect(
      findUnjustifiedDefers("a.ts", "// defer: slow\n\nawait i.deferUpdate();"),
    ).toHaveLength(1);
    expect(
      findUnjustifiedDefers("a.ts", "// defer:\nawait i.deferUpdate();"),
    ).toHaveLength(1);
  });

  test("ignores defers mentioned in comments", () => {
    expect(
      findUnjustifiedDefers("a.ts", "// never call i.deferUpdate() here"),
    ).toEqual([]);
  });
  test.each([
    ["optional call", "await i.deferUpdate?.();"],
    ["generic call", "await i.deferReply<true>({});"],
    ["space before the call", "await i.deferUpdate ();"],
    ["bracket access", 'await i["deferUpdate"]();'],
    ["bind", "const ack = i.deferUpdate.bind(i);"],
    ["call", "await i.deferReply.call(i);"],
    ["apply", "await i.deferUpdate.apply(i, []);"],
    ["destructuring", "const { deferReply } = i;"],
    ["renamed destructuring", "const { deferUpdate: ack } = i;"],
    ["assignment destructuring", "({ deferUpdate } = i);"],
    ["renamed assignment destructuring", "({ deferReply: ack } = i);"],
  ])("flags an unjustified %s", (_label, code) => {
    expect(findUnjustifiedDefers("a.ts", code)).toHaveLength(1);
    expect(
      findUnjustifiedDefers("a.ts", `// defer: slow external call\n${code}`),
    ).toEqual([]);
  });

  test("accepts a justification above a call that wraps onto the next line", () => {
    const source =
      "async function f() {\n  // defer: fetches every guild member\n  await interaction\n    .deferUpdate();\n}";
    expect(findUnjustifiedDefers("a.ts", source)).toEqual([]);
  });

  test("reports the line of the defer in a wrapped call", () => {
    const source =
      "async function f() {\n  await interaction\n    .deferUpdate();\n}";
    expect(findUnjustifiedDefers("a.ts", source)).toEqual([
      { file: "a.ts", line: 3 },
    ]);
  });

  test("ignores defers in strings and unrelated properties", () => {
    expect(
      findUnjustifiedDefers(
        "a.ts",
        'const s = "i.deferUpdate()";\nconst d = i.deferred;\nconst m = { deferUpdate: mock() };',
      ),
    ).toEqual([]);
  });

  describe("one comment justifies one statement", () => {
    const lines = (...l: string[]) => l.join("\n");

    test("a comment above a switch doesn't cover defers in its cases", () => {
      const source = lines(
        "// defer: fetches every guild member",
        "switch (kind) {",
        '  case "a":',
        "    await i.deferUpdate();",
        "    break;",
        "  default:",
        "    await i.deferReply();",
        "}",
      );
      expect(findUnjustifiedDefers("a.ts", source)).toEqual([
        { file: "a.ts", line: 4 },
        { file: "a.ts", line: 7 },
      ]);
    });

    test("each case can carry its own comment", () => {
      const source = lines(
        "switch (kind) {",
        '  case "a":',
        "    // defer: fetches every guild member",
        "    await i.deferUpdate();",
        "    break;",
        "  default:",
        "    // defer: ack-only, nothing changed",
        "    await i.deferReply();",
        "}",
      );
      expect(findUnjustifiedDefers("a.ts", source)).toEqual([]);
    });

    test("a comment above a class doesn't cover an arrow field", () => {
      const source = lines(
        "// defer: fetches every guild member",
        "class A {",
        "  ack = async (i) => {",
        "    await i.deferUpdate();",
        "  };",
        "}",
      );
      expect(findUnjustifiedDefers("a.ts", source)).toHaveLength(1);
    });

    test("a comment above an object literal doesn't cover a method", () => {
      const source = lines(
        "// defer: fetches every guild member",
        "const handlers = {",
        "  async ack(i) {",
        "    await i.deferUpdate();",
        "  },",
        "};",
      );
      expect(findUnjustifiedDefers("a.ts", source)).toHaveLength(1);
    });

    test("a comment above a call doesn't cover a defer in its callback", () => {
      const source = lines(
        "// defer: fetches every guild member",
        'collector.on("c", (i) =>',
        "  i.deferUpdate(),",
        ");",
      );
      expect(findUnjustifiedDefers("a.ts", source)).toEqual([
        { file: "a.ts", line: 3 },
      ]);
    });

    test("a comment directly above the defer's line still counts", () => {
      const source = lines(
        "// defer: fetches every guild member",
        'collector.on("c", (i) => i.deferUpdate());',
      );
      expect(findUnjustifiedDefers("a.ts", source)).toEqual([]);
    });
  });
});
