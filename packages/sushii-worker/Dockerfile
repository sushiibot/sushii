FROM oven/bun:1.3-debian

LABEL org.opencontainers.image.source=https://github.com/sushiibot/sushii
LABEL org.opencontainers.image.description="sushii bot"
LABEL org.opencontainers.image.licenses="AGPL-3.0"

# Install curl and build dependencies for native modules
RUN apt-get update && apt-get install -y \
  curl \
  fontconfig \
  fonts-dejavu-core \
  fonts-noto-color-emoji \
  fonts-noto-core \
  python3 \
  python3-dev \
  build-essential \
  && rm -rf /var/lib/apt/lists/*

# Fonts for proof previews that Debian doesn't package (Noto Sans Medium/SemiBold,
# Korean subset), pinned to upstream commits and checksums.
ARG NOTO_SANS_COMMIT=28b15b4b43b7bed62b5cf6e6b0b5ff5846270535
ARG NOTO_KR_COMMIT=165c01b46ea533872e002e0785ff17e44f6d97d8
RUN mkdir -p /usr/local/share/fonts/noto \
  && cd /usr/local/share/fonts/noto \
  && curl -fsSL -o NotoSans-Medium.ttf \
    "https://raw.githubusercontent.com/notofonts/notofonts.github.io/${NOTO_SANS_COMMIT}/fonts/NotoSans/hinted/ttf/NotoSans-Medium.ttf" \
  && curl -fsSL -o NotoSans-SemiBold.ttf \
    "https://raw.githubusercontent.com/notofonts/notofonts.github.io/${NOTO_SANS_COMMIT}/fonts/NotoSans/hinted/ttf/NotoSans-SemiBold.ttf" \
  && curl -fsSL -o NotoSansKR-Regular.otf \
    "https://raw.githubusercontent.com/notofonts/noto-cjk/${NOTO_KR_COMMIT}/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf" \
  && printf '%s\n' \
    "635d93d1131d791f2576de90b3bb0f7cdf61929906e8420a61b5f7f8e76420bb  NotoSans-Medium.ttf" \
    "a4e91fd530ac2b4ef5367240144ff37d7d65d66cf76f2e9a2187b93c676f92d0  NotoSans-SemiBold.ttf" \
    "69975a0ac8472717870aefeab0a4d52739308d90856b9955313b2ad5e0148d68  NotoSansKR-Regular.otf" \
    | sha256sum -c - \
  && fc-cache -f

WORKDIR /config

# Root package.json and lockfile
COPY ./package.json ./bun.lock ./

# Project specific package.json - only the workspace packages required
COPY ./packages/sushii-worker/package.json ./packages/sushii-worker/
COPY ./packages/sushii-mcp/package.json ./packages/sushii-mcp/

# Install dependencies
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source code and stuff
COPY ./packages/sushii-worker/ ./packages/sushii-worker/

# Build info, args at end to minimize cache invalidation
ARG GIT_HASH
ARG BUILD_DATE
ARG ASSET_REVISION
RUN test "$ASSET_REVISION" = "$(cat /config/packages/sushii-worker/asset-revision.txt)"
LABEL bot.sushii.asset-revision=$ASSET_REVISION
ENV ASSET_REVISION=${ASSET_REVISION}
LABEL bot.sushii.public-assets="true"
ENV ASSET_PUBLIC_BASE_URL=https://assets.sushii.bot

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
