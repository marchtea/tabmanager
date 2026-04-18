import { normalizeUrl } from "../domain/workspaceStore";
import type { HistoryEntry, OpenTab, OpenTabBlock, WorkspaceState } from "../domain/types";
import { emptyWorkspaceState } from "../domain/workspaceStore";
import type { ChromeHistoryRecord, ChromeLike, ChromeTabRecord } from "./chromeTypes";

const STORAGE_KEY = "tabManagerWorkspace";

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
  const tabs = await chromeApi.tabs?.query?.({}) ?? [];
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
  const openTabs = await chromeApi.tabs?.query?.({}) ?? [];
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

export const loadWorkspace = async (chromeApi: ChromeLike | undefined): Promise<WorkspaceState> => {
  const data = await chromeApi?.storage?.local?.get?.([STORAGE_KEY]);
  const value = data?.[STORAGE_KEY];
  return isWorkspaceState(value) ? value : emptyWorkspaceState();
};

export const saveWorkspace = async (
  chromeApi: ChromeLike | undefined,
  state: WorkspaceState
): Promise<void> => {
  await chromeApi?.storage?.local?.set?.({ [STORAGE_KEY]: state });
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
