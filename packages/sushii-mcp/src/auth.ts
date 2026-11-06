import { createHash, timingSafeEqual } from "node:crypto";

function sameToken(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function checkBearerToken(req: Request, token: string): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return false;
  }

  return sameToken(parts[1], token);
}
