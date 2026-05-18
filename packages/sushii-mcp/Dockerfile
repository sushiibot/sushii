FROM oven/bun:1 AS base

WORKDIR /app

# Copy the entire monorepo so the lockfile and all workspace packages resolve
COPY package.json bun.lock ./
COPY packages/sushii-worker/package.json ./packages/sushii-worker/
COPY packages/sushii-mcp/package.json ./packages/sushii-mcp/

RUN bun install --frozen-lockfile --ignore-scripts

# Copy source after deps are installed
COPY packages/sushii-worker/src ./packages/sushii-worker/src
COPY packages/sushii-mcp/src ./packages/sushii-mcp/src

WORKDIR /app/packages/sushii-mcp

CMD ["bun", "src/index.ts"]
