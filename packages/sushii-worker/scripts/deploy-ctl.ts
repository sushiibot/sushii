#!/usr/bin/env bun

const DEFAULT_ENDPOINT = "http://localhost:9090";

interface StatusResponse {
  this_deployment: string;
  active_deployment: string;
  is_active: boolean;
  ready_to_switch: boolean;
  health: string;
  clusters: { id: number; ready: boolean; shards: number[] }[];
  total_shards: number;
}

interface SwitchResponse {
  success: boolean;
  no_op?: boolean;
  previous_deployment?: string;
  new_deployment?: string;
  error?: string;
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
      if (i >= args.length) {
        console.error("Error: --endpoint requires a URL argument");
        process.exit(1);
      }
      endpoint = args[i];
    } else if (!command) {
      command = arg;
    } else if (!commandArg) {
      commandArg = arg;
    } else if (arg.startsWith("--")) {
      console.error(`Error: Unknown flag '${arg}'`);
      printUsage();
      process.exit(1);
    }
    i++;
  }

  return { command, commandArg, endpoint };
}

async function cmdStatus(endpoint: string, fetchFn: typeof fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchFn(`${endpoint}/deployment/status`);
  } catch (err) {
    console.error(`Error: Could not connect to ${endpoint} — ${(err as Error).message}`);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Error: Status request failed (HTTP ${res.status})`);
    process.exit(1);
  }

  let body: StatusResponse;
  try {
    body = (await res.json()) as StatusResponse;
  } catch (err) {
    console.error(
      `Error: Invalid JSON response from ${endpoint} — ${(err as Error).message}`,
    );
    process.exit(1);
  }

  console.log(`Active deployment : ${body.active_deployment}`);
  console.log(`This instance     : ${body.this_deployment}`);
  console.log(`Is active         : ${body.is_active}`);
  console.log(`Ready to switch   : ${body.ready_to_switch}`);
  console.log(`Health            : ${body.health}`);
  console.log(`Total shards      : ${body.total_shards}`);
  console.log("Clusters:");
  for (const cluster of body.clusters) {
    console.log(`  [${cluster.id}] ready=${cluster.ready} shards=${cluster.shards.join(",")}`);
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
    console.error(`Error: Invalid color '${target}'. Must be 'blue' or 'green'.`);
    printUsage();
    process.exit(1);
  }

  let res: Response;
  try {
    res = await fetchFn(`${endpoint}/deployment/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
  } catch (err) {
    console.error(`Error: Could not connect to ${endpoint} — ${(err as Error).message}`);
    process.exit(1);
  }

  let body: SwitchResponse;
  try {
    body = (await res.json()) as SwitchResponse;
  } catch (err) {
    console.error(
      `Error: Invalid JSON response from ${endpoint} — ${(err as Error).message}`,
    );
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Error: Switch failed (HTTP ${res.status})`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

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

  if (command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (!command) {
    printUsage();
    process.exit(1);
  }

  switch (command) {
    case "status":
      await cmdStatus(endpoint, fetchFn);
      break;
    case "switch":
      if (!commandArg) {
        console.error("Error: 'switch' requires a color argument (blue or green).");
        printUsage();
        process.exit(1);
      }
      await cmdSwitch(commandArg, endpoint, fetchFn);
      break;
    default:
      console.error(`Error: Unknown command '${command}'.`);
      printUsage();
      process.exit(1);
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
