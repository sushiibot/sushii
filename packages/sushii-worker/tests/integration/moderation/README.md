# Moderation Integration Tests

This directory contains comprehensive integration tests for the moderation feature, organized by command type.

## Structure

### Shared Utilities (`/shared/`)
- **`testCaseTypes.ts`** - Type definitions for test cases
- **`moderationTestRunner.ts`** - Core test execution engine (`runModerationTest` function)
- **`testCaseFactories.ts`** - Factory functions for creating test cases with sensible defaults

### Command Test Files
- **`ban-command.test.ts`** - Ban command integration tests
- **`timeout-command.test.ts`** - Timeout command integration tests

## Test Organization

Each command test file follows this structure:

```typescript
describe("Command Integration", () => {
  describe("Basic Operations", () => {
    // Success cases, core functionality
  });
  
  describe("DM Behavior", () => {
    describe("Guild Config Defaults", () => {
      // Tests using guild config defaults
    });
    
    describe("Edge Cases", () => {
      // No reason, non-members, etc.
    });
  });
  
  describe("Validation & Errors", () => {
    // Invalid input, non-existent users
  });
  
  describe("Audit Log Integration", () => {
    // Pending -> completed flow
  });
});
```

## Writing Tests

### Using Factory Functions

```typescript
import { createBanTestCase } from "./shared/testCaseFactories";

const testCase = createBanTestCase("test description", {
  commandOptions: {
    reason: "Custom reason",
  },
  expectations: {
    discordApi: {
      ban: { called: true },
      dmSend: { called: false },
    },
  },
});

await runModerationTest(testCase, services);
```

### Using DM Config Variations

```typescript
import { createDmConfigVariations } from "./shared/testCaseFactories";

const baseCase = createBanTestCase("base case", { ... });
const variations = createDmConfigVariations(baseCase, "ban");

test.each(variations)("$name", async (testCase) => {
  await runModerationTest(testCase, services);
});
```

## Running Tests

```bash
# Run all moderation tests
bun test tests/integration/moderation/

# Run specific command tests
bun test tests/integration/moderation/ban-command.test.ts
bun test tests/integration/moderation/timeout-command.test.ts

# Run with environment variables and timeout
TESTCONTAINERS_RYUK_DISABLED=true bun test --timeout 30000 tests/integration/moderation/
```

## Benefits

- **Maintainable**: Each command has ~10-15 tests instead of 80+ in one file
- **Discoverable**: Clear hierarchy shows what functionality is tested
- **Reusable**: Shared test runner and factory functions reduce duplication
- **Scalable**: Easy to add new commands or test categories
- **Fast Development**: Can run individual command tests during development