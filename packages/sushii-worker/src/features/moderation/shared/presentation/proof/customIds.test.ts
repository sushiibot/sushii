import { describe, expect, test } from "bun:test";

import { encodeCaseIds } from "@/features/moderation/actions/presentation/response/customIds";

import {
  ADD_PROOF_PREFIX,
  buildAddProofCustomId,
  parseAddProofCustomId,
} from "./customIds";

function spreadCaseIds(count: number, digits: number): string[] {
  const base = 10 ** (digits - 1);
  return Array.from({ length: count }, (_, i) => `${base + i * 2}`);
}

describe("add proof custom ID", () => {
  test("round-trips case runs", () => {
    const customId = buildAddProofCustomId(["4830", "4822", "4823", "4824"]);

    expect(customId).toBe(`${ADD_PROOF_PREFIX}4822-4824,4830`);
    expect(parseAddProofCustomId(customId)).toEqual([
      "4822",
      "4823",
      "4824",
      "4830",
    ]);
  });

  test("round-trips a single case", () => {
    expect(parseAddProofCustomId(buildAddProofCustomId(["7"]))).toEqual(["7"]);
  });

  test("rejects other ids and malformed cases", () => {
    expect(parseAddProofCustomId("modAction/reason/edit/1")).toBeNull();
    expect(parseAddProofCustomId(`${ADD_PROOF_PREFIX}`)).toBeNull();
    expect(parseAddProofCustomId(`${ADD_PROOF_PREFIX}0`)).toBeNull();
    expect(parseAddProofCustomId(`${ADD_PROOF_PREFIX}5-3`)).toBeNull();
    expect(parseAddProofCustomId(`${ADD_PROOF_PREFIX}1-26`)).toBeNull();
  });

  test("fits 25 consecutive 15-digit cases", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `${10 ** 14 + i}`);
    const customId = buildAddProofCustomId(ids);

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseAddProofCustomId(customId)).toEqual(ids);
  });

  // 25 separate 15-digit runs need 399 characters, more than any custom ID holds.
  test("throws a clear error for 25 non-consecutive 15-digit cases", () => {
    const ids = spreadCaseIds(25, 15);

    expect(encodeCaseIds(ids)).toBeNull();
    expect(() => buildAddProofCustomId(ids)).toThrow(
      "Add proof custom ID exceeds 100 characters",
    );
  });

  test("builds for every case set the action response can encode", () => {
    for (const digits of [4, 6, 10, 15]) {
      for (let count = 1; count <= 25; count++) {
        const ids = spreadCaseIds(count, digits);
        if (encodeCaseIds(ids) === null) {
          continue;
        }

        const customId = buildAddProofCustomId(ids);
        expect(customId.length).toBeLessThanOrEqual(100);
        expect(parseAddProofCustomId(customId)).toEqual(ids);
      }
    }
  });

  test("throws instead of dropping invalid case IDs", () => {
    expect(() => buildAddProofCustomId(["4822", "abc"])).toThrow(
      "Add proof custom ID can't encode every case ID",
    );
    expect(() => buildAddProofCustomId(["4822", "0"])).toThrow();
    expect(() => buildAddProofCustomId(["4822", "04823"])).toThrow();
  });

  test("allows duplicate case IDs", () => {
    expect(buildAddProofCustomId(["5", "5", "6"])).toBe(
      `${ADD_PROOF_PREFIX}5-6`,
    );
  });

  test("throws without case IDs", () => {
    expect(() => buildAddProofCustomId([])).toThrow();
  });
});
