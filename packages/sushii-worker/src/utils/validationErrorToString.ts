import { BaseError, CombinedPropertyError } from "@sapphire/shapeshift";

interface ErrorDetail {
  name: string;
  message: string;
  // ValidationError / ExpectedValidationError properties
  validator?: string;
  given?: unknown;
  expected?: unknown;
  // ConstraintError properties
  constraint?: string;
  // Property errors
  property?: PropertyKey;
  value?: unknown;
}

interface ValidationError {
  name: string;
  message: string;
  stack?: string;
  // ValidationError / ExpectedValidationError properties
  validator?: string;
  given?: unknown;
  expected?: unknown;
  // ConstraintError properties
  constraint?: string;
  // Property errors (MissingPropertyError, UnknownPropertyError)
  property?: PropertyKey;
  value?: unknown;
  // For CombinedPropertyError
  propertyErrors?: { property: PropertyKey; error: ErrorDetail }[];
  // For generic CombinedError from Discord.js
  aggregateErrors?: ErrorDetail[];
}

/**
 * Extract detailed validation error information by directly accessing error properties.
 * Based on shapeshift source: https://github.com/sapphiredev/shapeshift/tree/main/src/lib/errors
 *
 * ValidationError has: validator, given, message
 * ExpectedValidationError has: validator, given, expected, message
 */
export default function validationErrorToString(
  err: unknown,
): ValidationError | undefined {
  // Validation errors from @sapphire/shapeshift
  if (err instanceof BaseError) {
    // Access properties directly from the error object
    // Different error types have different properties:
    // - ValidationError: validator, given
    // - ExpectedValidationError: validator, given, expected
    // - BaseConstraintError: constraint, given
    // - MissingPropertyError: property
    // - UnknownPropertyError: property, value
    const errorWithProps = err as BaseError & {
      validator?: string;
      given?: unknown;
      expected?: unknown;
      constraint?: string;
      property?: PropertyKey;
      value?: unknown;
    };

    const result: ValidationError = {
      name: err.name,
      message: err.message,
      stack: err.stack,
      // Access all possible properties
      validator: errorWithProps.validator,
      given: errorWithProps.given,
      expected: errorWithProps.expected,
      constraint: errorWithProps.constraint,
      property: errorWithProps.property,
      value: errorWithProps.value,
    };

    // Handle CombinedPropertyError specially to extract property paths
    if (err instanceof CombinedPropertyError) {
      result.propertyErrors = err.errors.map(([property, error]) => {
        const nestedError = error as BaseError & {
          validator?: string;
          given?: unknown;
          expected?: unknown;
          constraint?: string;
          property?: PropertyKey;
          value?: unknown;
        };

        return {
          property,
          error: error instanceof BaseError
            ? {
                name: error.name,
                message: error.message,
                validator: nestedError.validator,
                given: nestedError.given,
                expected: nestedError.expected,
                constraint: nestedError.constraint,
                property: nestedError.property,
                value: nestedError.value,
              }
            : { name: String(error), message: String(error) },
        };
      });
    }

    return result;
  }

  // Handle generic CombinedError (from Discord.js validation wrapping shapeshift errors)
  // Check for both Error name and presence of aggregateErrors property
  if (
    err &&
    typeof err === "object" &&
    ("aggregateErrors" in err || ("name" in err && err.name === "CombinedError"))
  ) {
    const combinedErr = err as {
      name: string;
      message: string;
      stack?: string;
      aggregateErrors?: unknown[];
      errors?: unknown[]; // Some versions use 'errors' instead
    };

    // Try both aggregateErrors and errors properties
    const errorsArray = combinedErr.aggregateErrors ?? combinedErr.errors;

    // Extract details from aggregate errors
    const detailedAggregateErrors = errorsArray?.map((aggErr): ErrorDetail => {
      if (aggErr instanceof BaseError) {
        const baseErr = aggErr as BaseError & {
          validator?: string;
          given?: unknown;
          expected?: unknown;
        };

        return {
          name: baseErr.name,
          message: baseErr.message,
          validator: baseErr.validator,
          given: baseErr.given,
          expected: baseErr.expected,
        };
      }

      // Try to extract properties even if not instanceof BaseError
      if (aggErr && typeof aggErr === "object") {
        const errObj = aggErr as {
          name?: string;
          message?: string;
          validator?: string;
          given?: unknown;
          expected?: unknown;
          constraint?: string;
          property?: PropertyKey;
          value?: unknown;
        };

        return {
          name: errObj.name ?? "Error",
          message: errObj.message ?? String(aggErr),
          validator: errObj.validator,
          given: errObj.given,
          expected: errObj.expected,
          constraint: errObj.constraint,
          property: errObj.property,
          value: errObj.value,
        };
      }

      // Fallback for primitives
      return {
        name: String(aggErr),
        message: String(aggErr),
      };
    });

    return {
      name: combinedErr.name ?? "CombinedError",
      message: combinedErr.message ?? "Multiple errors occurred",
      stack: combinedErr.stack,
      aggregateErrors: detailedAggregateErrors,
    };
  }
}
