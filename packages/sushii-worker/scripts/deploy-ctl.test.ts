import { describe, expect, test } from "bun:test";
import { main } from "./deploy-ctl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class ExitCalled extends Error {
  constructor(readonly code: number) {
    super(`ExitCalled(${code})`);
  }
}

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTextResponse(status: number, body: string, contentType = "text/plain"): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

async function runCli(
  args: string[],
  fetchImpl: FetchImpl,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = -1;

  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: unknown[]) => stdout.push(a.join(" "));
  console.error = (...a: unknown[]) => stderr.push(a.join(" "));

  const origExit = process.exit;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new ExitCalled(code ?? 0);
  }) as typeof process.exit;

  try {
    await main(args, fetchImpl as typeof fetch);
  } catch (err) {
    if (err instanceof ExitCalled) {
      exitCode = err.code;
    } else {
      throw err;
    }
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }

  return { exitCode, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

// ---------------------------------------------------------------------------
// argument parsing tests
// ---------------------------------------------------------------------------

describe("deploy-ctl argument parsing", () => {
  const noFetch = async () => makeResponse(200, {});

  test("no command → exit 1 and prints usage", async () => {
    const { exitCode, stdout } = await runCli([], noFetch);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage:");
  });

  test("unknown command → exit 1 with 'Unknown command' in stderr", async () => {
    const { exitCode, stderr } = await runCli(["deploy"], noFetch);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });
});

// ---------------------------------------------------------------------------
// status command tests
// ---------------------------------------------------------------------------

describe("deploy-ctl status", () => {
  const healthyResponse = {
    this_deployment: "blue",
    active_deployment: "blue",
    is_active: true,
    ready_to_switch: true,
    health: "healthy",
    total_shards: 2,
    clusters: [{ id: 0, ready: true, shards: [0, 1] }],
  };

  test("healthy deployment → exit 0 and prints status", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(200, healthyResponse);

    const { exitCode, stdout } = await runCli(["status"], fetchImpl);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Active deployment : blue");
    expect(stdout).toContain("Health            : healthy");
  });

  test("unhealthy deployment → exit 1", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(200, { ...healthyResponse, health: "unhealthy", ready_to_switch: false });

    const { exitCode } = await runCli(["status"], fetchImpl);

    expect(exitCode).toBe(1);
  });

  test("unreachable endpoint → exit 1 with error message", async () => {
    const fetchImpl = async (_url: string | URL | Request): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };

    const { exitCode, stderr } = await runCli(["status"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Could not connect");
  });

  test("--endpoint overrides the default URL", async () => {
    const seenUrls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      seenUrls.push(url.toString());
      return makeResponse(200, healthyResponse);
    };

    await runCli(["status", "--endpoint", "http://host:1234"], fetchImpl);

    expect(seenUrls[0]).toBe("http://host:1234/deployment/status");
  });

  test("prints cluster rows with id, ready, and shards", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(200, healthyResponse);

    const { stdout } = await runCli(["status"], fetchImpl);

    expect(stdout).toContain("[0]");
    expect(stdout).toContain("ready=true");
    expect(stdout).toContain("shards=0,1");
  });

  test("handles missing cluster shards gracefully", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(200, {
        ...healthyResponse,
        clusters: [{ id: 0, ready: true, shards: undefined }],
      });

    // Should not throw
    const { exitCode } = await runCli(["status"], fetchImpl);
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// switch command tests
// ---------------------------------------------------------------------------

describe("deploy-ctl switch", () => {
  test("successful 200 response → exit 0", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(200, { success: true, previous_deployment: "green", new_deployment: "blue" });

    const { exitCode, stdout } = await runCli(["switch", "blue"], fetchImpl);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("green → blue");
  });

  test("no-op 200 response → exit 0 with no-op message", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(200, { success: true, no_op: true });

    const { exitCode, stdout } = await runCli(["switch", "blue"], fetchImpl);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No-op");
  });

  test("non-2xx response → exit 1", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(500, { error: "Failed to switch deployment" });

    const { exitCode, stderr } = await runCli(["switch", "blue"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Request failed");
  });

  test("non-JSON error response (e.g. nginx 502 HTML) → exit 1 with HTTP status", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeTextResponse(502, "<html><body>Bad Gateway</body></html>", "text/html");

    const { exitCode, stderr } = await runCli(["switch", "blue"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Request failed (HTTP 502)");
  });

  test("unreachable endpoint → exit 1 with error message", async () => {
    const fetchImpl = async (_url: string | URL | Request): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };

    const { exitCode, stderr } = await runCli(["switch", "blue"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Could not connect");
  });

  test("--endpoint overrides the default URL", async () => {
    const seenUrls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, _init?: RequestInit) => {
      seenUrls.push(url.toString());
      return makeResponse(200, { success: true, previous_deployment: "green", new_deployment: "blue" });
    };

    await runCli(["switch", "blue", "--endpoint", "http://host:1234"], fetchImpl);

    expect(seenUrls[0]).toBe("http://host:1234/deployment/switch");
  });

  test("switch without color argument → exit 1", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(200, {});

    const { exitCode, stderr } = await runCli(["switch"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("requires a color argument");
  });

  test("switch with invalid color → exit 1", async () => {
    const fetchImpl = async (_url: string | URL | Request) =>
      makeResponse(200, {});

    const { exitCode, stderr } = await runCli(["switch", "red"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid color");
  });
});
