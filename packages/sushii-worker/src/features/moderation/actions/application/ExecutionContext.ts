import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

import type { ModerationAction } from "../../shared/domain/entities/ModerationAction";
import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import type { ActionType } from "../../shared/domain/value-objects/ActionType";

/**
 * Base interface for all execution contexts.
 * Contains the immutable data that all contexts share.
 */
interface ContextBase {
  readonly action: ModerationAction;
  readonly actionType: ActionType;
  readonly target: ModerationTarget;
  readonly tx: NodePgDatabase<typeof schema>;
}

/**
 * Initial execution context with no moderation case data.
 * This is the starting point of the pipeline.
 */
export class ExecutionContext implements ContextBase {
  constructor(
    public readonly action: ModerationAction,
    public readonly actionType: ActionType,
    public readonly target: ModerationTarget,
    public readonly tx: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Sets the case ID and returns a new context with the case ID available.
   * Creates a new immutable instance rather than mutating state.
   */
  setCaseId(caseId: string): ExecutionContextWithCaseId {
    return new ExecutionContextWithCaseId(
      this.action,
      this.actionType,
      this.target,
      this.tx,
      caseId,
    );
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasCaseId(): boolean {
    return false; // Initial context never has case ID
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasModerationCase(): boolean {
    return false; // Initial context never has moderation case
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasCaseCreated(): boolean {
    return false; // Initial context never has both
  }
}

/**
 * Execution context with case ID set.
 * Guarantees that getCaseId() will return a valid string.
 */
export class ExecutionContextWithCaseId implements ContextBase {
  constructor(
    public readonly action: ModerationAction,
    public readonly actionType: ActionType,
    public readonly target: ModerationTarget,
    public readonly tx: NodePgDatabase<typeof schema>,
    public readonly caseId: string, // Guaranteed to exist - no assertions needed!
  ) {}

  /**
   * Gets the case ID safely. No null checks or assertions needed.
   */
  getCaseId(): string {
    return this.caseId;
  }

  /**
   * Updates the moderation case and returns a complete context.
   * Creates a new immutable instance with both case ID and moderation case.
   */
  updateModerationCase(
    moderationCase: ModerationCase,
  ): CompleteExecutionContext {
    return new CompleteExecutionContext(
      this.action,
      this.actionType,
      this.target,
      this.tx,
      this.caseId,
      moderationCase,
    );
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasCaseId(): boolean {
    return true; // This context always has case ID
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasModerationCase(): boolean {
    return false; // This context doesn't have moderation case yet
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasCaseCreated(): boolean {
    return false; // This context doesn't have both yet
  }
}

/**
 * Complete execution context with both case ID and moderation case.
 * Guarantees that both getCaseId() and getModerationCase() will return valid values.
 */
export class CompleteExecutionContext implements ContextBase {
  constructor(
    public readonly action: ModerationAction,
    public readonly actionType: ActionType,
    public readonly target: ModerationTarget,
    public readonly tx: NodePgDatabase<typeof schema>,
    public readonly caseId: string, // Guaranteed to exist - no assertions needed!
    public readonly moderationCase: ModerationCase, // Guaranteed to exist - no assertions needed!
  ) {}

  /**
   * Gets the case ID safely. No null checks or assertions needed.
   */
  getCaseId(): string {
    return this.caseId;
  }

  /**
   * Gets the moderation case safely. No null checks or assertions needed.
   */
  getModerationCase(): ModerationCase {
    return this.moderationCase;
  }

  /**
   * Gets both case ID and moderation case safely. No null checks or assertions needed.
   */
  getCaseData(): { caseId: string; moderationCase: ModerationCase } {
    return {
      caseId: this.caseId,
      moderationCase: this.moderationCase,
    };
  }

  /**
   * Updates the moderation case and returns a new complete context.
   * Useful for when DM results need to be updated.
   */
  updateModerationCase(
    moderationCase: ModerationCase,
  ): CompleteExecutionContext {
    return new CompleteExecutionContext(
      this.action,
      this.actionType,
      this.target,
      this.tx,
      this.caseId,
      moderationCase, // Update with new moderation case
    );
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasCaseId(): boolean {
    return true; // Complete context always has case ID
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasModerationCase(): boolean {
    return true; // Complete context always has moderation case
  }

  /**
   * Runtime check for backwards compatibility during cleanup operations.
   * @deprecated Prefer type-safe context progression in normal pipeline flow
   */
  hasCaseCreated(): boolean {
    return true; // Complete context always has both
  }
}

// Type aliases for convenience and readability
export type InitialContext = ExecutionContext;
export type ContextWithCaseId = ExecutionContextWithCaseId;
export type CompleteContext = CompleteExecutionContext;

// Union type for cleanup operations that might receive any context state
export type AnyExecutionContext =
  | ExecutionContext
  | ExecutionContextWithCaseId
  | CompleteExecutionContext;
