import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeOpenTab,
  closeOpenWindow,
  closeDuplicateOpenTabs,
  focusOrCreateTab,
  getChrome,
  getGlobalSearchShortcut,
  groupOpenTabs,
  loadSettings,
  loadWorkspace,
  moveOpenTabToWindow,
  saveSettings,
  saveWorkspace,
  searchRecentHistory,
  subscribeToOpenTabsChanges
} from "./chrome/chromeApi";
import { buildSearchGroups } from "./domain/search";
import {
  DEFAULT_GLOBAL_SEARCH_SHORTCUT,
  formatShortcutForPlatform,
  shortcutFromEvent,
  shortcutMatchesEvent
} from "./domain/settings";
import type { HistoryEntry, OpenTab, OpenTabBlock, SearchGroups, SearchResult, TabManagerSettings } from "./domain/types";
import {
  createIdGenerator,
  createSpace,
  createStack,
  deleteSpace,
  deleteStack,
  emptyWorkspaceState,
  getActiveSpace,
  getOrderedSpaces,
  moveSavedTab,
  moveSpace,
  moveStack,
  renameSpace,
  renameStack,
  saveOpenTabToStack,
  saveOpenWindowAsStack
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
  | "edit"
  | "link"
  | "panel-right"
  | "plus"
  | "refresh"
  | "search"
  | "settings"
  | "trash";

const now = () => Date.now();

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
  const [loaded, setLoaded] = useState(false);
  const didHandleInitialUrlRef = useRef(false);

  const activeSpace = getActiveSpace(workspace);
  const activeStacks = activeSpace?.stackIds.map((id) => workspace.stacks[id]).filter(Boolean) ?? [];
  const activeSavedTabCount = activeStacks.reduce((total, stack) => total + stack.tabIds.length, 0);
  const orderedSpaces = getOrderedSpaces(workspace);
  const openTabCount = openBlocks.reduce((total, block) => total + block.tabs.length, 0);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const appSearchShortcutLabel = formatShortcutForPlatform(settings.appSearchShortcut, isMac);
  const globalSearchShortcutLabel = formatShortcutForPlatform(globalSearchShortcut, isMac);
  const searchGroups = useMemo(
    () => buildSearchGroups(query, workspace, openBlocks, historyEntries, now()),
    [historyEntries, openBlocks, query, workspace]
  );
  const flatResults = flattenSearchGroups(searchGroups);

  const refreshOpenTabs = useCallback(async () => {
    if (!chromeApi) {
      return;
    }
    const blocks = await groupOpenTabs(chromeApi);
    setOpenBlocks(blocks);
  }, [chromeApi]);

  useEffect(() => {
    const load = async () => {
      const [saved, savedSettings, savedGlobalShortcut] = await Promise.all([
        loadWorkspace(chromeApi),
        loadSettings(chromeApi),
        getGlobalSearchShortcut(chromeApi)
      ]);
      setWorkspace(saved);
      setSettings(savedSettings);
      setGlobalSearchShortcut(savedGlobalShortcut);
      setLoaded(true);
    };
    void load();
  }, [chromeApi]);

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
    void saveWorkspace(chromeApi, workspace);
  }, [chromeApi, loaded, workspace]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    void saveSettings(chromeApi, settings);
  }, [chromeApi, loaded, settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shortcutMatchesEvent(settings.appSearchShortcut, event)) {
        event.preventDefault();
        setIsSearchOpen(true);
      }
      if (event.key === "Escape") {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings.appSearchShortcut]);

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

  const setActiveSpace = (spaceId: string) => {
    setWorkspace((state) => ({ ...state, activeSpaceId: spaceId }));
  };

  const handleResult = async (result: SearchResult) => {
    if (result.kind === "space" && result.spaceId) {
      setActiveSpace(result.spaceId);
    }
    if (result.kind === "stack" && result.spaceId && result.stackId) {
      setActiveSpace(result.spaceId);
      scrollStackIntoView(result.stackId);
    }
    if ((result.kind === "saved-tab" || result.kind === "open-tab" || result.kind === "history") && result.url) {
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
              TM
            </span>
            <h1>Tab Manager</h1>
          </div>
          <button className="icon-button" data-testid="add-space" type="button" title="新增 Space" onClick={createNewSpace}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="sidebar-controls">
          <button className="search-entry" data-testid="search-entry" type="button" onClick={() => setIsSearchOpen(true)}>
            <Icon name="search" />
            <span>搜索</span>
            <kbd>{appSearchShortcutLabel}</kbd>
          </button>
          <button className="settings-entry" data-testid="settings-entry" type="button" onClick={() => setIsSettingsOpen(true)}>
            <Icon name="settings" />
            <span>设置</span>
          </button>
        </div>
        <nav className="space-list" aria-label="Spaces">
          {orderedSpaces.map((space) => (
            <section className="space-group" data-testid="space-group" key={space.id}>
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

        <div className="stack-board">
          {activeStacks.map((stack) => (
            <article
              className="stack-column"
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
                <h3>{stack.name}</h3>
                <div className="stack-actions">
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
              <div className="tab-list">
                {stack.tabIds.map((tabId) => {
                  const tab = workspace.tabs[tabId];
                  if (!tab) {
                    return null;
                  }
                  return (
                    <button
                      className="saved-tab"
                      data-testid="saved-tab"
                      draggable
                      key={tab.id}
                      type="button"
                      onClick={() => void openUrl(tab.url)}
                      onDragStart={(event) => {
                        event.stopPropagation();
                        writeDragPayload(event, { type: "saved-tab", tabId: tab.id });
                      }}
                    >
                      <span className="favicon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : <Icon name="link" />}</span>
                      <span>
                        <strong>{tab.title}</strong>
                        <small>{tab.description || tab.url}</small>
                      </span>
                    </button>
                  );
                })}
                {stack.tabIds.length === 0 && <p className="drop-hint">从右侧拖入 Tab</p>}
              </div>
            </article>
          ))}
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
          <p className="eyebrow">Open Tabs</p>
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
          appSearchShortcut={settings.appSearchShortcut}
          appSearchShortcutLabel={appSearchShortcutLabel}
          globalSearchShortcutLabel={globalSearchShortcutLabel}
          onClose={() => setIsSettingsOpen(false)}
          onOpenChromeShortcuts={() => void openUrl("chrome://extensions/shortcuts")}
          onSetAppSearchShortcut={(shortcut) =>
            setSettings((currentSettings) => ({ ...currentSettings, appSearchShortcut: shortcut }))
          }
        />
      )}
    </main>
  );
};

const SettingsModal = ({
  appSearchShortcut,
  appSearchShortcutLabel,
  globalSearchShortcutLabel,
  onClose,
  onOpenChromeShortcuts,
  onSetAppSearchShortcut
}: {
  appSearchShortcut: string;
  appSearchShortcutLabel: string;
  globalSearchShortcutLabel: string;
  onClose: () => void;
  onOpenChromeShortcuts: () => void;
  onSetAppSearchShortcut: (shortcut: string) => void;
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
          data-testid="app-search-shortcut"
          readOnly
          value={appSearchShortcutLabel}
          onKeyDown={(event) => {
            event.preventDefault();
            const shortcut = shortcutFromEvent(event.nativeEvent);
            if (shortcut) {
              onSetAppSearchShortcut(shortcut);
            }
          }}
        />
      </label>
      <label className="shortcut-field">
        <span>全局搜索快捷键</span>
        <input aria-label="全局搜索快捷键" readOnly value={globalSearchShortcutLabel} />
      </label>
      <button className="settings-link-button" type="button" onClick={onOpenChromeShortcuts}>
        在 Chrome 中修改全局快捷键
      </button>
      <p className="settings-note">当前应用内快捷键：{appSearchShortcut}</p>
    </section>
  </div>
);

const SearchModal = ({
  flatResults,
  groups,
  onClose,
  onPick,
  query,
  selectedIndex,
  setQuery,
  setSelectedIndex
}: {
  flatResults: SearchResult[];
  groups: SearchGroups;
  onClose: () => void;
  onPick: (result: SearchResult) => void;
  query: string;
  selectedIndex: number;
  setQuery: (value: string) => void;
  setSelectedIndex: (value: number) => void;
}) => (
  <div className="search-backdrop" onMouseDown={onClose}>
    <section className="search-modal" data-testid="search-modal" onMouseDown={(event) => event.stopPropagation()}>
      <input
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
        {renderGroup("Saved Tabs", groups.savedTabs, flatResults, selectedIndex, onPick)}
        {renderGroup("Open Tabs", groups.openTabs, flatResults, selectedIndex, onPick)}
        {renderGroup("History", groups.history, flatResults, selectedIndex, onPick)}
        {flatResults.length === 0 && <p className="no-results">没有结果</p>}
      </div>
    </section>
  </div>
);

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
    )
  };

  return (
    <svg aria-hidden="true" className="button-icon" focusable="false" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
};

const flattenSearchGroups = (groups: SearchGroups): SearchResult[] => [
  ...groups.spaces,
  ...groups.stacks,
  ...groups.savedTabs,
  ...groups.openTabs,
  ...groups.history
];

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
