import { readFileSync } from "node:fs";

import { env } from "$env/dynamic/private";

function token(): string {
  const file = env.ANALYTICS_AUTH_TOKEN_FILE;
  const value = file
    ? readFileSync(file, "utf8").trimEnd()
    : env.ANALYTICS_AUTH_TOKEN;
  if (!value) {
    throw new Error("ANALYTICS_AUTH_TOKEN is not set");
  }
  return value;
}

export async function fetchView<T>(view: string): Promise<T[]> {
  const baseUrl = env.ANALYTICS_API_URL;
  if (!baseUrl) {
    throw new Error("ANALYTICS_API_URL is not set");
  }

  const res = await fetch(`${baseUrl}/analytics/${view}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    throw new Error(`Analytics view ${view} returned ${res.status}`);
  }
  return res.json() as Promise<T[]>;
}
