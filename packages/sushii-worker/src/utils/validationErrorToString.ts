import { BaseError, CombinedPropertyError } from "@sapphire/shapeshift";

interface ValidationError {
  name: string;
  message: string;
  stack?: string;
  // Use built-in toJSON() result from shapeshift errors
  jsonified?: unknown;
  // For CombinedPropertyError
  propertyErrors?: { property: PropertyKey; error: unknown }[];
  // For generic CombinedError from Discord.js
  aggregateErrors?: unknown[];
}

/**
 * Extract detailed validation error information using shapeshift's built-in toJSON() methods.
 * All shapeshift errors (BaseError, ValidationError, etc.) have a toJSON() method that
 * provides structured error details including validator, expected, given, and constraint info.
 */
export default function validationErrorToString(
  err: unknown,
): ValidationError | undefined {
  // Validation errors from @sapphire/shapeshift - these all have toJSON() methods
  if (err instanceof BaseError) {
    // BaseError has toJSON() but it's not in the type definitions for v3.9.7
    const errorWithToJSON = err as BaseError & {
      toJSON: () => unknown;
    };

    const result: ValidationError = {
      name: err.name,
      message: err.message,
      stack: err.stack,
      jsonified: errorWithToJSON.toJSON(), // Use built-in toJSON() method
    };

    // Handle CombinedPropertyError specially to extract property paths
    if (err instanceof CombinedPropertyError) {
      result.propertyErrors = err.errors.map(([property, error]) => ({
        property,
        error:
          error instanceof BaseError
            ? (error as BaseError & { toJSON: () => unknown }).toJSON() // Use toJSON() for nested errors too
            : { name: String(error), message: String(error) },
      }));
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

    // Try to jsonify aggregate errors if they're BaseErrors
    const jsonifiedAggregateErrors = combinedErr.aggregateErrors?.map(
      (aggErr) => {
        if (aggErr instanceof BaseError) {
          return (aggErr as BaseError & { toJSON: () => unknown }).toJSON();
        }
        return aggErr;
      },
    );

    return {
      name: combinedErr.name,
      message: combinedErr.message,
      stack: combinedErr.stack,
      aggregateErrors: jsonifiedAggregateErrors,
    };
  }
}
