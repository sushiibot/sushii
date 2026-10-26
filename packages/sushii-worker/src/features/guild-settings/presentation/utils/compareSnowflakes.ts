export function compareSnowflakes(a: string, b: string): number {
  const diff = BigInt(a) - BigInt(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}
