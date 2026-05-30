const U64_MAX = 0xffff_ffff_ffff_ffffn;
const U64_SIGN_BIT = 0x8000_0000_0000_0000n;
const U64_WRAP = 0x1_0000_0000_0000_0000n;

/** Convert an unsigned 64-bit bigint to signed two's-complement for PostgreSQL bigint storage. */
export function toSignedBigint(u64: bigint): bigint {
  if (u64 < 0n || u64 > U64_MAX) {
    throw new RangeError(`Value ${u64} is out of unsigned 64-bit range`);
  }
  return u64 >= U64_SIGN_BIT ? u64 - U64_WRAP : u64;
}

/** Convert a signed PostgreSQL bigint back to unsigned 64-bit bigint. */
export function toUnsignedBigint(s64: bigint): bigint {
  return s64 < 0n ? s64 + U64_WRAP : s64;
}
