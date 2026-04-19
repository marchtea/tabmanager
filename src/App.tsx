import { useEffect, useMemo, useRef, useState } from "react";
import {
  focusOrCreateTab,
  getChrome,
  groupOpenTabs,
  loadWorkspace,
  moveOpenTabToWindow,
  saveWorkspace,
  searchRecentHistory
} from "./chrome/chromeApi";
import { buildSearchGroups } from "./domain/search";
import type { HistoryEntry, OpenTab, OpenTabBlock, SearchGroups, SearchResult } from "./domain/types";
import {
  createIdGenerator,
  createSpace,
  createStack,
  deleteSpace,
  deleteStack,
  emptyWorkspaceState,
  getActiveSpace,
  moveSavedTab,
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
  | { type: "stack"; stackId: string };

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
  const [openBlocks, setOpenBlocks] = useState<OpenTabBlock[]>(demoOpenBlocks);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [collapsedOpenBlockIds, setCollapsedOpenBlockIds] = useState<ReadonlySet<number>>(() => new Set());
  const [loaded, setLoaded] = useState(false);

  const activeSpace = getActiveSpace(workspace);
  const activeStacks = activeSpace?.stackIds.map((id) => workspace.stacks[id]).filter(Boolean) ?? [];
  const searchGroups = useMemo(
    () => buildSearchGroups(query, workspace, openBlocks, historyEntries, now()),
    [historyEntries, openBlocks, query, workspace]
  );
  const flatResults = flattenSearchGroups(searchGroups);

  useEffect(() => {
    const load = async () => {
      const saved = await loadWorkspace(chromeApi);
      setWorkspace(saved);
      setLoaded(true);
    };
    void load();
  }, [chromeApi]);

  useEffect(() => {
    if (!chromeApi) {
      return;
    }
    const refresh = async () => {
      const blocks = await groupOpenTabs(chromeApi);
      setOpenBlocks(blocks);
    };
    void refresh();
  }, [chromeApi]);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    void saveWorkspace(chromeApi, workspace);
  }, [chromeApi, loaded, workspace]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsSearchOpen(true);
      }
      if (event.key === "Escape") {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
          <h1>Tab Manager</h1>
          <button className="icon-button" data-testid="add-space" type="button" title="新增 Space" onClick={createNewSpace}>
            +
          </button>
        </div>
        <button className="search-entry" data-testid="search-entry" type="button" onClick={() => setIsSearchOpen(true)}>
          <span>搜索</span>
          <kbd>⌘K</kbd>
        </button>
        <nav className="space-list" aria-label="Spaces">
          {Object.values(workspace.spaces).map((space) => (
            <section className="space-group" data-testid="space-group" key={space.id}>
              <div className={`space-row ${space.id === activeSpace?.id ? "is-active" : ""}`}>
                <button type="button" onClick={() => setActiveSpace(space.id)}>
                  {space.name}
                </button>
                <button
                  className="tiny-button"
                  data-testid="rename-space"
                  type="button"
                  title="重命名 Space"
                  onClick={() => renameCurrentSpace(space.id, space.name)}
                >
                  ✎
                </button>
                <button
                  className="tiny-button danger"
                  data-testid="delete-space"
                  type="button"
                  title="删除 Space"
                  onClick={() => removeCurrentSpace(space.id, space.name)}
                >
                  ×
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
        className="workspace"
        data-testid="workspace"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropOnWorkspace}
      >
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2>{activeSpace?.name ?? "未选择 Space"}</h2>
          </div>
          <button
            className="icon-button primary"
            data-testid="add-stack"
            type="button"
            title="新增 Stack"
            onClick={createNewStack}
          >
            +
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
                    ✎
                  </button>
                  <button
                    data-testid="delete-stack"
                    type="button"
                    title="删除 Stack"
                    onClick={() => removeCurrentStack(stack.id, stack.name)}
                  >
                    ×
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
                      <span className="favicon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : "◇"}</span>
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

      <aside className="open-tabs-panel" data-testid="open-tabs-panel">
        <header>
          <p className="eyebrow">Open Tabs</p>
          <button
            className="tiny-button"
            type="button"
            title="刷新"
            onClick={() => chromeApi && void groupOpenTabs(chromeApi).then(setOpenBlocks)}
          >
            ↻
          </button>
        </header>
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
              <button
                aria-expanded={!collapsedOpenBlockIds.has(block.windowId)}
                className="open-block-title"
                data-testid="open-block-title"
                draggable
                type="button"
                onClick={() => toggleOpenBlock(block.windowId)}
                onDragStart={(event) => writeDragPayload(event, { type: "open-block", windowId: block.windowId })}
              >
                <span aria-hidden="true">{collapsedOpenBlockIds.has(block.windowId) ? "▸" : "▾"}</span>
                <span>{block.label}</span>
              </button>
              {!collapsedOpenBlockIds.has(block.windowId) &&
                block.tabs.map((tab) => (
                  <button
                    className="open-tab"
                    data-testid="open-tab"
                    draggable
                    key={`${tab.windowId}:${tab.id}`}
                    type="button"
                    onClick={() => void openUrl(tab.url)}
                    onDragStart={(event) => {
                      event.stopPropagation();
                      writeDragPayload(event, { type: "open-tab", tab });
                    }}
                  >
                    <span className="favicon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : "◇"}</span>
                    <span>
                      <strong>{tab.title}</strong>
                      <small>{tab.url}</small>
                    </span>
                  </button>
                ))}
            </section>
          ))}
        </div>
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
    </main>
  );
};

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
    .map((block, index) => ({
      ...block,
      label: `Window ${index + 1} · ${block.tabs.length} tabs`
    }));
};

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
