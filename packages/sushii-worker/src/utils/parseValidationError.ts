import { BaseError, CombinedPropertyError } from "@sapphire/shapeshift";

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
  propertyErrors?: { property: PropertyKey; error: Record<string, unknown> }[];
  // For CombinedError
  aggregateErrors?: Record<string, unknown>[];
}

/**
 * Parse detailed validation error information using built-in toJSON() methods.
 * Leverages @sapphire/shapeshift's standardized error serialization.
 */
export default function parseValidationError(
  err: unknown,
): ValidationError | undefined {
  // Check for CombinedError first (before BaseError since CombinedError extends BaseError)
  if (
    err &&
    typeof err === "object" &&
    ("constructor" in err && (err.constructor as { name: string }).name === "CombinedError")
  ) {
    const combinedErr = err as {
      name: string;
      message: string;
      stack?: string;
      aggregateErrors?: unknown[];
      errors?: unknown[]; // Sapphire CombinedError uses 'errors'
    };

    // Try both aggregateErrors (Discord.js) and errors (Sapphire) properties
    const errorsArray = combinedErr.aggregateErrors ?? combinedErr.errors;

    // Extract details using built-in methods where possible
    const detailedErrors = errorsArray?.map((aggErr) => {
      if (aggErr instanceof BaseError) {
        return typeof (aggErr as BaseError & { toJSON?: () => Record<string, unknown> }).toJSON === 'function' 
          ? { ...(aggErr as BaseError & { toJSON: () => Record<string, unknown> }).toJSON(), name: aggErr.constructor.name }
          : { name: aggErr.constructor.name, message: aggErr.message };
      }

      // Fallback for non-BaseError objects
      if (aggErr && typeof aggErr === "object") {
        return aggErr as Record<string, unknown>;
      }

      // Fallback for primitives
      return { name: String(aggErr), message: String(aggErr) };
    });

    return {
      name: "CombinedError",
      message: combinedErr.message ?? "Multiple errors occurred",
      stack: combinedErr.stack,
      aggregateErrors: detailedErrors,
    };
  }

  // Validation errors from @sapphire/shapeshift
  if (err instanceof BaseError) {
    const result: ValidationError = {
      name: err.constructor.name, // Use constructor name instead of err.name
      message: err.message,
      stack: err.stack,
    };

    // Try to use built-in toJSON() method if available
    if (typeof (err as BaseError & { toJSON?: () => Record<string, unknown> }).toJSON === 'function') {
      const errorJson = (err as BaseError & { toJSON: () => Record<string, unknown> }).toJSON();
      // Merge toJSON properties, but always preserve the constructor name
      Object.assign(result, errorJson);
      result.name = err.constructor.name; // Always use the constructor name
    } else {
      // Fallback to direct property access for older versions
      const errorWithProps = err as BaseError & {
        validator?: string;
        given?: unknown;
        expected?: unknown;
        constraint?: string;
        property?: PropertyKey;
        value?: unknown;
      };

      // Copy available properties
      if (errorWithProps.validator !== undefined) result.validator = errorWithProps.validator;
      if (errorWithProps.given !== undefined) result.given = errorWithProps.given;
      if (errorWithProps.expected !== undefined) result.expected = errorWithProps.expected;
      if (errorWithProps.constraint !== undefined) result.constraint = errorWithProps.constraint;
      if (errorWithProps.property !== undefined) result.property = errorWithProps.property;
      if (errorWithProps.value !== undefined) result.value = errorWithProps.value;
    }

    // Handle CombinedPropertyError specially to extract property paths
    if (err instanceof CombinedPropertyError) {
      result.propertyErrors = err.errors.map(([property, error]) => ({
        property,
        error: error instanceof BaseError 
          ? (typeof (error as BaseError & { toJSON?: () => Record<string, unknown> }).toJSON === 'function' 
              ? { ...(error as BaseError & { toJSON: () => Record<string, unknown> }).toJSON(), name: error.constructor.name }
              : { name: error.constructor.name, message: error.message })
          : { name: String(error), message: String(error) },
      }));
    }

    return result;
  }

  // Handle generic CombinedError (from Discord.js validation wrapping shapeshift errors)
  // This catches non-Sapphire CombinedErrors that have aggregateErrors/errors but don't extend BaseError
  if (
    err &&
    typeof err === "object" &&
    ("aggregateErrors" in err || "errors" in err)
  ) {
    const combinedErr = err as {
      name: string;
      message: string;
      stack?: string;
      aggregateErrors?: unknown[];
      errors?: unknown[];
    };

    // Extract details from aggregateErrors or errors
    const errorsArray = combinedErr.aggregateErrors ?? combinedErr.errors;
    const detailedErrors = errorsArray?.map((aggErr) => {
      if (aggErr instanceof BaseError) {
        return typeof (aggErr as BaseError & { toJSON?: () => Record<string, unknown> }).toJSON === 'function' 
          ? { ...(aggErr as BaseError & { toJSON: () => Record<string, unknown> }).toJSON(), name: aggErr.constructor.name }
          : { name: aggErr.constructor.name, message: aggErr.message };
      }

      // Fallback for non-BaseError objects
      if (aggErr && typeof aggErr === "object") {
        return aggErr as Record<string, unknown>;
      }

      // Fallback for primitives
      return { name: String(aggErr), message: String(aggErr) };
    });

    return {
      name: combinedErr.name ?? "CombinedError",
      message: combinedErr.message ?? "Multiple errors occurred",
      stack: combinedErr.stack,
      aggregateErrors: detailedErrors,
    };
  }
}
