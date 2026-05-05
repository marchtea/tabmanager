export type TabSource = "open-tab" | "history" | "manual";

export type Space = {
  id: string;
  name: string;
  stackIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type Stack = {
  id: string;
  spaceId: string;
  name: string;
  tabIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type SavedTab = {
  id: string;
  spaceId: string;
  stackId: string;
  title: string;
  url: string;
  faviconUrl?: string;
  description?: string;
  source: TabSource;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceState = {
  spaceIds: string[];
  spaces: Record<string, Space>;
  stacks: Record<string, Stack>;
  tabs: Record<string, SavedTab>;
  activeSpaceId?: string;
};

export type TabManagerSettings = {
  appSearchShortcut: string;
};

export type OpenTab = {
  id: number;
  windowId: number;
  title: string;
  url: string;
  faviconUrl?: string;
  description?: string;
  active?: boolean;
};

export type OpenTabBlock = {
  windowId: number;
  label: string;
  tabs: OpenTab[];
};

export type HistoryEntry = {
  id: string;
  title: string;
  url: string;
  lastVisitTime: number;
};

export type SearchResultKind =
  | "space"
  | "stack"
  | "saved-tab"
  | "open-tab"
  | "history"
  | "google-search";

export type SearchResult = {
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle?: string;
  spaceId?: string;
  stackId?: string;
  tabId?: string;
  url?: string;
  windowId?: number;
};

export type SearchGroups = {
  spaces: SearchResult[];
  stacks: SearchResult[];
  savedTabs: SearchResult[];
  openTabs: SearchResult[];
  history: SearchResult[];
};
