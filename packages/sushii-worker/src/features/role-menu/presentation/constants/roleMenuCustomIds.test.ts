import { describe, expect, test } from "bun:test";
import { match } from "path-to-regexp";

import { roleMenuCustomIds } from "./roleMenuCustomIds";

describe("roleMenuCustomIds", () => {
  describe("all paths parse without error", () => {
    test.each(Object.entries(roleMenuCustomIds))("%s", (_name, helper) => {
      expect(() => match(helper.path)).not.toThrow();
    });
  });
});
