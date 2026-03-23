# Testing

## Running Tests

From `packages/sushii-worker`:

```bash
# All unit/colocated tests
bun test

# Integration tests (requires Docker for Testcontainers)
TESTCONTAINERS_RYUK_DISABLED=true bun test --timeout 30000 ./tests/integration/

# E2E tests
bun test --timeout 30000 ./tests/e2e/
```

Always use the timeout flag for integration and e2e tests. `TESTCONTAINERS_RYUK_DISABLED=true` is required for integration tests.

From the monorepo root:
```bash
bun run test:worker   # runs all worker tests
```

## Test Location

- **Unit tests**: colocated with source as `*.test.ts` (e.g. `application/BotEmojiValidator.test.ts`)
- **Integration tests**: `tests/integration/`
- **E2E tests**: `tests/e2e/`

## Test Strategy by Layer

| Layer | Type | Dependencies |
|---|---|---|
| Domain | Unit | None |
| Application | Unit | Mock infrastructure interfaces |
| Infrastructure | Integration | Real DB via Testcontainers |
| Presentation | Unit | Mock application services |
