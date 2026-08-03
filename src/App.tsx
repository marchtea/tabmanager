import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeOpenTab,
  closeOpenWindow,
  closeDuplicateOpenTabs,
  focusOrCreateTab,
  getChrome,
  getGlobalSearchShortcut,
  groupOpenTabs,
  loadLocalState,
  moveOpenTabToWindow,
  saveLocalState,
  searchRecentHistory,
  subscribeToLocalStateChanges,
  subscribeToOpenTabsChanges
} from "./chrome/chromeApi";
import {
  authorizeBackupDirectory,
  getBackupDirectoryStatus,
  readLatestBackup,
  writeLatestBackup,
  type BackupDirectoryStatus
} from "./chrome/localBackup";
import {
  createLocalState,
  parseImportedLocalState,
  serializeLocalState,
  type TabDockLocalStateV1
} from "./domain/persistence";
import { buildSearchGroups } from "./domain/search";
import { flattenSearchGroups } from "./searchResultOrder";
import {
  DEFAULT_GLOBAL_SEARCH_SHORTCUT,
  formatShortcutForPlatform,
  shortcutMatchesEvent
} from "./domain/settings";
import type { HistoryEntry, OpenTab, OpenTabBlock, SearchGroups, SearchResult, TabManagerSettings } from "./domain/types";
import {
  createIdGenerator,
  createSpace,
  createStack,
  deleteSavedTabs,
  deleteSpace,
  deleteStack,
  emptyWorkspaceState,
  getActiveSpace,
  getOpenTabsAlreadySavedInWorkspace,
  getOrderedSpaces,
  moveSavedTab,
  moveSpace,
  moveStack,
  normalizeUrl,
  renameSpace,
  renameStack,
  saveOpenTabToStack,
  saveOpenWindowAsStack,
  updateSavedTab
} from "./domain/workspaceStore";

type DragPayload =
  | { type: "open-tab"; tab: OpenTab }
  | { type: "open-block"; windowId: number }
  | { type: "saved-tab"; tabId: string }
  | { type: "stack"; stackId: string }
  | { type: "space"; spaceId: string };

type IconName =
  | "chevron-right"
  | "chevron-down"
  | "copy"
  | "check"
  | "check-square"
  | "edit"
  | "link"
  | "panel-right"
  | "plus"
  | "refresh"
  | "search"
  | "settings"
  | "trash"
  | "x";

const now = () => Date.now();
const maxImportFileSizeBytes = 2 * 1024 * 1024;

const demoOpenBlocks: OpenTabBlock[] = [
  {
    windowId: 1,
    label: "Window 1 · 3 tabs",
    tabs: [
      {
        id: 101,
        windowId: 1,
        title: "Chrome Extension Manifest V3",
        url: "https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3",
        description: "Manifest V3 migration notes"
      },
      {
        id: 102,
        windowId: 1,
        title: "React",
        url: "https://react.dev",
        description: "The library for web and native user interfaces"
      },
      {
        id: 103,
        windowId: 1,
        title: "Vite",
        url: "https://vite.dev",
        description: "Next generation frontend tooling"
      }
    ]
  }
];

export const App = () => {
  const chromeApi = useMemo(() => getChrome(), []);
  const idGeneratorRef = useRef(createIdGenerator("tm"));
  const [workspace, setWorkspace] = useState(emptyWorkspaceState);
  const [settings, setSettings] = useState<TabManagerSettings>({ appSearchShortcut: "Mod+K" });
  const [globalSearchShortcut, setGlobalSearchShortcut] = useState(DEFAULT_GLOBAL_SEARCH_SHORTCUT);
  const [openBlocks, setOpenBlocks] = useState<OpenTabBlock[]>(demoOpenBlocks);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOpenTabsPanelCollapsed, setIsOpenTabsPanelCollapsed] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [collapsedOpenBlockIds, setCollapsedOpenBlockIds] = useState<ReadonlySet<number>>(() => new Set());
  const [isDeduplicating, setIsDeduplicating] = useState(false);
  const [dedupeStatus, setDedupeStatus] = useState("");
  const [dataStatus, setDataStatus] = useState("");
  const [backupStatus, setBackupStatus] = useState<BackupDirectoryStatus>("not-configured");
  const [loaded, setLoaded] = useState(false);
  const [tabSelectionStackId, setTabSelectionStackId] = useState<string>();
  const [selectedSavedTabIds, setSelectedSavedTabIds] = useState<ReadonlySet<string>>(() => new Set());
  const [editingSavedTabId, setEditingSavedTabId] = useState<string>();
  const didHandleInitialUrlRef = useRef(false);
  const latestLocalStateRef = useRef<TabDockLocalStateV1 | undefined>(undefined);
  const skipNextLocalStateSaveRef = useRef(false);
  const forceNextLocalStateSaveRef = useRef(false);
  const scrollbarRevealTimersRef = useRef(new Map<HTMLElement, number>());
  const importInputRef = useRef<HTMLInputElement>(null);

  const activeSpace = getActiveSpace(workspace);
  const activeStacks = activeSpace?.stackIds.map((id) => workspace.stacks[id]).filter(Boolean) ?? [];
  const activeSavedTabCount = activeStacks.reduce((total, stack) => total + stack.tabIds.length, 0);
  const orderedSpaces = getOrderedSpaces(workspace);
  const openTabCount = openBlocks.reduce((total, block) => total + block.tabs.length, 0);
  const savedOpenTabs = useMemo(
    () => getOpenTabsAlreadySavedInWorkspace(workspace, openBlocks),
    [openBlocks, workspace]
  );
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const searchShortcutLabel = formatShortcutForPlatform(globalSearchShortcut, isMac);
  const searchGroups = useMemo(
    () => buildSearchGroups(query, workspace, openBlocks, historyEntries, now()),
    [historyEntries, openBlocks, query, workspace]
  );
  const localSearchResults = flattenSearchGroups(searchGroups);
  const flatResults = getSearchResultsWithGoogleFallback(query, localSearchResults);

  const revealTransientScrollbar = useCallback((event: React.UIEvent<HTMLElement>) => {
    const scrollContainer = event.currentTarget;
    scrollContainer.classList.add("is-scrolling");

    const timers = scrollbarRevealTimersRef.current;
    const existingTimer = timers.get(scrollContainer);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    const nextTimer = window.setTimeout(() => {
      scrollContainer.classList.remove("is-scrolling");
      timers.delete(scrollContainer);
    }, 760);
    timers.set(scrollContainer, nextTimer);
  }, []);

  const refreshGlobalSearchShortcut = useCallback(async () => {
    const shortcut = await getGlobalSearchShortcut(chromeApi)
      .catch(() => DEFAULT_GLOBAL_SEARCH_SHORTCUT);
    setGlobalSearchShortcut(shortcut);
  }, [chromeApi]);

  const refreshOpenTabs = useCallback(async () => {
    if (!chromeApi) {
      return;
    }
    const blocks = await groupOpenTabs(chromeApi);
    setOpenBlocks(blocks);
  }, [chromeApi]);

  useEffect(() => {
    const load = async () => {
      const [savedState, savedGlobalShortcut, savedBackupStatus] = await Promise.all([
        loadLocalState(chromeApi),
        getGlobalSearchShortcut(chromeApi)
          .catch(() => DEFAULT_GLOBAL_SEARCH_SHORTCUT),
        getBackupDirectoryStatus()
      ]);
      latestLocalStateRef.current = savedState;
      setWorkspace(savedState.workspace);
      setSettings(savedState.settings);
      setGlobalSearchShortcut(savedGlobalShortcut);
      setBackupStatus(savedBackupStatus);
      setLoaded(true);
    };
    void load();
  }, [chromeApi]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    return subscribeToLocalStateChanges(chromeApi, (state) => {
      const currentState = latestLocalStateRef.current;
      if (
        currentState &&
        isEqual(state.workspace, currentState.workspace) &&
        isEqual(state.settings, currentState.settings)
      ) {
        latestLocalStateRef.current = state;
        return;
      }

      latestLocalStateRef.current = state;
      skipNextLocalStateSaveRef.current = true;
      setWorkspace(state.workspace);
      setSettings(state.settings);
    });
  }, [chromeApi, loaded]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshGlobalSearchShortcut();
      }
    };
    const refresh = () => void refreshGlobalSearchShortcut();

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loaded, refreshGlobalSearchShortcut]);

  useEffect(() => {
    if (!loaded || !isSettingsOpen) {
      return;
    }
    void refreshGlobalSearchShortcut();
  }, [isSettingsOpen, loaded, refreshGlobalSearchShortcut]);

  useEffect(() => {
    void refreshOpenTabs();
  }, [refreshOpenTabs]);

  useEffect(() => {
    if (!chromeApi) {
      return;
    }

    return subscribeToOpenTabsChanges(chromeApi, () => {
      void refreshOpenTabs();
    });
  }, [chromeApi, refreshOpenTabs]);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    if (skipNextLocalStateSaveRef.current) {
      skipNextLocalStateSaveRef.current = false;
      return;
    }

    const latestState = latestLocalStateRef.current;
    if (
      latestState &&
      isEqual(workspace, latestState.workspace) &&
      isEqual(settings, latestState.settings)
    ) {
      return;
    }

    const mergeBase = forceNextLocalStateSaveRef.current ? undefined : latestState;
    forceNextLocalStateSaveRef.current = false;

    void saveLocalState(chromeApi, workspace, settings, mergeBase).then((savedState) => {
      latestLocalStateRef.current = savedState;
      if (!isEqual(savedState.workspace, workspace)) {
        skipNextLocalStateSaveRef.current = true;
        setWorkspace(savedState.workspace);
      }
      if (!isEqual(savedState.settings, settings)) {
        skipNextLocalStateSaveRef.current = true;
        setSettings(savedState.settings);
      }
    });
  }, [chromeApi, loaded, settings, workspace]);

  useEffect(() => {
    if (!loaded || backupStatus !== "authorized") {
      return;
    }

    const timer = window.setTimeout(async () => {
      const state = createLocalState(workspace, settings, now);
      const status = await writeLatestBackup(serializeLocalState(state));
      setBackupStatus(status);
      if (status === "authorized") {
        setDataStatus("已自动备份到本地目录。");
      } else if (status === "permission-needed") {
        setDataStatus("备份目录需要重新授权。");
      } else if (status === "failed") {
        setDataStatus("自动备份失败。");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [backupStatus, loaded, settings, workspace]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shortcutMatchesEvent(globalSearchShortcut, event)) {
        event.preventDefault();
        setIsSearchOpen(true);
      }
      if (event.key === "Escape") {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [globalSearchShortcut]);

  useEffect(() => {
    if (!chromeApi?.runtime?.onMessage?.addListener) {
      return;
    }

    const onMessage = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
      if (
        !message ||
        typeof message !== "object" ||
        (message as { type?: unknown }).type !== "tab-manager:open-search-modal" ||
        document.visibilityState !== "visible"
      ) {
        return false;
      }

      window.focus();
      setIsSearchOpen(true);
      sendResponse({ ok: true });
      return false;
    };

    chromeApi.runtime.onMessage.addListener(onMessage);
    return () => chromeApi.runtime?.onMessage?.removeListener?.(onMessage);
  }, [chromeApi]);

  useEffect(() => {
    if (!loaded || didHandleInitialUrlRef.current) {
      return;
    }
    didHandleInitialUrlRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const spaceId = params.get("space");
    const stackId = params.get("stack");
    if (spaceId && workspace.spaces[spaceId]) {
      setWorkspace((state) => ({ ...state, activeSpaceId: spaceId }));
    }
    if (params.get("search") === "1") {
      setIsSearchOpen(true);
    }
    if (stackId) {
      scrollStackIntoView(stackId);
    }
  }, [loaded, workspace.spaces]);

  useEffect(() => {
    if (!chromeApi || !query.trim()) {
      setHistoryEntries([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setHistoryEntries(await searchRecentHistory(chromeApi, query, now()));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [chromeApi, query]);

  useEffect(() => {
    if (!tabSelectionStackId) {
      return;
    }
    const selectedStack = workspace.stacks[tabSelectionStackId];
    if (!selectedStack || !activeSpace || selectedStack.spaceId !== activeSpace.id) {
      setTabSelectionStackId(undefined);
      setSelectedSavedTabIds(new Set());
      setEditingSavedTabId(undefined);
      return;
    }
    setSelectedSavedTabIds((currentIds) => {
      const nextIds = new Set([...currentIds].filter((tabId) => selectedStack.tabIds.includes(tabId)));
      return nextIds.size === currentIds.size ? currentIds : nextIds;
    });
  }, [activeSpace, tabSelectionStackId, workspace.stacks]);

  useEffect(() => {
    const scrollbarRevealTimers = scrollbarRevealTimersRef.current;
    return () => {
      for (const timer of scrollbarRevealTimers.values()) {
        window.clearTimeout(timer);
      }
      scrollbarRevealTimers.clear();
    };
  }, []);

  const createNewSpace = () => {
    const name = prompt("Space 名称", "新 Space");
    if (!name) {
      return;
    }
    setWorkspace((state) => createSpace(state, name, now, idGeneratorRef.current));
  };

  const createNewStack = () => {
    if (!activeSpace) {
      return;
    }
    const name = prompt("Stack 名称", "新 Stack");
    if (!name) {
      return;
    }
    setWorkspace((state) => createStack(state, activeSpace.id, name, now, idGeneratorRef.current));
  };

  const clearSavedTabSelection = () => {
    setTabSelectionStackId(undefined);
    setSelectedSavedTabIds(new Set());
    setEditingSavedTabId(undefined);
  };

  const setActiveSpace = (spaceId: string) => {
    clearSavedTabSelection();
    setWorkspace((state) => ({ ...state, activeSpaceId: spaceId }));
  };

  const startSavedTabSelection = (stackId: string) => {
    setTabSelectionStackId(stackId);
    setSelectedSavedTabIds(new Set());
    setEditingSavedTabId(undefined);
  };

  const toggleSavedTabSelection = (stackId: string, tabId: string) => {
    if (tabSelectionStackId !== stackId) {
      return;
    }
    setSelectedSavedTabIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(tabId)) {
        nextIds.delete(tabId);
      } else {
        nextIds.add(tabId);
      }
      return nextIds;
    });
  };

  const removeSelectedSavedTabs = (stackId: string) => {
    if (!activeSpace || tabSelectionStackId !== stackId || selectedSavedTabIds.size === 0) {
      return;
    }
    const tabIds = [...selectedSavedTabIds];
    setWorkspace((state) => deleteSavedTabs(state, activeSpace.id, stackId, tabIds, now));
    clearSavedTabSelection();
  };

  const startEditingSavedTab = (stackId: string, tabId: string) => {
    if (tabSelectionStackId !== stackId) {
      return;
    }
    setEditingSavedTabId(tabId);
  };

  const saveEditedSavedTab = (tabId: string, title: string, url: string): string | undefined => {
    if (!activeSpace) {
      return "当前没有可编辑的 Space。";
    }
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return "URL 不能为空。";
    }
    const normalizedUrl = normalizeUrl(trimmedUrl);
    const hasDuplicateUrl = Object.values(workspace.tabs).some(
      (tab) => tab.id !== tabId && tab.spaceId === activeSpace.id && normalizeUrl(tab.url) === normalizedUrl
    );
    if (hasDuplicateUrl) {
      return "当前 Space 已有相同 URL。";
    }

    setWorkspace((state) => updateSavedTab(state, activeSpace.id, tabId, { title, url: trimmedUrl }, now));
    setEditingSavedTabId(undefined);
    return undefined;
  };

  const handleResult = async (result: SearchResult) => {
    if (result.kind === "space" && result.spaceId) {
      setActiveSpace(result.spaceId);
    }
    if (result.kind === "stack" && result.spaceId && result.stackId) {
      setActiveSpace(result.spaceId);
      scrollStackIntoView(result.stackId);
    }
    if (
      (result.kind === "saved-tab" ||
        result.kind === "open-tab" ||
        result.kind === "history" ||
        result.kind === "google-search") &&
      result.url
    ) {
      await openUrl(result.url);
    }
    setIsSearchOpen(false);
  };

  const openUrl = async (url: string) => {
    if (chromeApi) {
      await focusOrCreateTab(chromeApi, url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const applyImportedState = (state: TabDockLocalStateV1) => {
    clearSavedTabSelection();
    forceNextLocalStateSaveRef.current = true;
    setWorkspace(state.workspace);
    setSettings(state.settings);
    setDataStatus("已导入数据。");
  };

  const handleExportData = () => {
    const state = createLocalState(workspace, settings, now);
    const blob = new Blob([serializeLocalState(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tabdock-backup.json";
    link.click();
    URL.revokeObjectURL(url);
    setDataStatus("已导出数据。");
  };

  const handleImportButtonClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    if (file.size > maxImportFileSizeBytes) {
      setDataStatus("导入失败：文件过大。");
      return;
    }

    const parsed = parseImportedLocalState(await file.text());
    if (!parsed.ok) {
      setDataStatus(`导入失败：${parsed.error}`);
      return;
    }

    if (!window.confirm("导入会替换当前所有 TabDock 数据，是否继续？")) {
      setDataStatus("已取消导入。");
      return;
    }

    applyImportedState(parsed.state);
  };

  const handleAuthorizeBackupDirectory = async () => {
    setDataStatus("正在请求备份目录授权...");
    const status = await authorizeBackupDirectory();
    setBackupStatus(status);
    if (status !== "authorized") {
      setDataStatus(formatBackupStatus(status));
      return;
    }

    const state = createLocalState(workspace, settings, now);
    const backupWriteStatus = await writeLatestBackup(serializeLocalState(state));
    setBackupStatus(backupWriteStatus);
    setDataStatus(backupWriteStatus === "authorized" ? "已授权并完成本地备份。" : formatBackupStatus(backupWriteStatus));
  };

  const handleRestoreLatestBackup = async () => {
    const result = await readLatestBackup();
    if (!result.ok) {
      setBackupStatus(result.status);
      setDataStatus(result.error ?? formatBackupStatus(result.status));
      return;
    }

    const parsed = parseImportedLocalState(result.content);
    if (!parsed.ok) {
      setDataStatus(`恢复失败：${parsed.error}`);
      return;
    }

    if (!window.confirm("从本地备份恢复会替换当前所有 TabDock 数据，是否继续？")) {
      setDataStatus("已取消恢复。");
      return;
    }

    applyImportedState(parsed.state);
    setDataStatus("已从本地备份恢复。");
  };

  const handleDropOnStack = (stackId: string, event: React.DragEvent) => {
    event.preventDefault();
    if (!activeSpace) {
      return;
    }
    const payload = readDragPayload(event);
    if (!payload) {
      return;
    }
    if (payload.type === "open-tab") {
      setWorkspace((state) =>
        saveOpenTabToStack(
          state,
          activeSpace.id,
          stackId,
          payload.tab,
          state.stacks[stackId]?.tabIds.length ?? 0,
          now,
          idGeneratorRef.current
        )
      );
    }
    if (payload.type === "saved-tab") {
      setWorkspace((state) =>
        moveSavedTab(state, activeSpace.id, payload.tabId, stackId, state.stacks[stackId]?.tabIds.length ?? 0, now)
      );
    }
    if (payload.type === "stack") {
      const targetIndex = activeSpace.stackIds.indexOf(stackId);
      setWorkspace((state) => moveStack(state, activeSpace.id, payload.stackId, targetIndex, now));
    }
  };

  const handleDropOnSpace = (targetSpaceId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = readDragPayload(event);
    if (payload?.type !== "space" || payload.spaceId === targetSpaceId) {
      return;
    }
    const targetIndex = orderedSpaces.findIndex((space) => space.id === targetSpaceId);
    setWorkspace((state) => moveSpace(state, payload.spaceId, targetIndex, now));
  };

  const handleDropOnWorkspace = (event: React.DragEvent) => {
    event.preventDefault();
    if (!activeSpace) {
      return;
    }
    const payload = readDragPayload(event);
    if (payload?.type !== "open-block") {
      return;
    }
    const block = openBlocks.find((item) => item.windowId === payload.windowId);
    if (!block) {
      return;
    }
    const name = prompt("新 Stack 名称", formatStackName(now()));
    if (!name) {
      return;
    }
    setWorkspace((state) =>
      saveOpenWindowAsStack(state, activeSpace.id, name, block.tabs, now, idGeneratorRef.current)
    );
  };

  const handleDropOnOpenBlock = async (targetWindowId: number, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const payload = readDragPayload(event);
    if (payload?.type !== "open-tab" || payload.tab.windowId === targetWindowId) {
      return;
    }

    if (chromeApi) {
      await moveOpenTabToWindow(chromeApi, payload.tab.id, targetWindowId);
      setOpenBlocks(await groupOpenTabs(chromeApi));
      return;
    }

    setOpenBlocks((blocks) => moveOpenTabBetweenBlocks(blocks, payload.tab, targetWindowId));
  };

  const dedupeOpenTabs = async () => {
    if (!chromeApi || isDeduplicating) {
      return;
    }

    setIsDeduplicating(true);
    setDedupeStatus("");
    try {
      const closedCount = await closeDuplicateOpenTabs(chromeApi);
      await refreshOpenTabs();
      setDedupeStatus(closedCount > 0 ? `已关闭 ${closedCount} 个重复 Tab` : "没有重复 Tab");
    } finally {
      setIsDeduplicating(false);
    }
  };

  const clearSavedOpenTabs = async () => {
    if (savedOpenTabs.length === 0) {
      setDedupeStatus("没有已保存的 Open Tab");
      return;
    }

    const savedOpenTabIds = savedOpenTabs.map((tab) => tab.id);
    if (chromeApi) {
      await Promise.all(savedOpenTabIds.map((tabId) => closeOpenTab(chromeApi, tabId)));
      await refreshOpenTabs();
    } else {
      const savedOpenTabIdSet = new Set(savedOpenTabIds);
      setOpenBlocks((blocks) =>
        relabelOpenBlocks(
          blocks
            .map((block) => ({
              ...block,
              tabs: block.tabs.filter((tab) => !savedOpenTabIdSet.has(tab.id))
            }))
            .filter((block) => block.tabs.length > 0)
        )
      );
    }

    setDedupeStatus(`已清除 ${savedOpenTabs.length} 个已保存 Tab`);
  };

  const handleCloseOpenTab = async (tab: OpenTab, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (chromeApi) {
      await closeOpenTab(chromeApi, tab.id);
      await refreshOpenTabs();
      return;
    }

    setOpenBlocks((blocks) => removeOpenTabFromBlocks(blocks, tab.id));
  };

  const handleCloseOpenWindow = async (windowId: number, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (chromeApi) {
      await closeOpenWindow(chromeApi, windowId);
      await refreshOpenTabs();
      return;
    }

    setOpenBlocks((blocks) => relabelOpenBlocks(blocks.filter((block) => block.windowId !== windowId)));
  };

  const renameCurrentSpace = (spaceId: string, currentName: string) => {
    const name = prompt("Space 名称", currentName);
    if (name) {
      setWorkspace((state) => renameSpace(state, spaceId, name, now));
    }
  };

  const removeCurrentSpace = (spaceId: string, name: string) => {
    if (confirm(`删除 Space「${name}」？`)) {
      setWorkspace((state) => deleteSpace(state, spaceId));
    }
  };

  const renameCurrentStack = (stackId: string, currentName: string) => {
    const name = prompt("Stack 名称", currentName);
    if (name) {
      setWorkspace((state) => renameStack(state, stackId, name, now));
    }
  };

  const removeCurrentStack = (stackId: string, name: string) => {
    if (!activeSpace) {
      return;
    }
    if (confirm(`删除 Stack「${name}」？`)) {
      setWorkspace((state) => deleteStack(state, activeSpace.id, stackId, now));
      if (tabSelectionStackId === stackId) {
        clearSavedTabSelection();
      }
    }
  };

  const toggleOpenBlock = (windowId: number) => {
    setCollapsedOpenBlockIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(windowId)) {
        nextIds.delete(windowId);
        return nextIds;
      }
      nextIds.add(windowId);
      return nextIds;
    });
  };

  return (
    <main className="app-shell" data-testid="tab-manager-shell">
      <aside className="sidebar" data-testid="sidebar">
        <div className="brand-row">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <img src="/favicon.png" alt="" />
            </span>
            <h1>TabDock</h1>
          </div>
          <button className="icon-button" data-testid="add-space" type="button" title="新增 Space" onClick={createNewSpace}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="sidebar-controls">
          <button className="search-entry" data-testid="search-entry" type="button" onClick={() => setIsSearchOpen(true)}>
            <Icon name="search" />
            <span>搜索</span>
            <kbd>{searchShortcutLabel}</kbd>
          </button>
          <button className="settings-entry" data-testid="settings-entry" type="button" onClick={() => setIsSettingsOpen(true)}>
            <Icon name="settings" />
            <span>设置</span>
          </button>
        </div>
        <div className="space-section-label" data-testid="space-section-label">
          Spaces
        </div>
        <nav className="space-list" aria-label="Spaces">
          {orderedSpaces.map((space) => (
            <section
              className={`space-group ${space.id === activeSpace?.id ? "is-active" : ""}`}
              data-testid="space-group"
              key={space.id}
            >
              <div
                className={`space-row ${space.id === activeSpace?.id ? "is-active" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDropOnSpace(space.id, event)}
              >
                <button
                  data-testid="space-title"
                  draggable
                  type="button"
                  onClick={() => setActiveSpace(space.id)}
                  onDragStart={(event) => writeDragPayload(event, { type: "space", spaceId: space.id })}
                >
                  {space.name}
                </button>
                <button
                  className="tiny-button"
                  data-testid="rename-space"
                  type="button"
                  title="重命名 Space"
                  onClick={() => renameCurrentSpace(space.id, space.name)}
                >
                  <Icon name="edit" />
                </button>
                <button
                  className="tiny-button danger"
                  data-testid="delete-space"
                  type="button"
                  title="删除 Space"
                  onClick={() => removeCurrentSpace(space.id, space.name)}
                >
                  <Icon name="trash" />
                </button>
              </div>
              {space.id === activeSpace?.id && (
                <div className="stack-tree">
                  {space.stackIds.map((stackId) => (
                    <button key={stackId} type="button" onClick={() => scrollStackIntoView(stackId)}>
                      {workspace.stacks[stackId]?.name}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </nav>
      </aside>

      <section
        className={`workspace ${activeStacks.length > 0 ? "has-stacks" : ""} ${
          isOpenTabsPanelCollapsed ? "is-open-tabs-collapsed" : ""
        }`}
        data-testid="workspace"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropOnWorkspace}
      >
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>{activeSpace?.name ?? "未选择 Space"}</h2>
          </div>
          <div className="workspace-summary" aria-label="Workspace summary">
            <span>{activeStacks.length} Stacks</span>
            <span>{activeSavedTabCount} Saved</span>
          </div>
          <button
            className="icon-button primary"
            data-testid="add-stack"
            type="button"
            title="新增 Stack"
            onClick={createNewStack}
          >
            <Icon name="plus" />
          </button>
        </header>

        {!activeSpace && (
          <div className="empty-state">
            <strong>创建第一个 Space</strong>
            <button type="button" onClick={createNewSpace}>
              新增
            </button>
          </div>
        )}

        {activeSpace && activeStacks.length === 0 && (
          <div className="empty-state">
            <strong>当前 Space 还没有 Stack</strong>
            <button type="button" onClick={createNewStack}>
              新增
            </button>
          </div>
        )}

        <div className="stack-board" onScroll={revealTransientScrollbar}>
          {activeStacks.map((stack) => {
            const isSelectingThisStack = tabSelectionStackId === stack.id;
            return (
            <article
              className={`stack-column ${isSelectingThisStack ? "is-selecting-tabs" : ""}`}
              data-testid="stack-column"
              id={`stack-${stack.id}`}
              key={stack.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDropOnStack(stack.id, event)}
            >
              <header
                className="stack-header"
                data-testid="stack-header"
                draggable
                onDragStart={(event) => writeDragPayload(event, { type: "stack", stackId: stack.id })}
              >
                <div className="stack-title">
                  <h3>{stack.name}</h3>
                  {isSelectingThisStack && (
                    <p className="stack-selection-count">{selectedSavedTabIds.size} selected</p>
                  )}
                </div>
                <div className={`stack-actions ${isSelectingThisStack ? "is-active" : ""}`}>
                  {isSelectingThisStack ? (
                    <>
                      <button
                        data-testid="delete-selected-tabs"
                        disabled={selectedSavedTabIds.size === 0}
                        type="button"
                        title="删除选中的 Tabs"
                        onClick={() => removeSelectedSavedTabs(stack.id)}
                      >
                        <Icon name="trash" />
                      </button>
                      <button
                        data-testid="cancel-tab-selection"
                        type="button"
                        title="取消选择"
                        onClick={clearSavedTabSelection}
                      >
                        <Icon name="x" />
                      </button>
                    </>
                  ) : (
                    <button
                      data-testid="select-stack-tabs"
                      type="button"
                      title="选择要删除的 Tabs"
                      onClick={() => startSavedTabSelection(stack.id)}
                    >
                      <Icon name="check-square" />
                    </button>
                  )}
                  <button
                    data-testid="rename-stack"
                    type="button"
                    title="重命名 Stack"
                    onClick={() => renameCurrentStack(stack.id, stack.name)}
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    data-testid="delete-stack"
                    type="button"
                    title="删除 Stack"
                    onClick={() => removeCurrentStack(stack.id, stack.name)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </header>
              <div className="tab-list" onScroll={revealTransientScrollbar}>
                {stack.tabIds.map((tabId) => {
                  const tab = workspace.tabs[tabId];
                  if (!tab) {
                    return null;
                  }
                  const isSelectedSavedTab = isSelectingThisStack && selectedSavedTabIds.has(tab.id);
                  return (
                    <div
                      aria-pressed={isSelectingThisStack ? isSelectedSavedTab : undefined}
                      className={`saved-tab ${isSelectingThisStack ? "is-select-mode" : ""} ${
                        isSelectedSavedTab ? "is-selected" : ""
                      }`}
                      data-testid="saved-tab"
                      draggable={!isSelectingThisStack}
                      key={tab.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (isSelectingThisStack) {
                          toggleSavedTabSelection(stack.id, tab.id);
                          return;
                        }
                        void openUrl(tab.url);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") {
                          return;
                        }
                        event.preventDefault();
                        if (isSelectingThisStack) {
                          toggleSavedTabSelection(stack.id, tab.id);
                          return;
                        }
                        void openUrl(tab.url);
                      }}
                      onDragStart={(event) => {
                        if (isSelectingThisStack) {
                          event.preventDefault();
                          return;
                        }
                        event.stopPropagation();
                        writeDragPayload(event, { type: "saved-tab", tabId: tab.id });
                      }}
                    >
                      <span className="saved-tab-leading">
                        {isSelectingThisStack ? (
                          <span className={`saved-tab-checkbox ${isSelectedSavedTab ? "is-checked" : ""}`} aria-hidden="true">
                            {isSelectedSavedTab && <Icon name="check" />}
                          </span>
                        ) : (
                          <span className="favicon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : <Icon name="link" />}</span>
                        )}
                      </span>
                      <span>
                        <strong>{tab.title}</strong>
                        <small>{tab.description || tab.url}</small>
                      </span>
                      {isSelectingThisStack && (
                        <button
                          className="saved-tab-edit"
                          data-testid="edit-saved-tab"
                          type="button"
                          title="编辑 URL"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            startEditingSavedTab(stack.id, tab.id);
                          }}
                        >
                          <Icon name="edit" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {stack.tabIds.length === 0 && <p className="drop-hint">从右侧拖入 Tab</p>}
              </div>
            </article>
          )})}
        </div>
      </section>

      <aside
        className={`open-tabs-panel ${isOpenTabsPanelCollapsed ? "is-collapsed" : ""}`}
        data-testid="open-tabs-panel"
      >
        {isOpenTabsPanelCollapsed ? (
          <button
            className="open-tabs-rail"
            data-testid="expand-open-tabs"
            type="button"
            title="展开 Open Tabs"
            onClick={() => setIsOpenTabsPanelCollapsed(false)}
          >
            <Icon name="panel-right" />
            <span>Open Tabs</span>
            <strong>{openTabCount}</strong>
          </button>
        ) : (
          <>
        <header>
          <p className="eyebrow" data-testid="open-tabs-heading">Open {openTabCount} tabs</p>
          <div className="open-tabs-actions">
            <button
              className="tiny-button"
              data-testid="collapse-open-tabs"
              type="button"
              title="收回 Open Tabs"
              onClick={() => setIsOpenTabsPanelCollapsed(true)}
            >
              <Icon name="panel-right" />
            </button>
            <button
              className="tiny-button"
              data-testid="dedupe-open-tabs"
              disabled={!chromeApi || isDeduplicating}
              type="button"
              title="去除重复 Tab"
              onClick={() => void dedupeOpenTabs()}
            >
              <Icon name="copy" />
            </button>
            <button
              className="tiny-button"
              data-testid="clear-saved-open-tabs"
              disabled={savedOpenTabs.length === 0}
              type="button"
              title="清除已保存在 Workspace 的 Tab"
              onClick={() => void clearSavedOpenTabs()}
            >
              <Icon name="check-square" />
            </button>
            <button
              className="tiny-button"
              type="button"
              title="刷新"
              onClick={() => void refreshOpenTabs()}
            >
              <Icon name="refresh" />
            </button>
          </div>
        </header>
        {dedupeStatus && (
          <p className="open-tabs-status" data-testid="dedupe-open-tabs-status" role="status">
            {dedupeStatus}
          </p>
        )}
        <div className="open-blocks">
          {openBlocks.map((block) => (
            <section
              className={`open-block ${collapsedOpenBlockIds.has(block.windowId) ? "is-collapsed" : ""}`}
              data-testid="open-block"
              key={block.windowId}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => void handleDropOnOpenBlock(block.windowId, event)}
            >
              <div
                aria-expanded={!collapsedOpenBlockIds.has(block.windowId)}
                className="open-block-title"
                data-testid="open-block-title"
                draggable
                role="button"
                tabIndex={0}
                onClick={() => toggleOpenBlock(block.windowId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleOpenBlock(block.windowId);
                  }
                }}
                onDragStart={(event) => writeDragPayload(event, { type: "open-block", windowId: block.windowId })}
              >
                <span className="open-block-title-content">
                  <Icon name={collapsedOpenBlockIds.has(block.windowId) ? "chevron-right" : "chevron-down"} />
                  <span>{block.label}</span>
                </span>
                <button
                  className="open-row-close"
                  data-testid="close-open-window"
                  type="button"
                  title="关闭 Window"
                  onClick={(event) => void handleCloseOpenWindow(block.windowId, event)}
                >
                  <Icon name="trash" />
                </button>
              </div>
              {!collapsedOpenBlockIds.has(block.windowId) &&
                block.tabs.map((tab) => (
                  <div
                    className="open-tab"
                    data-testid="open-tab"
                    draggable
                    key={`${tab.windowId}:${tab.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => void openUrl(tab.url)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openUrl(tab.url);
                      }
                    }}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      writeDragPayload(event, { type: "open-tab", tab });
                    }}
                  >
                    <span className="favicon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : <Icon name="link" />}</span>
                    <span>
                      <strong>{tab.title}</strong>
                      <small>{tab.url}</small>
                    </span>
                    <button
                      className="open-row-close"
                      data-testid="close-open-tab"
                      type="button"
                      title="关闭 Tab"
                      onClick={(event) => void handleCloseOpenTab(tab, event)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
            </section>
          ))}
        </div>
          </>
        )}
      </aside>

      {isSearchOpen && (
        <SearchModal
          flatResults={flatResults}
          groups={searchGroups}
          hasLocalResults={localSearchResults.length > 0}
          onClose={() => setIsSearchOpen(false)}
          onPick={(result) => void handleResult(result)}
          query={query}
          selectedIndex={selectedResultIndex}
          setQuery={(value) => {
            setQuery(value);
            setSelectedResultIndex(0);
          }}
          setSelectedIndex={setSelectedResultIndex}
        />
      )}
      {isSettingsOpen && (
        <SettingsModal
          backupStatus={backupStatus}
          dataStatus={dataStatus}
          searchShortcutLabel={searchShortcutLabel}
          importInputRef={importInputRef}
          onAuthorizeBackupDirectory={() => void handleAuthorizeBackupDirectory()}
          onClose={() => setIsSettingsOpen(false)}
          onExportData={handleExportData}
          onImportButtonClick={handleImportButtonClick}
          onImportFile={(file) => void handleImportFile(file)}
          onOpenChromeShortcuts={() => void openUrl("chrome://extensions/shortcuts")}
          onRestoreLatestBackup={() => void handleRestoreLatestBackup()}
        />
      )}
      {editingSavedTabId && workspace.tabs[editingSavedTabId] && (
        <EditSavedTabModal
          tab={workspace.tabs[editingSavedTabId]}
          onClose={() => setEditingSavedTabId(undefined)}
          onSave={(title, url) => saveEditedSavedTab(editingSavedTabId, title, url)}
        />
      )}
    </main>
  );
};

const EditSavedTabModal = ({
  tab,
  onClose,
  onSave
}: {
  tab: { title: string; url: string };
  onClose: () => void;
  onSave: (title: string, url: string) => string | undefined;
}) => {
  const [title, setTitle] = useState(tab.title);
  const [url, setUrl] = useState(tab.url);
  const [error, setError] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const message = onSave(title, url);
    setError(message ?? "");
  };

  return (
    <div className="search-backdrop" onMouseDown={onClose}>
      <form
        className="settings-modal edit-saved-tab-modal"
        data-testid="edit-saved-tab-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header>
          <div>
            <p className="eyebrow">Saved Tab</p>
            <h2>编辑 URL</h2>
          </div>
          <button className="tiny-button" type="button" title="关闭" onClick={onClose}>
            <Icon name="chevron-down" />
          </button>
        </header>
        <label className="shortcut-field">
          <span>标题</span>
          <input
            ref={titleInputRef}
            aria-label="标题"
            data-testid="edit-saved-tab-title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label className="shortcut-field">
          <span>URL</span>
          <input
            aria-label="URL"
            data-testid="edit-saved-tab-url"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
        </label>
        {error && (
          <p className="settings-note" data-testid="edit-saved-tab-error" role="alert">
            {error}
          </p>
        )}
        <div className="settings-actions edit-saved-tab-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button data-testid="save-saved-tab-edit" type="submit">
            保存
          </button>
        </div>
      </form>
    </div>
  );
};

const SettingsModal = ({
  backupStatus,
  dataStatus,
  searchShortcutLabel,
  importInputRef,
  onAuthorizeBackupDirectory,
  onClose,
  onExportData,
  onImportButtonClick,
  onImportFile,
  onOpenChromeShortcuts,
  onRestoreLatestBackup
}: {
  backupStatus: BackupDirectoryStatus;
  dataStatus: string;
  searchShortcutLabel: string;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onAuthorizeBackupDirectory: () => void;
  onClose: () => void;
  onExportData: () => void;
  onImportButtonClick: () => void;
  onImportFile: (file: File | undefined) => void;
  onOpenChromeShortcuts: () => void;
  onRestoreLatestBackup: () => void;
}) => (
  <div className="search-backdrop" onMouseDown={onClose}>
    <section className="settings-modal" data-testid="settings-modal" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div>
          <p className="eyebrow">Settings</p>
          <h2>快捷键</h2>
        </div>
        <button className="tiny-button" type="button" title="关闭" onClick={onClose}>
          <Icon name="chevron-down" />
        </button>
      </header>
      <label className="shortcut-field">
        <span>搜索快捷键</span>
        <input
          aria-label="搜索快捷键"
          data-testid="search-shortcut"
          readOnly
          value={searchShortcutLabel}
        />
      </label>
      <button className="settings-link-button" type="button" onClick={onOpenChromeShortcuts}>
        在 Chrome 中修改快捷键
      </button>
      <p className="settings-note">此快捷键同时用于应用内搜索和全局搜索。</p>
      <div className="settings-section">
        <h3>数据</h3>
        <div className="settings-actions">
          <button data-testid="export-data" type="button" onClick={onExportData}>
            导出数据
          </button>
          <button data-testid="import-data" type="button" onClick={onImportButtonClick}>
            导入数据
          </button>
          <button data-testid="authorize-backup-directory" type="button" onClick={onAuthorizeBackupDirectory}>
            授权备份目录
          </button>
          <button
            data-testid="restore-latest-backup"
            type="button"
            disabled={backupStatus !== "authorized"}
            onClick={onRestoreLatestBackup}
          >
            从备份恢复
          </button>
        </div>
        <input
          ref={importInputRef}
          data-testid="import-data-input"
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            onImportFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <p className="settings-note">本地备份：{formatBackupStatus(backupStatus)}</p>
        {dataStatus && <p className="settings-note" data-testid="data-status">{dataStatus}</p>}
      </div>
    </section>
  </div>
);

const formatBackupStatus = (status: BackupDirectoryStatus): string => {
  if (status === "authorized") {
    return "已授权";
  }
  if (status === "permission-needed") {
    return "需要重新授权";
  }
  if (status === "unsupported") {
    return "当前浏览器不支持目录备份";
  }
  if (status === "failed") {
    return "备份失败";
  }
  return "未授权";
};

const isEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const SearchModal = ({
  flatResults,
  groups,
  hasLocalResults,
  onClose,
  onPick,
  query,
  selectedIndex,
  setQuery,
  setSelectedIndex
}: {
  flatResults: SearchResult[];
  groups: SearchGroups;
  hasLocalResults: boolean;
  onClose: () => void;
  onPick: (result: SearchResult) => void;
  query: string;
  selectedIndex: number;
  setQuery: (value: string) => void;
  setSelectedIndex: (value: number) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusInput = () => inputRef.current?.focus({ preventScroll: true });
    focusInput();

    const focusTimers = [50, 150, 300, 600].map((delay) => window.setTimeout(focusInput, delay));
    window.addEventListener("focus", focusInput);
    document.addEventListener("visibilitychange", focusInput);

    return () => {
      for (const timer of focusTimers) {
        window.clearTimeout(timer);
      }
      window.removeEventListener("focus", focusInput);
      document.removeEventListener("visibilitychange", focusInput);
    };
  }, []);

  useEffect(() => {
    if (selectedIndex > Math.max(flatResults.length - 1, 0)) {
      setSelectedIndex(Math.max(flatResults.length - 1, 0));
    }
  }, [flatResults.length, selectedIndex, setSelectedIndex]);

  useEffect(() => {
    inputRef.current
      ?.closest(".search-modal")
      ?.querySelector(".is-selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="search-backdrop" onMouseDown={onClose}>
      <section className="search-modal" data-testid="search-modal" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          autoFocus
          placeholder="搜索 spaces、stacks、tabs、history"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex(Math.min(selectedIndex + 1, Math.max(flatResults.length - 1, 0)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex(Math.max(selectedIndex - 1, 0));
            }
            if (event.key === "Enter" && flatResults[selectedIndex]) {
              event.preventDefault();
              onPick(flatResults[selectedIndex]);
            }
            if (event.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="result-groups">
          {renderGroup("Spaces", groups.spaces, flatResults, selectedIndex, onPick)}
          {renderGroup("Stacks", groups.stacks, flatResults, selectedIndex, onPick)}
          {renderGroup("Open Tabs", groups.openTabs, flatResults, selectedIndex, onPick)}
          {renderGroup("Saved Tabs", groups.savedTabs, flatResults, selectedIndex, onPick)}
          {renderGroup("History", groups.history, flatResults, selectedIndex, onPick)}
          {!hasLocalResults && query.trim() && <p className="no-results">没有结果</p>}
          {renderGroup("Google", flatResults.filter((result) => result.kind === "google-search"), flatResults, selectedIndex, onPick)}
          {flatResults.length === 0 && <p className="no-results">输入关键词开始搜索</p>}
        </div>
      </section>
    </div>
  );
};

const renderGroup = (
  label: string,
  results: SearchResult[],
  flatResults: SearchResult[],
  selectedIndex: number,
  onPick: (result: SearchResult) => void
) => {
  if (results.length === 0) {
    return null;
  }
  return (
    <section className="result-group" key={label}>
      <h3>{label}</h3>
      {results.map((result) => {
        const index = flatResults.findIndex((item) => item.id === result.id);
        return (
          <button
            className={index === selectedIndex ? "is-selected" : ""}
            data-testid="search-result"
            key={result.id}
            type="button"
            onClick={() => onPick(result)}
          >
            <strong>{result.title}</strong>
            {result.subtitle && <small>{result.subtitle}</small>}
          </button>
        );
      })}
    </section>
  );
};

const Icon = ({ name }: { name: IconName }) => {
  const paths: Record<IconName, React.ReactNode> = {
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "chevron-right": <path d="m9 6 6 6-6 6" />,
    check: <path d="m5 12 4 4 10-10" />,
    "check-square": (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="m8 12 3 3 5-5" />
      </>
    ),
    copy: (
      <>
        <rect width="10" height="10" x="8" y="8" rx="2" />
        <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1l-.8.8" />
        <path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" />
      </>
    ),
    "panel-right": (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M15 3v18" />
        <path d="m10 9-3 3 3 3" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    refresh: (
      <>
        <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
        <path d="M3 21v-5h5" />
        <path d="M3 12A9 9 0 0 1 18.3 5.6L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    settings: (
      <>
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </>
    ),
    x: (
      <>
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </>
    )
  };

  return (
    <svg aria-hidden="true" className="button-icon" focusable="false" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
};

const getSearchResultsWithGoogleFallback = (query: string, localResults: SearchResult[]): SearchResult[] => {
  const trimmedQuery = query.trim();
  if (localResults.length > 0 || !trimmedQuery) {
    return localResults;
  }

  return [
    {
      id: `google-search:${trimmedQuery}`,
      kind: "google-search",
      title: `用 Google 搜索 "${trimmedQuery}"`,
      subtitle: "没有 TabDock 结果",
      url: buildGoogleSearchUrl(trimmedQuery)
    }
  ];
};

const buildGoogleSearchUrl = (query: string): string =>
  `https://www.google.com/search?q=${encodeURIComponent(query)}`;

const moveOpenTabBetweenBlocks = (
  blocks: OpenTabBlock[],
  tab: OpenTab,
  targetWindowId: number
): OpenTabBlock[] => {
  const sourceWindowId = tab.windowId;
  const hasSourceBlock = blocks.some((block) => block.windowId === sourceWindowId);
  const hasTargetBlock = blocks.some((block) => block.windowId === targetWindowId);
  if (!hasSourceBlock || !hasTargetBlock || sourceWindowId === targetWindowId) {
    return blocks;
  }

  return blocks
    .flatMap((block) => {
      if (block.windowId === sourceWindowId) {
        const tabs = block.tabs.filter((item) => item.id !== tab.id);
        return tabs.length > 0 ? [{ ...block, tabs }] : [];
      }
      if (block.windowId === targetWindowId) {
        return [
          {
            ...block,
            tabs: [...block.tabs.filter((item) => item.id !== tab.id), { ...tab, windowId: targetWindowId }]
          }
        ];
      }
      return [block];
    })
    .map(labelOpenTabBlock);
};

const removeOpenTabFromBlocks = (blocks: OpenTabBlock[], tabId: number): OpenTabBlock[] =>
  blocks
    .flatMap((block) => {
      const tabs = block.tabs.filter((tab) => tab.id !== tabId);
      return tabs.length > 0 ? [{ ...block, tabs }] : [];
    })
    .map(labelOpenTabBlock);

const relabelOpenBlocks = (blocks: OpenTabBlock[]): OpenTabBlock[] => blocks.map(labelOpenTabBlock);

const labelOpenTabBlock = (block: OpenTabBlock, index: number): OpenTabBlock => ({
  ...block,
  label: `Window ${index + 1} · ${block.tabs.length} tabs`
});

const writeDragPayload = (event: React.DragEvent, payload: DragPayload) => {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/json", JSON.stringify(payload));
};

const readDragPayload = (event: React.DragEvent): DragPayload | undefined => {
  try {
    return JSON.parse(event.dataTransfer.getData("application/json")) as DragPayload;
  } catch {
    return undefined;
  }
};

const scrollStackIntoView = (stackId: string) => {
  window.setTimeout(() =>
    document
      .getElementById(`stack-${stackId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  );
};

const formatStackName = (timestamp: number): string =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })
    .format(timestamp)
    .replace(/\//g, "-");
