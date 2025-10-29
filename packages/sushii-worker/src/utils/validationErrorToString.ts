import { BaseError, CombinedPropertyError } from "@sapphire/shapeshift";

interface ErrorDetail {
  name: string;
  message: string;
  validator?: string;
  given?: unknown;
  expected?: unknown;
}

interface ValidationError {
  name: string;
  message: string;
  stack?: string;
  // Direct property access for better error details
  validator?: string;
  given?: unknown;
  expected?: unknown;
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
    const errorWithProps = err as BaseError & {
      validator?: string;
      given?: unknown;
      expected?: unknown;
    };

    const result: ValidationError = {
      name: err.name,
      message: err.message,
      stack: err.stack,
      // Access properties directly instead of relying on toJSON
      validator: errorWithProps.validator,
      given: errorWithProps.given,
      expected: errorWithProps.expected,
    };

    // Handle CombinedPropertyError specially to extract property paths
    if (err instanceof CombinedPropertyError) {
      result.propertyErrors = err.errors.map(([property, error]) => {
        const nestedError = error as BaseError & {
          validator?: string;
          given?: unknown;
          expected?: unknown;
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
              }
            : { name: String(error), message: String(error) },
        };
      });
    }

    return result;
  }

  // Handle generic CombinedError (from Discord.js validation wrapping shapeshift errors)
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    err.name === "CombinedError"
  ) {
    const combinedErr = err as {
      name: string;
      message: string;
      stack?: string;
      aggregateErrors?: unknown[];
    };

    // Extract details from aggregate errors
    const detailedAggregateErrors = combinedErr.aggregateErrors?.map(
      (aggErr): ErrorDetail => {
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
        // Fallback for non-BaseError aggregates
        return {
          name: String(aggErr),
          message: String(aggErr),
        };
      },
    );

    return {
      name: combinedErr.name,
      message: combinedErr.message,
      stack: combinedErr.stack,
      aggregateErrors: detailedAggregateErrors,
    };
  }
}
