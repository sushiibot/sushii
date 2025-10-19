FROM oven/bun:1 AS base

LABEL org.opencontainers.image.source=https://github.com/sushiibot/sushii
LABEL org.opencontainers.image.description="Discord.js API Proxy"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /usr/proxy-container

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/

# Use base image user for non-root execution
USER bun

# Expose port
EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]