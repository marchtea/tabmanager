import type {
  HistoryEntry,
  OpenTabBlock,
  SearchGroups,
  SearchResult,
  WorkspaceState
} from "./types";
import { getOrderedSpaces } from "./workspaceStore";

const HISTORY_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const emptySearchGroups = (): SearchGroups => ({
  spaces: [],
  stacks: [],
  savedTabs: [],
  openTabs: [],
  history: []
});

export const filterRecentHistory = (
  entries: HistoryEntry[],
  now: number,
  days = HISTORY_WINDOW_DAYS
): HistoryEntry[] => {
  const earliest = now - days * DAY_MS;
  return entries.filter((entry) => entry.lastVisitTime >= earliest);
};

export const buildSearchGroups = (
  query: string,
  state: WorkspaceState,
  openBlocks: OpenTabBlock[],
  historyEntries: HistoryEntry[],
  now: number
): SearchGroups => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return emptySearchGroups();
  }

  const spaces = getOrderedSpaces(state)
    .filter((space) => matches(normalizedQuery, [space.name]))
    .map<SearchResult>((space) => ({
      id: `space:${space.id}`,
      kind: "space",
      title: space.name,
      subtitle: "Space",
      spaceId: space.id
    }));

  const stacks = Object.values(state.stacks)
    .filter((stack) => matches(normalizedQuery, [stack.name]))
    .map<SearchResult>((stack) => ({
      id: `stack:${stack.id}`,
      kind: "stack",
      title: stack.name,
      subtitle: state.spaces[stack.spaceId]?.name,
      spaceId: stack.spaceId,
      stackId: stack.id
    }));

  const savedTabs = Object.values(state.tabs)
    .filter((tab) => matches(normalizedQuery, [tab.title, tab.url, tab.description]))
    .map<SearchResult>((tab) => ({
      id: `saved-tab:${tab.id}`,
      kind: "saved-tab",
      title: tab.title,
      subtitle: tab.description || tab.url,
      spaceId: tab.spaceId,
      stackId: tab.stackId,
      tabId: tab.id,
      url: tab.url
    }));

  const openTabs = openBlocks.flatMap((block) =>
    block.tabs
      .filter((tab) => matches(normalizedQuery, [tab.title, tab.url, tab.description]))
      .map<SearchResult>((tab) => ({
        id: `open-tab:${block.windowId}:${tab.id}`,
        kind: "open-tab",
        title: tab.title,
        subtitle: tab.description || tab.url,
        url: tab.url,
        windowId: block.windowId,
        tabId: String(tab.id)
      }))
  );

  const history = filterRecentHistory(historyEntries, now)
    .filter((entry) => matches(normalizedQuery, [entry.title, entry.url]))
    .map<SearchResult>((entry) => ({
      id: `history:${entry.id}`,
      kind: "history",
      title: entry.title || entry.url,
      subtitle: entry.url,
      url: entry.url
    }));

  return { spaces, stacks, savedTabs, openTabs, history };
};

const matches = (query: string, fields: Array<string | undefined>): boolean =>
  fields.some((field) => normalizeText(field).includes(query));

const normalizeText = (value?: string): string => value?.trim().toLowerCase() ?? "";
