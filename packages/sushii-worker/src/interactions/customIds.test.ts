import { describe, expect, test } from "bun:test";
import type { Match } from "path-to-regexp";

import customIds from "./customIds";

describe("customIds", () => {
  describe("roleMenuButton", () => {
    describe.each([
      {
        customID: "/rolemenu/button/",
        wantMatch: false,
      },
      {
        customID: "/rolemenu/button/123",
        wantMatch: {
          params: {
            roleId: "123",
          },
          path: "/rolemenu/button/123",
        },
      },
      {
        customID: "/rolemenu/button/12345",
        wantMatch: {
          params: {
            roleId: "12345",
          },
          path: "/rolemenu/button/12345",
        },
      },
    ])("roleMenuButtonMatch($customID)", ({ customID, wantMatch }) => {
      test(`matches role menu button ${customID}`, () => {
        const match = customIds.roleMenuButton.match(customID);

        if (wantMatch) {
          expect(match).toEqual(
            wantMatch as unknown as Match<{
              roleId: string;
            }>,
          );
        } else {
          // Failure!
          expect(match).toBeFalse();
        }
      });

      test(`menu button compile matches ${customID}`, () => {
        if (wantMatch && typeof wantMatch !== "boolean") {
          // Compiling matches the same custom id
          expect(
            customIds.roleMenuButton.compile({
              roleId: wantMatch.params.roleId,
            }),
          ).toEqual(customID);
        }
      });
    });
  });

  describe("roleMenuSelect", () => {
    describe.each([
      {
        customID: "/rolemenu/select",
        wantMatch: {
          params: {},
          path: "/rolemenu/select",
        },
      },
    ])("roleMenuSelect($customID)", ({ customID, wantMatch }) => {
      test(`matches role menu select menu ${customID}`, () => {
        expect(customIds.roleMenuSelect.match(customID)).toEqual(wantMatch);
      });

      test(`menu select compile matches ${customID}`, () => {
        // Compiling matches the same custom id
        expect(customIds.roleMenuSelect.compile()).toEqual(customID);
      });
    });
  });
});
