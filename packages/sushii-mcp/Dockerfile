FROM oven/bun:1 AS base

WORKDIR /app

# Copy the entire monorepo so the lockfile and all workspace packages resolve
COPY package.json bun.lock ./
COPY packages/sushii-worker/package.json ./packages/sushii-worker/
COPY packages/sushii-mcp/package.json ./packages/sushii-mcp/

RUN bun install --frozen-lockfile --ignore-scripts

# Runtime imports from the worker schema use its TypeScript path aliases.
COPY tsconfig.json ./
COPY packages/sushii-worker/tsconfig.json ./packages/sushii-worker/
COPY packages/sushii-mcp/tsconfig.json ./packages/sushii-mcp/

# Copy source after deps are installed
COPY packages/sushii-worker/src ./packages/sushii-worker/src
COPY packages/sushii-mcp/src ./packages/sushii-mcp/src

WORKDIR /app/packages/sushii-mcp

# Exercise the shared runtime imports without database credentials.
RUN bun -e 'await import("@sushiibot/sushii-worker/schema"); await import("@sushiibot/sushii-worker/logRedaction")'

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:" + (process.env.PORT || "3100") + "/health"); process.exit(r.ok ? 0 : 1)'

CMD ["bun", "src/index.ts"]
