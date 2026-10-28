import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function equalSecret(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function validSignature(
  body: Uint8Array,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return equalSecret(
    signature,
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
  );
}

export class TokenCipher {
  private readonly key: Buffer;
  constructor(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error(
        "Token encryption key must be 32 bytes encoded as lowercase hex",
      );
    this.key = Buffer.from(key, "hex");
  }
  encrypt(value: unknown, identity: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(identity));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64",
    );
  }
  decrypt<T>(value: string, identity: string): T {
    const bytes = Buffer.from(value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      bytes.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(identity));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
  }
}

export async function boundedBody(
  request: Request,
  limit = 2 * 1024 * 1024,
): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Request too large");
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel();
    throw err;
  }
  return Buffer.concat(chunks);
}
