import { s } from "@sapphire/shapeshift";
import { describe, expect, test } from "bun:test";

import parseValidationError from "./parseValidationError";

describe("parseValidationError", () => {
  describe("returns undefined for non-error inputs", () => {
    test.each([
      { input: null, description: "null" },
      { input: undefined, description: "undefined" },
      { input: "string", description: "string" },
      { input: 123, description: "number" },
      { input: {}, description: "plain object" },
      { input: [], description: "array" },
    ])("returns undefined for $description", ({ input }) => {
      const result = parseValidationError(input);
      expect(result).toBeUndefined();
    });
  });

  describe("handles real shapeshift validation errors", () => {
    test("handles ValidationError from string validation", () => {
      let error: unknown;
      try {
        s.string.parse(123);
      } catch (e) {
        error = e;
      }

      const result = parseValidationError(error);

      expect(result).toBeDefined();
      expect(result?.name).toBe("ValidationError");
      expect(result?.validator).toBe("s.string");
      expect(result?.given).toBe(123);
      expect(result?.description).toContain("ValidationError > s.string");
      expect(result?.description).toContain("Expected a string primitive");
    });

    test("handles ExpectedValidationError from instance validation", () => {
      let error: unknown;
      try {
        s.instance(Date).parse({ not: "instance" });
      } catch (e) {
        error = e;
      }

      const result = parseValidationError(error);

      expect(result).toBeDefined();
      expect(result?.name).toBe("ExpectedValidationError");
      expect(result?.validator).toContain("s.instance");
      expect(result?.given).toEqual({ not: "instance" });
      expect(result?.description).toContain(
        "ExpectedValidationError > s.instance",
      );
      expect(result?.description).toContain("Expected:");
      expect(result?.description).toContain("Received:");
    });

    test("handles ExpectedConstraintError from number validation", () => {
      let error: unknown;
      try {
        s.number.greaterThan(10).parse(5);
      } catch (e) {
        error = e;
      }

      const result = parseValidationError(error);

      expect(result).toBeDefined();
      expect(result?.name).toBe("ExpectedConstraintError");
      expect(result?.constraint).toBeDefined();
      expect(result?.given).toBe(5);
      expect(result?.description).toContain(
        "ExpectedConstraintError > s.number",
      );
      expect(result?.description).toContain("Invalid");
    });
  });

  describe("handles real object validation errors", () => {
    test("handles object validation with multiple property errors", () => {
      const userSchema = s.object({
        username: s.string,
        age: s.number.greaterThan(0),
        email: s.string.email,
      });

      let error: unknown;
      try {
        userSchema.parse({
          username: 123, // should be string
          age: -5, // should be > 0
          email: "invalid-email", // should be valid email
        });
      } catch (e) {
        error = e;
      }

      const result = parseValidationError(error);

      expect(result).toBeDefined();
      expect(result?.name).toBe("CombinedPropertyError");
      expect(result?.propertyErrors).toBeDefined();
      expect(result?.propertyErrors?.length).toBeGreaterThan(0);

      // Check that property errors contain actual validation details
      const propertyErrors = result?.propertyErrors || [];
      const hasUsernameError = propertyErrors.some(
        (pe) => pe.property === "username",
      );
      const hasAgeError = propertyErrors.some((pe) => pe.property === "age");

      expect(hasUsernameError || hasAgeError).toBe(true);

      // Check that property errors have descriptions
      if (propertyErrors.length > 0) {
        const firstPropertyError = propertyErrors[0];
        expect(firstPropertyError.error.description).toBeDefined();
        expect(typeof firstPropertyError.error.description).toBe("string");
      }
    });

    test("handles missing required properties", () => {
      const requiredSchema = s.object({
        required: s.string,
        optional: s.string.optional,
      });

      let error: unknown;
      try {
        requiredSchema.parse({ optional: "present" }); // missing 'required'
      } catch (e) {
        error = e;
      }

      const result = parseValidationError(error);

      expect(result).toBeDefined();
      expect(result?.name).toBe("CombinedPropertyError");
      expect(result?.propertyErrors).toBeDefined();

      const propertyErrors = result?.propertyErrors || [];
      const missingRequiredError = propertyErrors.find(
        (pe) => pe.property === "required",
      );
      expect(missingRequiredError).toBeDefined();
      expect(missingRequiredError?.error.name).toBe("MissingPropertyError");
    });
  });

  describe("handles real CombinedError from union validation", () => {
    test("processes CombinedError from union that fails all options", () => {
      const unionValidator = s.union(
        s.string.lengthGreaterThan(10),
        s.number.greaterThan(100),
        s.instance(Date),
      );

      let error: unknown;
      try {
        unionValidator.parse("short"); // fails all union options
      } catch (e) {
        error = e;
      }

      const result = parseValidationError(error);

      expect(result).toBeDefined();
      expect(result?.name).toBe("CombinedError");
      expect(result?.message).toContain("one or more errors");
      expect(result?.aggregateErrors).toBeDefined();
      expect(result?.aggregateErrors?.length).toBeGreaterThan(0);

      // Should have multiple validation errors from failed union attempts
      const errors = result?.aggregateErrors || [];
      expect(errors.length).toBe(3); // three failed union options

      // Check that we got actual validation error details
      expect(
        errors.some((e) => typeof e === "object" && "validator" in e),
      ).toBe(true);

      // Check that descriptions are included
      expect(
        errors.some((e) => typeof e === "object" && "description" in e),
      ).toBe(true);

      // Check for rich error descriptions
      const firstError = errors[0] as Record<string, unknown>;
      expect(firstError.description).toBeDefined();
      expect(typeof firstError.description).toBe("string");
    });

    test("processes nested validation errors in union", () => {
      const complexUnion = s.union(
        s.object({ type: s.literal("user"), name: s.string }),
        s.object({ type: s.literal("admin"), permissions: s.array(s.string) }),
      );

      let error: unknown;
      try {
        complexUnion.parse({ type: "user", name: 123 }); // wrong name type
      } catch (e) {
        error = e;
      }

      const result = parseValidationError(error);

      expect(result).toBeDefined();
      expect(result?.name).toBe("CombinedError");
      expect(result?.aggregateErrors).toBeDefined();

      // Should contain property validation errors from the union attempts
      const errors = result?.aggregateErrors || [];
      expect(errors.length).toBeGreaterThan(0);

      // Check that we have detailed error information
      expect(errors.some((e) => typeof e === "object" && "name" in e)).toBe(
        true,
      );
    });
  });

  describe("handles Discord.js style wrapped errors", () => {
    test("handles non-BaseError objects in aggregateErrors", () => {
      const combinedError = {
        name: "CombinedError",
        message: "Mixed errors",
        aggregateErrors: [
          { type: "CustomError", details: "some details" },
          "string error",
          123,
        ],
      };

      const result = parseValidationError(combinedError);

      expect(result).toEqual({
        name: "CombinedError",
        message: "Mixed errors",
        aggregateErrors: [
          { type: "CustomError", details: "some details" },
          { name: "string error", message: "string error" },
          { name: "123", message: "123" },
        ],
      });
    });

    test("prefers aggregateErrors over errors when both exist", () => {
      const combinedError = {
        name: "CombinedError",
        message: "Multiple errors",
        aggregateErrors: [{ primary: "error" }],
        errors: [{ secondary: "error" }],
      };

      const result = parseValidationError(combinedError);

      expect(result?.aggregateErrors).toEqual([{ primary: "error" }]);
    });

    test("uses errors when aggregateErrors is missing", () => {
      const combinedError = {
        name: "CombinedError",
        message: "Multiple errors",
        errors: [{ secondary: "error" }],
      };

      const result = parseValidationError(combinedError);

      expect(result?.aggregateErrors).toEqual([{ secondary: "error" }]);
    });
  });

  describe("handles original error case from issue", () => {
    test("processes the specific CombinedError structure from the log", () => {
      // This is the exact structure from the error log you provided
      const originalError = {
        type: "CombinedError",
        message: "Received one or more errors",
        aggregateErrors: [
          {
            type: "ExpectedValidationError",
            message: "Expected",
            validator: "s.instance(V)",
          },
          {
            type: "ExpectedValidationError",
            message: "Expected",
            validator: "s.instance(V)",
          },
        ],
      };

      const result = parseValidationError(originalError);

      expect(result).toEqual({
        name: "CombinedError",
        message: "Received one or more errors",
        aggregateErrors: [
          {
            type: "ExpectedValidationError",
            message: "Expected",
            validator: "s.instance(V)",
          },
          {
            type: "ExpectedValidationError",
            message: "Expected",
            validator: "s.instance(V)",
          },
        ],
      });
    });
  });
});
