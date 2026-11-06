FROM oven/bun:1 AS build

WORKDIR /app
COPY packages/sushii-insights/package.json packages/sushii-insights/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY packages/sushii-insights/ ./
RUN bun run build

FROM oven/bun:1

WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./

ENV PORT=3000
USER bun

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'const r = await fetch("http://127.0.0.1:" + process.env.PORT + "/health"); process.exit(r.ok ? 0 : 1)'

CMD ["bun", "build/index.js"]
