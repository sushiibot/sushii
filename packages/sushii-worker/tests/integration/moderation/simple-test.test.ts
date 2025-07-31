import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setupIntegrationTest, cleanupIntegrationTest, IntegrationTestServices } from "../helpers/integrationTestSetup";

describe("Simple Integration Test", () => {
  let services: IntegrationTestServices;

  beforeAll(async () => {
    services = await setupIntegrationTest();
  });

  afterAll(async () => {
    await cleanupIntegrationTest(services);
  });

  test("should have working services", async () => {
    const { moderationFeature, db } = services;
    
    // Check services exist
    expect(moderationFeature).toBeDefined();
    expect(moderationFeature.services).toBeDefined();
    expect(moderationFeature.services.moderationCaseRepository).toBeDefined();
    
    // Try to query database - use valid snowflake IDs
    const result = await moderationFeature.services.moderationCaseRepository.findByUserId(
      "123456789012345678", // Valid snowflake ID
      "987654321098765432"  // Valid snowflake ID
    );
    
    if (!result.ok) {
      console.error("Repository error:", result.val);
    }
    
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val).toEqual([]);
    }
  });
});