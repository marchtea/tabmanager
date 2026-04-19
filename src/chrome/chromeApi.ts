import { normalizeUrl } from "../domain/workspaceStore";
import { buildSearchGroups } from "../domain/search";
import { normalizeSettings } from "../domain/settings";
import type { HistoryEntry, OpenTab, OpenTabBlock, SearchGroups, SearchResult, TabManagerSettings, WorkspaceState } from "../domain/types";
import { emptyWorkspaceState, normalizeWorkspaceState } from "../domain/workspaceStore";
import type { ChromeHistoryRecord, ChromeLike, ChromeTabRecord } from "./chromeTypes";

const STORAGE_KEY = "tabManagerWorkspace";
const SETTINGS_STORAGE_KEY = "tabManagerSettings";
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
  if (!url || !extensionId) {
    return false;
  }
  return url.startsWith(`chrome-extension://${extensionId}/`) && url.includes("index.html");
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
  const extensionUrl = chromeApi.runtime?.getURL?.("index.html") ?? "index.html";
  const url = new URL(extensionUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const openTabs = await listOpenTabRecords(chromeApi);
  const existing = openTabs.find((tab) => isTabManagerUrl(tab.url, chromeApi.runtime?.id));
  if (existing?.id) {
    if (existing.windowId) {
      await chromeApi.windows?.update?.(existing.windowId, { focused: true });
    }
    await chromeApi.tabs?.update?.(existing.id, { active: true, url: url.toString() });
    return;
  }

  await chromeApi.tabs?.create?.({ url: url.toString() });
};

export const moveOpenTabToWindow = async (
  chromeApi: ChromeLike,
  tabId: number,
  targetWindowId: number
): Promise<void> => {
  await chromeApi.tabs?.move?.(tabId, { windowId: targetWindowId, index: -1 });
};

export const closeDuplicateOpenTabs = async (chromeApi: ChromeLike): Promise<number> => {
  const tabs = await listOpenTabRecords(chromeApi);
  const extensionId = chromeApi.runtime?.id;
  const seenUrls = new Set<string>();
  const duplicateTabIds = tabs.flatMap((tab) => {
    if (!tab.id || !tab.url || isTabManagerUrl(tab.url, extensionId)) {
      return [];
    }

    const normalizedUrl = normalizeUrl(tab.url);
    if (seenUrls.has(normalizedUrl)) {
      return [tab.id];
    }

    seenUrls.add(normalizedUrl);
    return [];
  });

  if (duplicateTabIds.length === 0 || !chromeApi.tabs?.remove) {
    return 0;
  }

  await chromeApi.tabs.remove(duplicateTabIds);
  return duplicateTabIds.length;
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
  const data = await chromeApi?.storage?.local?.get?.([STORAGE_KEY]);
  const value = data?.[STORAGE_KEY];
  return isWorkspaceState(value) ? normalizeWorkspaceState(value) : emptyWorkspaceState();
};

export const saveWorkspace = async (
  chromeApi: ChromeLike | undefined,
  state: WorkspaceState
): Promise<void> => {
  await chromeApi?.storage?.local?.set?.({ [STORAGE_KEY]: state });
};

export const loadSettings = async (chromeApi: ChromeLike | undefined): Promise<TabManagerSettings> => {
  const data = await chromeApi?.storage?.local?.get?.([SETTINGS_STORAGE_KEY]);
  return normalizeSettings(data?.[SETTINGS_STORAGE_KEY]);
};

export const saveSettings = async (
  chromeApi: ChromeLike | undefined,
  settings: TabManagerSettings
): Promise<void> => {
  await chromeApi?.storage?.local?.set?.({ [SETTINGS_STORAGE_KEY]: normalizeSettings(settings) });
};

export const getGlobalSearchShortcut = async (chromeApi: ChromeLike | undefined): Promise<string> => {
  const commands = await chromeApi?.commands?.getAll?.() ?? [];
  return commands.find((command) => command.name === GLOBAL_SEARCH_COMMAND)?.shortcut || "Command+Shift+K";
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

const isWorkspaceState = (value: unknown): value is WorkspaceState => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WorkspaceState>;
  return (
    typeof candidate.spaces === "object" &&
    typeof candidate.stacks === "object" &&
    typeof candidate.tabs === "object"
  );
};
