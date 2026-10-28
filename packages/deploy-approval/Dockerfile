FROM oven/bun:1.3-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f
WORKDIR /app
COPY --chown=bun:bun packages/deploy-approval/src ./src
USER bun
ENV BIND_ADDRESS=0.0.0.0 PORT=3080
EXPOSE 3080
CMD ["bun", "src/index.ts"]
