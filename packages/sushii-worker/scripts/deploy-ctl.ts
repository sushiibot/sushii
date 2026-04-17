#!/usr/bin/env bun

const DEFAULT_ENDPOINT = "http://localhost:9090";

interface ShardInfo {
  id: number;
  status: number;
  status_name: string;
  ping_ms: number;
}

interface Checks {
  clusters: "pass" | "fail";
  database: "pass" | "fail";
  shards: "pass" | "fail";
  uptime?: "pass" | "fail";
}

interface MemoryInfo {
  heap_used_mb: number;
  rss_mb: number;
}

interface StatusResponse {
  this_deployment: string;
  active_deployment: string;
  is_active: boolean;
  ready_to_switch: boolean;
  health: string;
  uptime_seconds?: number;
  checks?: Checks;
  clusters: { id: number; ready: boolean; shards: number[] }[];
  shards?: ShardInfo[];
  total_shards: number;
  memory?: MemoryInfo;
}

interface SwitchResponse {
  no_op?: boolean;
  previous_deployment?: string;
  new_deployment?: string;
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function printUsage(): void {
  console.log(`Usage: deploy-ctl <command> [options]

Commands:
  status              Query deployment status
  switch <blue|green> Switch the active deployment slot

Options:
  --endpoint <url>    API endpoint (default: ${DEFAULT_ENDPOINT})

Examples:
  deploy-ctl status
  deploy-ctl status --endpoint http://host:9090
  deploy-ctl switch blue
  deploy-ctl switch green --endpoint http://host:9090`);
}

export function parseArgs(args: string[]): {
  command: string | undefined;
  commandArg: string | undefined;
  endpoint: string;
} {
  // Handle --help / -h anywhere in the args list
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  let command: string | undefined;
  let commandArg: string | undefined;
  let endpoint = DEFAULT_ENDPOINT;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--endpoint") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        fail("Error: --endpoint requires a URL argument");
      }
      endpoint = args[i].trim().replace(/\/+$/, "");
    } else if (arg.startsWith("--")) {
      printUsage();
      fail(`Error: Unknown flag '${arg}'`);
    } else if (!command) {
      command = arg;
    } else if (!commandArg) {
      commandArg = arg;
    } else {
      fail(`Error: Unexpected argument '${arg}'`);
    }
    i++;
  }

  return { command, commandArg, endpoint };
}

async function fetchJson<T>(
  url: string,
  endpoint: string,
  fetchFn: typeof fetch,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (err) {
    fail(`Error: Could not connect to ${endpoint} — ${(err as Error).message}`);
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    console.error(`Error: Request failed (HTTP ${res.status})`);
    if (text) {
      try {
        const errBody = JSON.parse(text) as { error?: string };
        if (errBody.error) {
          console.error(errBody.error);
        } else {
          console.error(text);
        }
      } catch {
        console.error(text);
      }
    }
    process.exit(1);
    return undefined as never;
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    fail(`Error: Invalid JSON response from ${endpoint} — ${(err as Error).message}`);
  }
}

async function cmdStatus(endpoint: string, fetchFn: typeof fetch): Promise<void> {
  const body = await fetchJson<StatusResponse>(`${endpoint}/deployment/status`, endpoint, fetchFn);

  console.log(`Active deployment : ${body.active_deployment}`);
  console.log(`This instance     : ${body.this_deployment}`);
  console.log(`Is active         : ${body.is_active}`);
  console.log(`Ready to switch   : ${body.ready_to_switch}`);
  console.log(`Health            : ${body.health}`);
  if (body.uptime_seconds !== undefined) {
    console.log(`Uptime            : ${Math.floor(body.uptime_seconds)}s`);
  }

  if (body.checks) {
    console.log("Checks:");
    console.log(`  clusters : ${body.checks.clusters}`);
    console.log(`  database : ${body.checks.database}`);
    console.log(`  shards   : ${body.checks.shards}`);
    if (body.checks.uptime !== undefined) {
      console.log(`  uptime   : ${body.checks.uptime}`);
    }
  }

  console.log(`Total shards      : ${body.total_shards}`);

  if (Array.isArray(body.clusters) && body.clusters.length > 0) {
    console.log("Clusters:");
    for (const cluster of body.clusters) {
      console.log(`  [${cluster.id}] ready=${cluster.ready} shards=${(cluster.shards ?? []).join(",")}`);
    }
  } else {
    console.log("Clusters: (none)");
  }

  if (Array.isArray(body.shards) && body.shards.length > 0) {
    console.log("Shards:");
    for (const shard of body.shards) {
      console.log(`  [${shard.id}] ${shard.status_name} ${shard.ping_ms}ms`);
    }
  }

  if (body.memory) {
    console.log(`Memory            : heap ${body.memory.heap_used_mb}MB  rss ${body.memory.rss_mb}MB`);
  }

  if (body.health !== "healthy") {
    process.exit(1);
  }
}

async function cmdSwitch(
  target: string,
  endpoint: string,
  fetchFn: typeof fetch,
): Promise<void> {
  if (target !== "blue" && target !== "green") {
    printUsage();
    fail(`Error: Invalid color '${target}'. Must be 'blue' or 'green'.`);
  }

  const body = await fetchJson<SwitchResponse>(`${endpoint}/deployment/switch`, endpoint, fetchFn, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });

  if (body.no_op) {
    console.log(`No-op: '${target}' is already the active deployment.`);
  } else {
    console.log(`Switched: ${body.previous_deployment} → ${body.new_deployment}`);
  }
}

export async function main(
  args: string[],
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const { command, commandArg, endpoint } = parseArgs(args);

  if (!command) {
    printUsage();
    fail("Error: No command specified.");
  }

  switch (command) {
    case "status":
      await cmdStatus(endpoint, fetchFn);
      break;
    case "switch":
      if (!commandArg) {
        printUsage();
        fail("Error: 'switch' requires a color argument (blue or green).");
      }
      await cmdSwitch(commandArg, endpoint, fetchFn);
      break;
    default:
      printUsage();
      fail(`Error: Unknown command '${command}'.`);
  }

  process.exit(0);
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
