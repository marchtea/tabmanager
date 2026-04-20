import type { OpenTab, SavedTab, Space, Stack, WorkspaceState } from "./types";

export type Clock = () => number;
export type IdGenerator = () => string;

export const emptyWorkspaceState = (): WorkspaceState => ({
  spaceIds: [],
  spaces: {},
  stacks: {},
  tabs: {}
});

export const createIdGenerator = (prefix: string): IdGenerator => {
  let count = 0;
  return () => `${prefix}-${Date.now().toString(36)}-${(count += 1).toString(36)}`;
};

const TRACKING_PARAM_NAMES = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "msclkid",
  "spm",
  "spm_id_from",
  "vero_conv",
  "vero_id",
  "yclid"
]);

export const normalizeUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith("utm_") || TRACKING_PARAM_NAMES.has(normalizedKey)) {
        parsed.searchParams.delete(key);
      }
    }
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return url.trim().replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();
  }
};

export const createSpace = (
  state: WorkspaceState,
  name: string,
  clock: Clock,
  createId: IdGenerator
): WorkspaceState => {
  const normalizedState = normalizeWorkspaceState(state);
  const now = clock();
  const id = createId();
  const space: Space = {
    id,
    name: name.trim() || "未命名 Space",
    stackIds: [],
    createdAt: now,
    updatedAt: now
  };

  return {
    ...normalizedState,
    spaceIds: [...normalizedState.spaceIds, id],
    spaces: { ...normalizedState.spaces, [id]: space },
    activeSpaceId: id
  };
};

export const renameSpace = (
  state: WorkspaceState,
  spaceId: string,
  name: string,
  clock: Clock
): WorkspaceState => {
  const space = state.spaces[spaceId];
  if (!space) {
    return state;
  }

  return {
    ...state,
    spaces: {
      ...state.spaces,
      [spaceId]: { ...space, name: name.trim() || space.name, updatedAt: clock() }
    }
  };
};

export const deleteSpace = (state: WorkspaceState, spaceId: string): WorkspaceState => {
  const normalizedState = normalizeWorkspaceState(state);
  const space = normalizedState.spaces[spaceId];
  if (!space) {
    return state;
  }

  const stacks = { ...normalizedState.stacks };
  const tabs = { ...normalizedState.tabs };
  for (const stackId of space.stackIds) {
    const stack = stacks[stackId];
    if (stack) {
      for (const tabId of stack.tabIds) {
        delete tabs[tabId];
      }
      delete stacks[stackId];
    }
  }

  const spaces = { ...normalizedState.spaces };
  delete spaces[spaceId];
  const spaceIds = normalizedState.spaceIds.filter((id) => id !== spaceId);
  const nextActiveSpaceId =
    normalizedState.activeSpaceId === spaceId ? spaceIds[0] : normalizedState.activeSpaceId;

  return { spaceIds, spaces, stacks, tabs, activeSpaceId: nextActiveSpaceId };
};

export const createStack = (
  state: WorkspaceState,
  spaceId: string,
  name: string,
  clock: Clock,
  createId: IdGenerator
): WorkspaceState => {
  const space = state.spaces[spaceId];
  if (!space) {
    return state;
  }

  const now = clock();
  const id = createId();
  const stack: Stack = {
    id,
    spaceId,
    name: name.trim() || "未命名 Stack",
    tabIds: [],
    createdAt: now,
    updatedAt: now
  };

  return {
    ...state,
    spaces: {
      ...state.spaces,
      [spaceId]: { ...space, stackIds: [...space.stackIds, id], updatedAt: now }
    },
    stacks: { ...state.stacks, [id]: stack }
  };
};

export const renameStack = (
  state: WorkspaceState,
  stackId: string,
  name: string,
  clock: Clock
): WorkspaceState => {
  const stack = state.stacks[stackId];
  if (!stack) {
    return state;
  }

  return {
    ...state,
    stacks: {
      ...state.stacks,
      [stackId]: { ...stack, name: name.trim() || stack.name, updatedAt: clock() }
    }
  };
};

export const deleteStack = (
  state: WorkspaceState,
  spaceId: string,
  stackId: string,
  clock: Clock
): WorkspaceState => {
  const space = state.spaces[spaceId];
  const stack = state.stacks[stackId];
  if (!space || !stack) {
    return state;
  }

  const tabs = { ...state.tabs };
  for (const tabId of stack.tabIds) {
    delete tabs[tabId];
  }

  const stacks = { ...state.stacks };
  delete stacks[stackId];

  return {
    ...state,
    spaces: {
      ...state.spaces,
      [spaceId]: {
        ...space,
        stackIds: space.stackIds.filter((id) => id !== stackId),
        updatedAt: clock()
      }
    },
    stacks,
    tabs
  };
};

export const deleteSavedTabs = (
  state: WorkspaceState,
  spaceId: string,
  stackId: string,
  tabIds: string[],
  clock: Clock
): WorkspaceState => {
  const space = state.spaces[spaceId];
  const stack = state.stacks[stackId];
  if (!space || !stack || stack.spaceId !== spaceId || tabIds.length === 0) {
    return state;
  }

  const requestedTabIds = [...new Set(tabIds)];
  const removableTabIds = requestedTabIds.filter((tabId) => {
    const tab = state.tabs[tabId];
    return Boolean(tab && tab.spaceId === spaceId && tab.stackId === stackId && stack.tabIds.includes(tabId));
  });
  if (removableTabIds.length === 0) {
    return state;
  }

  const removableTabIdSet = new Set(removableTabIds);
  const tabs = { ...state.tabs };
  for (const tabId of removableTabIds) {
    delete tabs[tabId];
  }

  return {
    ...state,
    stacks: {
      ...state.stacks,
      [stackId]: {
        ...stack,
        tabIds: stack.tabIds.filter((tabId) => !removableTabIdSet.has(tabId)),
        updatedAt: clock()
      }
    },
    tabs
  };
};

export const moveStack = (
  state: WorkspaceState,
  spaceId: string,
  stackId: string,
  targetIndex: number,
  clock: Clock
): WorkspaceState => {
  const space = state.spaces[spaceId];
  if (!space || !space.stackIds.includes(stackId)) {
    return state;
  }

  const stackIds = moveId(space.stackIds, stackId, targetIndex);
  return {
    ...state,
    spaces: {
      ...state.spaces,
      [spaceId]: { ...space, stackIds, updatedAt: clock() }
    }
  };
};

export const moveSpace = (
  state: WorkspaceState,
  spaceId: string,
  targetIndex: number,
  clock: Clock
): WorkspaceState => {
  const normalizedState = normalizeWorkspaceState(state);
  const space = normalizedState.spaces[spaceId];
  if (!space || !normalizedState.spaceIds.includes(spaceId)) {
    return state;
  }

  return {
    ...normalizedState,
    spaceIds: moveId(normalizedState.spaceIds, spaceId, targetIndex),
    spaces: {
      ...normalizedState.spaces,
      [spaceId]: { ...space, updatedAt: clock() }
    }
  };
};

export const moveSavedTab = (
  state: WorkspaceState,
  spaceId: string,
  tabId: string,
  targetStackId: string,
  targetIndex: number,
  clock: Clock
): WorkspaceState => {
  const tab = state.tabs[tabId];
  const targetStack = state.stacks[targetStackId];
  if (!tab || !targetStack || tab.spaceId !== spaceId || targetStack.spaceId !== spaceId) {
    return state;
  }

  const now = clock();
  const sourceStack = state.stacks[tab.stackId];
  const sourceTabIds =
    sourceStack && sourceStack.id !== targetStackId
      ? sourceStack.tabIds.filter((id) => id !== tabId)
      : undefined;
  const targetBaseIds =
    sourceStack?.id === targetStackId
      ? targetStack.tabIds
      : targetStack.tabIds.filter((id) => id !== tabId);
  const targetTabIds = insertId(targetBaseIds, tabId, targetIndex);

  return {
    ...state,
    stacks: {
      ...state.stacks,
      ...(sourceStack && sourceTabIds
        ? { [sourceStack.id]: { ...sourceStack, tabIds: sourceTabIds, updatedAt: now } }
        : {}),
      [targetStackId]: { ...targetStack, tabIds: targetTabIds, updatedAt: now }
    },
    tabs: {
      ...state.tabs,
      [tabId]: { ...tab, stackId: targetStackId, updatedAt: now }
    }
  };
};

export const saveOpenTabToStack = (
  state: WorkspaceState,
  spaceId: string,
  stackId: string,
  openTab: OpenTab,
  targetIndex: number,
  clock: Clock,
  createId: IdGenerator
): WorkspaceState => {
  const targetStack = state.stacks[stackId];
  if (!state.spaces[spaceId] || !targetStack || targetStack.spaceId !== spaceId) {
    return state;
  }

  const existingTab = findTabByUrlInSpace(state, spaceId, openTab.url);
  if (existingTab) {
    const moved = moveSavedTab(state, spaceId, existingTab.id, stackId, targetIndex, clock);
    return updateSavedTabDetails(moved, existingTab.id, openTab, clock);
  }

  const now = clock();
  const id = createId();
  const savedTab: SavedTab = {
    id,
    spaceId,
    stackId,
    title: openTab.title || openTab.url,
    url: openTab.url,
    faviconUrl: openTab.faviconUrl,
    description: openTab.description,
    source: "open-tab",
    createdAt: now,
    updatedAt: now
  };

  return {
    ...state,
    stacks: {
      ...state.stacks,
      [stackId]: {
        ...targetStack,
        tabIds: insertId(targetStack.tabIds, id, targetIndex),
        updatedAt: now
      }
    },
    tabs: { ...state.tabs, [id]: savedTab }
  };
};

export const saveOpenWindowAsStack = (
  state: WorkspaceState,
  spaceId: string,
  stackName: string,
  openTabs: OpenTab[],
  clock: Clock,
  createId: IdGenerator
): WorkspaceState => {
  const stackId = createId();
  const withStack = createStack(state, spaceId, stackName, clock, () => stackId);
  return openTabs.reduce(
    (nextState, openTab, index) =>
      saveOpenTabToStack(nextState, spaceId, stackId, openTab, index, clock, createId),
    withStack
  );
};

export const getActiveSpace = (state: WorkspaceState): Space | undefined => {
  const normalizedState = normalizeWorkspaceState(state);
  if (normalizedState.activeSpaceId && normalizedState.spaces[normalizedState.activeSpaceId]) {
    return normalizedState.spaces[normalizedState.activeSpaceId];
  }
  const firstSpaceId = normalizedState.spaceIds[0];
  return firstSpaceId ? normalizedState.spaces[firstSpaceId] : undefined;
};

export const getOrderedSpaces = (state: WorkspaceState): Space[] => {
  const normalizedState = normalizeWorkspaceState(state);
  return normalizedState.spaceIds
    .map((spaceId) => normalizedState.spaces[spaceId])
    .filter((space): space is Space => Boolean(space));
};

export const normalizeWorkspaceState = (state: WorkspaceState): WorkspaceState => {
  const knownSpaceIds = new Set(Object.keys(state.spaces));
  const orderedSpaceIds = [
    ...(Array.isArray(state.spaceIds) ? state.spaceIds.filter((id) => knownSpaceIds.has(id)) : []),
    ...Object.keys(state.spaces).filter((id) => !state.spaceIds?.includes(id))
  ];

  return {
    ...state,
    spaceIds: orderedSpaceIds
  };
};

const findTabByUrlInSpace = (
  state: WorkspaceState,
  spaceId: string,
  url: string
): SavedTab | undefined => {
  const normalized = normalizeUrl(url);
  return Object.values(state.tabs).find(
    (tab) => tab.spaceId === spaceId && normalizeUrl(tab.url) === normalized
  );
};

const updateSavedTabDetails = (
  state: WorkspaceState,
  tabId: string,
  openTab: OpenTab,
  clock: Clock
): WorkspaceState => {
  const tab = state.tabs[tabId];
  if (!tab) {
    return state;
  }

  return {
    ...state,
    tabs: {
      ...state.tabs,
      [tabId]: {
        ...tab,
        title: openTab.title || tab.title,
        url: openTab.url || tab.url,
        faviconUrl: openTab.faviconUrl ?? tab.faviconUrl,
        description: openTab.description ?? tab.description,
        updatedAt: clock()
      }
    }
  };
};

const moveId = (ids: string[], id: string, targetIndex: number): string[] => {
  const withoutId = ids.filter((item) => item !== id);
  return insertId(withoutId, id, targetIndex);
};

const insertId = (ids: string[], id: string, targetIndex: number): string[] => {
  const nextIds = ids.filter((item) => item !== id);
  const index = Math.max(0, Math.min(targetIndex, nextIds.length));
  return [...nextIds.slice(0, index), id, ...nextIds.slice(index)];
};
