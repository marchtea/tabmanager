import { normalizeUrl } from "../domain/workspaceStore";
import { buildSearchGroups } from "../domain/search";
import { DEFAULT_GLOBAL_SEARCH_SHORTCUT, defaultSettings, normalizeSettings, normalizeShortcut } from "../domain/settings";
import type { HistoryEntry, OpenTab, OpenTabBlock, SearchGroups, SearchResult, TabManagerSettings, WorkspaceState } from "../domain/types";
import { emptyWorkspaceState, mergeWorkspaceStateChanges, normalizeWorkspaceState } from "../domain/workspaceStore";
import { createLocalState, isWorkspaceState, normalizeLocalState, type TabDockLocalStateV1 } from "../domain/persistence";
import type { ChromeHistoryRecord, ChromeLike, ChromeStorageChange, ChromeTabRecord } from "./chromeTypes";

const STORAGE_KEY = "tabManagerWorkspace";
const SETTINGS_STORAGE_KEY = "tabManagerSettings";
const LOCAL_STATE_STORAGE_KEY = "tabdock:local-state:v1";
const GLOBAL_SEARCH_COMMAND = "open_global_search";

export const getChrome = (): ChromeLike | undefined => {
  if (typeof chrome === "undefined") {
    return undefined;
  }
  const chromeApi = chrome as ChromeLike;
  if (!chromeApi.runtime?.id || !chromeApi.storage?.local) {
    return undefined;
  }
  return chromeApi;
};

export const isTabManagerUrl = (url: string | undefined, extensionId?: string): boolean => {
  if (!url) {
    return false;
  }
  if (url === "chrome://newtab/" || url === "chrome://newtab") {
    return true;
  }
  if (!extensionId) {
    return false;
  }
  return url.startsWith(`chrome-extension://${extensionId}/`) && url.includes("index.html");
};

export const buildTabManagerUrl = (
  chromeApi: ChromeLike,
  query: Record<string, string | undefined> = {}
): string => {
  const extensionUrl = chromeApi.runtime?.getURL?.("index.html") ?? "index.html";
  const url = new URL(extensionUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
};

export const groupOpenTabs = async (chromeApi: ChromeLike): Promise<OpenTabBlock[]> => {
  const tabs = await listOpenTabRecords(chromeApi);
  const extensionId = chromeApi.runtime?.id;
  const grouped = tabs
    .filter((tab) => !isTabManagerUrl(tab.url, extensionId))
    .reduce<Map<number, OpenTab[]>>((blocks, tab) => {
      const openTab = mapChromeTab(tab);
      if (!openTab) {
        return blocks;
      }
      const existing = blocks.get(openTab.windowId) ?? [];
      blocks.set(openTab.windowId, [...existing, openTab]);
      return blocks;
    }, new Map());

  return [...grouped.entries()].map(([windowId, blockTabs], index) => ({
    windowId,
    label: `Window ${index + 1} · ${blockTabs.length} tabs`,
    tabs: blockTabs
  }));
};

export const focusOrCreateTab = async (chromeApi: ChromeLike, url: string): Promise<void> => {
  const openTabs = await listOpenTabRecords(chromeApi);
  const normalized = normalizeUrl(url);
  const existing = openTabs.find((tab) => tab.id && normalizeUrl(tab.url ?? "") === normalized);

  if (existing?.id) {
    if (existing.windowId) {
      await chromeApi.windows?.update?.(existing.windowId, { focused: true });
    }
    await chromeApi.tabs?.update?.(existing.id, { active: true });
    return;
  }

  await chromeApi.tabs?.create?.({ url });
};

export const focusOrOpenTabManager = async (
  chromeApi: ChromeLike,
  query: Record<string, string | undefined> = {}
): Promise<void> => {
  const url = buildTabManagerUrl(chromeApi, query);

  const openTabs = await listOpenTabRecords(chromeApi);
  const existing = openTabs.find((tab) => isTabManagerUrl(tab.url, chromeApi.runtime?.id));
  if (existing?.id) {
    if (existing.windowId) {
      await chromeApi.windows?.update?.(existing.windowId, { focused: true });
    }
    await chromeApi.tabs?.update?.(existing.id, { active: true, url });
    return;
  }

  await chromeApi.tabs?.create?.({ url });
};

export const moveOpenTabToWindow = async (
  chromeApi: ChromeLike,
  tabId: number,
  targetWindowId: number
): Promise<void> => {
  await chromeApi.tabs?.move?.(tabId, { windowId: targetWindowId, index: -1 });
};

export const closeOpenTab = async (chromeApi: ChromeLike, tabId: number): Promise<void> => {
  await chromeApi.tabs?.remove?.(tabId);
};

export const closeOpenWindow = async (chromeApi: ChromeLike, windowId: number): Promise<void> => {
  await chromeApi.windows?.remove?.(windowId);
};

export const subscribeToOpenTabsChanges = (
  chromeApi: ChromeLike,
  onChange: () => void
): (() => void) => {
  const onCreated = () => onChange();
  const onUpdated = () => onChange();
  const onRemoved = () => onChange();

  chromeApi.tabs?.onCreated?.addListener?.(onCreated);
  chromeApi.tabs?.onUpdated?.addListener?.(onUpdated);
  chromeApi.tabs?.onRemoved?.addListener?.(onRemoved);

  return () => {
    chromeApi.tabs?.onCreated?.removeListener?.(onCreated);
    chromeApi.tabs?.onUpdated?.removeListener?.(onUpdated);
    chromeApi.tabs?.onRemoved?.removeListener?.(onRemoved);
  };
};

export const closeDuplicateOpenTabs = async (chromeApi: ChromeLike): Promise<number> => {
  const protectedTabId = await getActiveTabId(chromeApi);
  const tabs = await listOpenTabRecords(chromeApi);
  const extensionId = chromeApi.runtime?.id;
  const seenTabsByUrl = new Map<string, ChromeTabRecord>();
  const duplicateTabIds = new Set<number>();

  for (const tab of tabs) {
    if (!tab.id || !tab.url) {
      continue;
    }

    const normalizedUrl = getDuplicateTabKey(tab.url, extensionId);
    const seenTab = seenTabsByUrl.get(normalizedUrl);
    if (!seenTab) {
      seenTabsByUrl.set(normalizedUrl, tab);
      continue;
    }

    if (tab.id === protectedTabId) {
      if (seenTab.id && seenTab.id !== protectedTabId) {
        duplicateTabIds.add(seenTab.id);
      }
      seenTabsByUrl.set(normalizedUrl, tab);
      continue;
    }

    duplicateTabIds.add(tab.id);
  }

  const idsToClose = [...duplicateTabIds];
  if (idsToClose.length === 0 || !chromeApi.tabs?.remove) {
    return 0;
  }

  await chromeApi.tabs.remove(idsToClose);
  return idsToClose.length;
};

const getActiveTabId = async (chromeApi: ChromeLike): Promise<number | undefined> => {
  const [activeTab] = await chromeApi.tabs?.query?.({ active: true, currentWindow: true }) ?? [];
  return activeTab?.id;
};

const getDuplicateTabKey = (url: string, extensionId?: string): string => {
  if (isTabManagerUrl(url, extensionId)) {
    return `tabdock:${extensionId ?? "newtab"}`;
  }
  return normalizeUrl(url);
};

const listOpenTabRecords = async (chromeApi: ChromeLike): Promise<ChromeTabRecord[]> => {
  const windows = await chromeApi.windows?.getAll?.({ populate: true });
  const populatedTabs =
    windows?.flatMap((windowRecord) =>
      (windowRecord.tabs ?? []).map((tab) => ({
        ...tab,
        windowId: tab.windowId ?? windowRecord.id
      }))
    ) ?? [];

  if (populatedTabs.length > 0) {
    return populatedTabs;
  }

  return await chromeApi.tabs?.query?.({}) ?? [];
};

export const getMetaDescription = async (
  chromeApi: ChromeLike,
  tabId: number
): Promise<string | undefined> => {
  try {
    const results = await chromeApi.scripting?.executeScript?.({
      target: { tabId },
      func: () =>
        document
          .querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]')
          ?.content?.trim()
    });
    const description = results?.[0]?.result?.trim();
    return description || undefined;
  } catch {
    return undefined;
  }
};

export const searchRecentHistory = async (
  chromeApi: ChromeLike,
  text: string,
  now: number,
  maxResults = 100
): Promise<HistoryEntry[]> => {
  const startTime = now - 90 * 24 * 60 * 60 * 1000;
  const records = await chromeApi.history?.search?.({ text, startTime, maxResults }) ?? [];
  return records.flatMap(mapHistoryRecord);
};

export const buildGlobalSearchGroups = async (
  chromeApi: ChromeLike,
  query: string,
  timestamp: number
): Promise<SearchGroups> => {
  const [workspace, openBlocks, historyEntries] = await Promise.all([
    loadWorkspace(chromeApi),
    groupOpenTabs(chromeApi),
    query.trim() ? searchRecentHistory(chromeApi, query, timestamp) : Promise.resolve([])
  ]);
  return buildSearchGroups(query, workspace, openBlocks, historyEntries, timestamp);
};

export const handleGlobalSearchResult = async (
  chromeApi: ChromeLike,
  result: SearchResult
): Promise<void> => {
  if ((result.kind === "saved-tab" || result.kind === "open-tab" || result.kind === "history") && result.url) {
    await focusOrCreateTab(chromeApi, result.url);
    return;
  }

  if (result.kind === "space" && result.spaceId) {
    await focusOrOpenTabManager(chromeApi, { space: result.spaceId });
    return;
  }

  if (result.kind === "stack" && result.spaceId && result.stackId) {
    await focusOrOpenTabManager(chromeApi, { space: result.spaceId, stack: result.stackId });
  }
};

export const loadWorkspace = async (chromeApi: ChromeLike | undefined): Promise<WorkspaceState> => {
  return (await loadLocalState(chromeApi)).workspace;
};

export const saveWorkspace = async (
  chromeApi: ChromeLike | undefined,
  state: WorkspaceState
): Promise<void> => {
  const currentState = await loadLocalState(chromeApi);
  await saveLocalState(chromeApi, state, currentState.settings);
};

export const loadSettings = async (chromeApi: ChromeLike | undefined): Promise<TabManagerSettings> => {
  return (await loadLocalState(chromeApi)).settings;
};

export const saveSettings = async (
  chromeApi: ChromeLike | undefined,
  settings: TabManagerSettings
): Promise<void> => {
  const currentState = await loadLocalState(chromeApi);
  await saveLocalState(chromeApi, currentState.workspace, settings);
};

export const loadLocalState = async (chromeApi: ChromeLike | undefined): Promise<TabDockLocalStateV1> => {
  const data = await chromeApi?.storage?.local?.get?.([
    LOCAL_STATE_STORAGE_KEY,
    STORAGE_KEY,
    SETTINGS_STORAGE_KEY
  ]);
  const persistedState = normalizeLocalState(data?.[LOCAL_STATE_STORAGE_KEY]);
  if (persistedState) {
    return persistedState;
  }

  const legacyWorkspace = data?.[STORAGE_KEY];
  return createLocalState(
    isWorkspaceState(legacyWorkspace) ? normalizeWorkspaceState(legacyWorkspace) : emptyWorkspaceState(),
    normalizeSettings(data?.[SETTINGS_STORAGE_KEY] ?? defaultSettings()),
    () => 0
  );
};

export const saveLocalState = async (
  chromeApi: ChromeLike | undefined,
  workspace: WorkspaceState,
  settings: TabManagerSettings,
  mergeBase?: TabDockLocalStateV1
): Promise<TabDockLocalStateV1> => {
  const latestState = mergeBase && chromeApi ? await loadLocalState(chromeApi) : undefined;
  const state = createLocalState(
    latestState && mergeBase
      ? mergeWorkspaceStateChanges(mergeBase.workspace, workspace, latestState.workspace)
      : workspace,
    latestState && mergeBase && isEqual(settings, mergeBase.settings) ? latestState.settings : settings,
    () => Date.now()
  );
  await chromeApi?.storage?.local?.set?.({ [LOCAL_STATE_STORAGE_KEY]: state });
  return state;
};

export const subscribeToLocalStateChanges = (
  chromeApi: ChromeLike | undefined,
  onChange: (state: TabDockLocalStateV1) => void
): (() => void) => {
  const listener = (changes: Record<string, ChromeStorageChange>, areaName: string) => {
    if (areaName !== "local") {
      return;
    }
    const state = normalizeLocalState(changes[LOCAL_STATE_STORAGE_KEY]?.newValue);
    if (state) {
      onChange(state);
    }
  };

  chromeApi?.storage?.onChanged?.addListener?.(listener);
  return () => chromeApi?.storage?.onChanged?.removeListener?.(listener);
};

export const getGlobalSearchShortcut = async (chromeApi: ChromeLike | undefined): Promise<string> => {
  const commands = await chromeApi?.commands?.getAll?.() ?? [];
  const command = commands.find((item) => item.name === GLOBAL_SEARCH_COMMAND);
  if (!command) {
    return DEFAULT_GLOBAL_SEARCH_SHORTCUT;
  }

  const shortcut = command.shortcut?.trim() ?? "";
  if (!shortcut) {
    return "";
  }

  return normalizeShortcut(shortcut) ?? shortcut;
};

const mapChromeTab = (tab: ChromeTabRecord): OpenTab | undefined => {
  if (!tab.id || !tab.windowId || !tab.url) {
    return undefined;
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.url,
    url: tab.url,
    faviconUrl: tab.favIconUrl,
    active: tab.active
  };
};

const mapHistoryRecord = (record: ChromeHistoryRecord): HistoryEntry[] => {
  if (!record.url) {
    return [];
  }
  return [
    {
      id: record.id ?? record.url,
      title: record.title || record.url,
      url: record.url,
      lastVisitTime: record.lastVisitTime ?? 0
    }
  ];
};

const isEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
