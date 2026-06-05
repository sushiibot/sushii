import { describe, expect, it } from "bun:test";

import { buildHashKey, toSignedBigint, toUnsignedBigint } from "./bigintUtils";

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

describe("buildHashKey", () => {
  it("sorts numerically ascending (not lexicographic)", () => {
    // 10 > 9 numerically but "10" < "9" lexicographically
    const a = 10n;
    const b = 9n;
    const key = buildHashKey([a, b]);
    expect(key).toBe("9|10");
  });

  it("produces stable output regardless of input order", () => {
    const hashes = [42n, 1n, 100n];
    expect(buildHashKey(hashes)).toBe(buildHashKey([...hashes].reverse()));
  });

  it("handles negative (signed) values correctly", () => {
    // 0xFFFF...FFFF = -1 as signed
    const neg1 = toSignedBigint(0xffff_ffff_ffff_ffffn); // -1n
    const pos1 = 1n;
    const key = buildHashKey([0xffff_ffff_ffff_ffffn, pos1]);
    // -1 < 1, so -1 comes first
    expect(key).toBe(`${neg1}|${pos1}`);
  });

  it("handles mixed-sign inputs with stable ordering", () => {
    // u64 values that become negative signed: 0x8000...0000 = -2^63
    const big = 0x8000_0000_0000_0000n; // becomes -9223372036854775808n signed
    const small = 1n;
    const key = buildHashKey([big, small]);
    const signed = toSignedBigint(big).toString(10);
    expect(key).toBe(`${signed}|1`);
  });

  it("preserves duplicate hashes", () => {
    // Same hash appears twice — both should appear in key
    const key = buildHashKey([5n, 5n]);
    expect(key).toBe("5|5");
  });
});

