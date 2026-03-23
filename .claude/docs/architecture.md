# Architecture

## Overview

Discord bot monorepo with two packages: `sushii-worker` (the bot) and `api-proxy`. Built with Discord.js, Bun, TypeScript, Drizzle ORM, PostgreSQL.

## Directory Structure

```
packages/sushii-worker/src/
  core/           ← cluster management, sharding, bootstrap
  features/       ← feature modules (DDD, 4-layer)
  shared/         ← cross-feature domain types, interfaces, utilities
  infrastructure/ ← top-level infra (database connection)
  interactions/   ← legacy custom ID handling (being migrated)
  utils/          ← misc utilities
```

**Legacy path still active**: `src/interactions/` (customIds.ts and response helpers). Migrate incrementally; do not add new code here.

## 4-Layer Feature Structure

Each feature under `src/features/{feature}/` follows:

```
{feature}/
  domain/           ← entities, value objects, repository interfaces, pure logic
  application/      ← service orchestration, uses domain + infrastructure interfaces
  infrastructure/   ← repository implementations, external API adapters, tasks
  presentation/     ← Discord commands, event handlers, views, DTOs
  setup.ts          ← wires dependencies together, called from bootstrap
```

**Dependency rule**: each layer only depends inward (presentation → application → domain). Infrastructure implements domain interfaces.

## Features

```
automod           ban-cache         bot-emojis        cache
deployment        emoji-stats       giveaways         guild-settings
interaction-handler  legacy-audit-logs  legacy-commands  leveling
member-events     message-log       moderation        notifications
reaction-log      reminders         role-menu         social
stats             status            tags              user-profile
webhook-logging
```

`legacy-*` features are wrappers around old code paths — avoid adding to them.

## Database

PostgreSQL with 3 schemas managed by Drizzle ORM:
- `app_public` — user-facing data
- `app_private` — internal/sensitive data
- `app_hidden` — system data

Run migrations: `bunx drizzle-kit migrate` (from `packages/sushii-worker`)

## Core Infrastructure

- **Sharding**: `src/core/cluster/` — cluster manager + shard process
- **Entry point**: `src/index.ts` (cluster manager) → `src/core/cluster/cluster.ts` (shard)
- **Metrics**: Prometheus on `:9090`
- **Logging**: pino

## Migration Guidelines

When touching existing code:
- New features → `src/features/{feature}/` with 4-layer structure
- Existing legacy code → migrate incrementally, don't break functionality
- Feature communication → domain events, not direct service calls between features
- Never add new code to `src/interactions/`

## Testing Strategy

- **Domain**: unit tests (no external deps)
- **Application**: unit tests with mocked infrastructure interfaces
- **Infrastructure**: integration tests (real DB via Testcontainers)
- **Presentation**: unit tests with mocked application services

See `.claude/docs/testing.md` for running tests.
