import type { SearchGroups, SearchResult } from "./domain/types";

export const flattenSearchGroups = (groups: SearchGroups): SearchResult[] => [
  ...groups.spaces,
  ...groups.stacks,
  ...groups.openTabs,
  ...groups.savedTabs,
  ...groups.history
];
