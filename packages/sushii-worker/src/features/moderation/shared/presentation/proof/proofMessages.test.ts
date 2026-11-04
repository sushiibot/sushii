import { describe, expect, test } from "bun:test";

import {
  partialProofText,
  proofErrorText,
  typedBackText,
} from "./proofMessages";

const CONTEXT = {
  emptyHint: "Fill in Details.",
  maxFileBytes: 10 * 1024 * 1024,
};

describe("typedBackText", () => {
  test("escapes markdown in what was typed before quoting it", () => {
    expect(typedBackText("**bold** [link](https://x.y)\n# head")).toBe(
      "\n-# Nothing was saved. What you typed:\n> \\*\\*bold\\*\\* \\[link](https://x.y)\n> \\# head",
    );
  });

  test("nothing for empty text", () => {
    expect(typedBackText("  ")).toBe("");
    expect(typedBackText(null)).toBe("");
  });
});

describe("proofErrorText", () => {
  test("refusals quote the typed text back; empty doesn't", () => {
    expect(
      proofErrorText("too_many_files", { ...CONTEXT, typed: "context" }),
    ).toContain("> context");
    expect(proofErrorText("empty", { ...CONTEXT, typed: "x" })).not.toContain(
      "What you typed",
    );
  });

  test("a too-large file states the limit", () => {
    expect(proofErrorText("file_too_large", CONTEXT)).toContain(
      "The limit here is 10 MB.",
    );
  });
});

describe("partialProofText", () => {
  test("points each retryable case at its own entry, not the shared button", () => {
    const text = partialProofText(
      ["4822"],
      [
        { caseId: "4823", reason: "failed" },
        { caseId: "4824", reason: "retry_later" },
      ],
    );
    expect(text).toContain(
      "-# Case #4823: something went wrong. Add it again from Case #4823's mod log entry or case view.",
    );
    expect(text).toContain(
      "-# Case #4824: its mod log entry is still being posted. Add it again from Case #4824's mod log entry or case view.",
    );
  });
});
