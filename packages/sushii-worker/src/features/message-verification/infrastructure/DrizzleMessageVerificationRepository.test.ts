import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { generateCode } from "./DrizzleMessageVerificationRepository";

describe("generateCode", () => {
  let randomSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    randomSpy?.mockRestore();
    randomSpy = undefined;
  });

  test("produces 8 uppercase alphanumeric characters", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateCode()).toMatch(/^[A-Z0-9]{8}$/);
    }
  });

  test("does not use Math.random", () => {
    randomSpy = spyOn(Math, "random").mockReturnValue(0);

    const codes = new Set(Array.from({ length: 20 }, () => generateCode()));

    expect(randomSpy).not.toHaveBeenCalled();
    expect(codes.size).toBeGreaterThan(1);
  });
});
