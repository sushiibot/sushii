import { describe, expect, it } from "bun:test";

import { toSignedBigint, toUnsignedBigint } from "./bigintUtils";

describe("toSignedBigint / toUnsignedBigint round-trip", () => {
  const cases: bigint[] = [
    0n,
    1n,
    0x7fff_ffff_ffff_ffffn, // max positive signed — no conversion needed
    0x8000_0000_0000_0000n, // sign bit — becomes -2^63
    0xffff_ffff_ffff_ffffn, // max u64 — becomes -1
  ];

  for (const u64 of cases) {
    it(`round-trips ${u64.toString(16)}`, () => {
      const signed = toSignedBigint(u64);
      const roundTripped = toUnsignedBigint(signed);
      expect(roundTripped).toBe(u64);
    });
  }

  it("maps 0xFFFF...FFFF to -1", () => {
    expect(toSignedBigint(0xffff_ffff_ffff_ffffn)).toBe(-1n);
  });

  it("maps 0x8000...0000 to -2^63", () => {
    expect(toSignedBigint(0x8000_0000_0000_0000n)).toBe(-(2n ** 63n));
  });

  it("leaves values below sign bit unchanged", () => {
    expect(toSignedBigint(42n)).toBe(42n);
  });

  it("throws on negative input", () => {
    expect(() => toSignedBigint(-1n)).toThrow(RangeError);
  });

  it("throws on input exceeding u64 max", () => {
    expect(() => toSignedBigint(0x1_0000_0000_0000_0000n)).toThrow(RangeError);
  });
});
