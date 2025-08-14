import type { APIApplicationCommandOptionChoice } from "discord.js";
import type { Logger } from "pino";

import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import { CaseRange } from "../../shared/domain/value-objects/CaseRange";

const MAX_CHOICE_NAME_LEN = 100;

export interface AutocompleteOptions {
  guildId: string;
  query: string;
}

export class CaseRangeAutocompleteService {
  constructor(
    private readonly modLogRepository: ModLogRepository,
    private readonly logger: Logger,
  ) {}

  async getAutocompleteSuggestions(
    options: AutocompleteOptions,
  ): Promise<APIApplicationCommandOptionChoice<string>[]> {
    const { guildId, query } = options;

    try {
      if (!query) {
        // No value provided, list most recent cases
        const recentCasesResult = await this.modLogRepository.findRecent(
          guildId,
          25,
        );

        if (recentCasesResult.err) {
          this.logger.warn(
            { error: recentCasesResult.val, guildId },
            "Failed to get recent cases for autocomplete",
          );
          return [];
        }

        return this.formatCases(recentCasesResult.val);
      }

      // Parse the case specification with ignoreRangeOrder=true since user might still be typing
      const caseRangeResult = CaseRange.fromString(query, true);
      if (caseRangeResult.err) {
        // Invalid case, return error message
        return [
          {
            name: "Invalid case range, examples: 123 or 123-150 or latest or latest~3",
            value: "invalid",
          },
        ];
      }

      const caseRange = caseRangeResult.val;

      switch (caseRange.data.type) {
        case "latest":
          return this.getLatestCaseSuggestions(guildId);

        case "range":
          return this.getRangeCaseSuggestions(guildId, caseRange);

        case "single":
          return this.getSingleCaseSuggestions(guildId, caseRange.data.id);

        default:
          return [];
      }
    } catch (error) {
      this.logger.error(
        { error, guildId, query },
        "Failed to generate autocomplete suggestions",
      );
      return [];
    }
  }

  private async getLatestCaseSuggestions(
    guildId: string,
  ): Promise<APIApplicationCommandOptionChoice<string>[]> {
    const recentCasesResult = await this.modLogRepository.findRecent(
      guildId,
      25,
    );

    if (recentCasesResult.err) {
      return [];
    }

    const recentCases = recentCasesResult.val;

    // Get the latest case to calculate latest indices
    const latestCaseResult = await this.modLogRepository.findRecent(guildId, 1);
    if (latestCaseResult.err) {
      return [];
    }
    const latestCase = latestCaseResult.val[0];
    const latestCaseId = latestCase ? Number(latestCase.caseId) : 0;

    return recentCases
      .filter((c) => parseInt(c.caseId, 10) > latestCaseId - 25)
      .map((modCase) => {
        const caseIdNum = parseInt(modCase.caseId, 10);
        const latestCount = latestCaseId - caseIdNum + 1;

        return {
          name: this.truncateWithEllipsis(
            `latest~${latestCount}: ${modCase.actionType} ${modCase.userTag} - ${
              modCase.reason?.value || "No reason set"
            }`,
            MAX_CHOICE_NAME_LEN,
          ),
          value: `latest~${latestCount}`,
        };
      });
  }

  private async getRangeCaseSuggestions(
    guildId: string,
    caseRange: CaseRange,
  ): Promise<APIApplicationCommandOptionChoice<string>[]> {
    const rangeData = caseRange.data;
    if (rangeData.type !== "range") {
      return [];
    }

    let endCases: ModerationCase[];

    if (!rangeData.endId) {
      // Searching for end ID - should only include cases that are > startId
      const recentCasesResult = await this.modLogRepository.findRecent(
        guildId,
        25,
      );

      if (recentCasesResult.err) {
        return [];
      }

      endCases = recentCasesResult.val.filter(
        (c) => parseInt(c.caseId, 10) > rangeData.startId,
      );
    } else {
      // Both start and end ID provided, we are just adding to the last digit
      const prefixSearchResult = await this.modLogRepository.searchByIdPrefix(
        guildId,
        rangeData.endId.toString(),
        25,
      );

      if (prefixSearchResult.err) {
        return [];
      }

      endCases = prefixSearchResult.val.filter(
        (c) => parseInt(c.caseId, 10) > rangeData.startId,
      );
    }

    return endCases.slice(0, 25).map((modCase) => ({
      name: this.truncateWithEllipsis(
        `${rangeData.startId}-${modCase.caseId}: ${modCase.actionType} ${modCase.userTag} - ${
          modCase.reason?.value || "No reason set"
        }`,
        MAX_CHOICE_NAME_LEN,
      ),
      value: `${rangeData.startId}-${modCase.caseId}`,
    }));
  }

  private async getSingleCaseSuggestions(
    guildId: string,
    caseId: number,
  ): Promise<APIApplicationCommandOptionChoice<string>[]> {
    const searchResult = await this.modLogRepository.searchByIdPrefix(
      guildId,
      caseId.toString(),
      25,
    );

    if (searchResult.err) {
      return [];
    }

    return this.formatCases(searchResult.val);
  }

  private formatCases(
    cases: ModerationCase[],
  ): APIApplicationCommandOptionChoice<string>[] {
    return cases.slice(0, 25).map((modCase) => ({
      name: this.formatCaseName(modCase),
      value: modCase.caseId,
    }));
  }

  private formatCaseName(modCase: ModerationCase): string {
    const reasonText = modCase.reason?.value || "No reason set";
    const name = `${modCase.caseId}: ${modCase.actionType} ${modCase.userTag} - ${reasonText}`;
    return this.truncateWithEllipsis(name, MAX_CHOICE_NAME_LEN);
  }

  private truncateWithEllipsis(str: string, len: number): string {
    if (str.length <= len) {
      return str;
    }
    return `${str.slice(0, len - 3)}...`;
  }
}
