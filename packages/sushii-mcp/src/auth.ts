export function checkBearerToken(req: Request, token: string): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return false;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return false;
  }

  return parts[1] === token;
}
