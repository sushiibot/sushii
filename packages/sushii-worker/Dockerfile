FROM oven/bun:1.2-debian

LABEL org.opencontainers.image.source=https://github.com/sushiibot/sushii
LABEL org.opencontainers.image.description="sushii bot"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

# Install curl and build dependencies for native modules
RUN apt-get update && apt-get install -y \
  curl \
  python3 \
  python3-dev \
  build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /config

# Root package.json and lockfile
COPY ./package.json ./bun.lockb ./

# Project specific package.json - only the workspace packages required
COPY ./packages/sushii-worker/package.json ./packages/sushii-worker/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code and stuff
COPY ./packages/sushii-worker/ ./packages/sushii-worker/

# Build info, args at end to minimize cache invalidation
ARG GIT_HASH
ARG BUILD_DATE

# Make build info available in the app
ENV GIT_HASH=${GIT_HASH}
ENV BUILD_DATE=${BUILD_DATE}

LABEL org.opencontainers.image.revision=${GIT_HASH}
LABEL org.opencontainers.image.created=${BUILD_DATE}

# 8080 - Healthcheck
# 9090 - Metrics
EXPOSE 8080
EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# For i18next to load relative files correctly
WORKDIR /config/packages/sushii-worker
ENTRYPOINT [ "bun", "run", "./src/index.ts" ]
