import { Err, Ok, Result } from "ts-results";

export interface CaseRangeData {
  type: "range";
  startId: number;
  endId: number | undefined;
}

export interface CaseSingleData {
  type: "single";
  id: number;
}

export interface CaseLatestData {
  type: "latest";
  count: number;
}

export type CaseSpecData = CaseRangeData | CaseSingleData | CaseLatestData;

export class CaseRange {
  private constructor(private readonly spec: CaseSpecData) {}

  static fromString(
    rawValue: string,
    ignoreRangeOrder: boolean = false,
  ): Result<CaseRange, string> {
    const spec = CaseRange.parseSpec(rawValue, ignoreRangeOrder);
    if (!spec) {
      return Err("Invalid case specification format");
    }
    return Ok(new CaseRange(spec));
  }

  static fromSpec(spec: CaseSpecData): CaseRange {
    return new CaseRange(spec);
  }

  get data(): CaseSpecData {
    return this.spec;
  }

  getAffectedCount(): number | undefined {
    switch (this.spec.type) {
      case "latest":
        return this.spec.count;
      case "range":
        if (!this.spec.endId) {
          return undefined;
        }
        return this.spec.endId - this.spec.startId + 1;
      case "single":
        return 1;
    }
  }

  async resolveToRange(
    getCurrentCaseNumber: () => Promise<number>,
  ): Promise<Result<[number, number], string>> {
    switch (this.spec.type) {
      case "single":
        return Ok([this.spec.id, this.spec.id]);
      case "range":
        if (!this.spec.endId) {
          return Err("Range end ID is required");
        }
        return Ok([this.spec.startId, this.spec.endId]);
      case "latest": {
        try {
          const nextCaseId = await getCurrentCaseNumber();
          const latestCaseId = nextCaseId - 1;
          const caseStartId = latestCaseId - this.spec.count + 1;
          return Ok([Math.max(1, caseStartId), latestCaseId]);
        } catch (error) {
          return Err(`Failed to resolve latest cases: ${error}`);
        }
      }
    }
  }

  private static parseSpec(
    rawValue: string,
    ignoreRangeOrder: boolean = false,
  ): CaseSpecData | undefined {
    const value = rawValue.split(":")[0];

    // Handle range format (e.g., "10-15")
    const rangeSplit = value.split("-");
    if (rangeSplit.length >= 2) {
      const [start, end] = rangeSplit;

      if (!start) {
        return undefined;
      }

      let startId = parseInt(start, 10);
      if (Number.isNaN(startId)) {
        return undefined;
      }

      if (!end) {
        return {
          type: "range",
          startId,
          endId: undefined,
        };
      }

      let endId = parseInt(end, 10);
      if (Number.isNaN(endId)) {
        return undefined;
      }

      // Ensure start <= end unless ignoring order
      if (!ignoreRangeOrder && startId > endId) {
        const temp = startId;
        startId = endId;
        endId = temp;
      }

      return {
        type: "range",
        startId,
        endId,
      };
    }

    // Handle single case ID
    const caseId = parseInt(value, 10);
    if (!Number.isNaN(caseId) && caseId >= 0) {
      return {
        type: "single",
        id: caseId,
      };
    }

    // Handle "latest" format
    if (value === "latest" || value === "latest~") {
      return {
        type: "latest",
        count: 1,
      };
    }

    // Handle "latest~N" format
    if (value.startsWith("latest~")) {
      const count = parseInt(value.slice(7), 10);
      if (Number.isNaN(count)) {
        return undefined;
      }
      return {
        type: "latest",
        count,
      };
    }

    return undefined;
  }
}
