import { describe, expect, it } from "vitest";
import type { SearchGroups } from "./domain/types";
import { flattenSearchGroups } from "./searchResultOrder";

describe("flattenSearchGroups", () => {
  it("prioritizes open tabs before saved tabs and history", () => {
    const groups: SearchGroups = {
      spaces: [],
      stacks: [],
      savedTabs: [{ id: "saved:1", kind: "saved-tab", title: "Saved result", url: "https://saved.test" }],
      openTabs: [{ id: "open:1", kind: "open-tab", title: "Open result", url: "https://open.test" }],
      history: [{ id: "history:1", kind: "history", title: "History result", url: "https://history.test" }]
    };

    expect(flattenSearchGroups(groups).map((result) => result.kind)).toEqual([
      "open-tab",
      "saved-tab",
      "history"
    ]);
  });
});
