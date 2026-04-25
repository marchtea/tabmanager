import { describe, expect, it, vi } from "vitest";
import {
  closeDuplicateOpenTabs,
  closeOpenTab,
  closeOpenWindow,
  buildGlobalSearchGroups,
  focusOrCreateTab,
  focusOrOpenTabManager,
  getChrome,
  getGlobalSearchShortcut,
  getMetaDescription,
  handleGlobalSearchResult,
  loadLocalState,
  loadSettings,
  loadWorkspace,
  groupOpenTabs,
  isTabManagerUrl,
  moveOpenTabToWindow,
  saveLocalState,
  saveSettings,
  saveWorkspace,
  searchRecentHistory,
  subscribeToOpenTabsChanges
} from "./chromeApi";
import type { ChromeLike } from "./chromeTypes";

describe("chrome api adapter", () => {
  it("groups open tabs by window and excludes the TabDock page itself", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, windowId: 10, title: "Manager", url: "chrome-extension://abc/index.html" },
          { id: 2, windowId: 10, title: "Docs", url: "https://docs.test", favIconUrl: "https://docs.test/icon.png" },
          { id: 3, windowId: 11, title: "Mail", url: "https://mail.test" }
        ])
      },
      runtime: { id: "abc" }
    } satisfies ChromeLike;

    const blocks = await groupOpenTabs(chrome);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ windowId: 10, label: "Window 1 · 1 tabs" });
    expect(blocks[0].tabs[0]).toMatchObject({ id: 2, title: "Docs", faviconUrl: "https://docs.test/icon.png" });
  });

  it("handles missing or partial Chrome tab APIs", async () => {
    await expect(groupOpenTabs({})).resolves.toEqual([]);
    await expect(
      groupOpenTabs({
        tabs: {
          query: vi.fn().mockResolvedValue([{ id: 1, windowId: 1 }, { windowId: 1, url: "https://missing-id.test" }])
        }
      })
    ).resolves.toEqual([]);
  });

  it("focuses an existing open tab for the same URL before creating a new tab", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 4, windowId: 12, url: "https://example.com/path#section" }]),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({})
      },
      windows: {
        update: vi.fn().mockResolvedValue({})
      }
    } satisfies ChromeLike;

    await focusOrCreateTab(chrome, "https://example.com/path");

    expect(chrome.windows.update).toHaveBeenCalledWith(12, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(4, { active: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("creates a new tab when no open tab has the URL", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({})
      }
    } satisfies ChromeLike;

    await focusOrCreateTab(chrome, "https://new.test");

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://new.test" });
  });

  it("focuses an existing TabDock tab before opening a new manager page", async () => {
    const chrome = {
      runtime: {
        id: "abc",
        getURL: vi.fn((path: string) => `chrome-extension://abc/${path}`)
      },
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 4, windowId: 12, url: "chrome-extension://abc/index.html" }
        ]),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({})
      },
      windows: {
        update: vi.fn().mockResolvedValue({})
      }
    } satisfies ChromeLike;

    await focusOrOpenTabManager(chrome, { search: "1", stack: "stack-1" });

    expect(chrome.windows.update).toHaveBeenCalledWith(12, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(4, {
      active: true,
      url: "chrome-extension://abc/index.html?search=1&stack=stack-1"
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("activates a tab even when window focusing is unavailable", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 4, url: "https://example.com/path" }]),
        update: vi.fn().mockResolvedValue({})
      }
    } satisfies ChromeLike;

    await focusOrCreateTab(chrome, "https://example.com/path");

    expect(chrome.tabs.update).toHaveBeenCalledWith(4, { active: true });
  });

  it("moves an open tab into another Chrome window at the end", async () => {
    const chrome = {
      tabs: {
        move: vi.fn().mockResolvedValue({})
      }
    } satisfies ChromeLike;

    await moveOpenTabToWindow(chrome, 4, 12);

    expect(chrome.tabs.move).toHaveBeenCalledWith(4, { windowId: 12, index: -1 });
  });

  it("ignores open tab window moves when the Chrome move API is unavailable", async () => {
    await expect(moveOpenTabToWindow({}, 4, 12)).resolves.toBeUndefined();
  });

  it("closes an open Chrome tab", async () => {
    const chrome = {
      tabs: {
        remove: vi.fn().mockResolvedValue(undefined)
      }
    } satisfies ChromeLike;

    await closeOpenTab(chrome, 4);

    expect(chrome.tabs.remove).toHaveBeenCalledWith(4);
  });

  it("ignores tab closes when the Chrome remove API is unavailable", async () => {
    await expect(closeOpenTab({}, 4)).resolves.toBeUndefined();
  });

  it("closes an open Chrome window", async () => {
    const chrome = {
      windows: {
        remove: vi.fn().mockResolvedValue(undefined)
      }
    } satisfies ChromeLike;

    await closeOpenWindow(chrome, 12);

    expect(chrome.windows.remove).toHaveBeenCalledWith(12);
  });

  it("ignores window closes when the Chrome remove API is unavailable", async () => {
    await expect(closeOpenWindow({}, 12)).resolves.toBeUndefined();
  });

  it("subscribes to open tab create, update, and remove events and cleans up listeners", () => {
    const chrome = {
      tabs: {
        onCreated: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        },
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        },
        onRemoved: {
          addListener: vi.fn(),
          removeListener: vi.fn()
        }
      }
    } satisfies ChromeLike;
    const onChange = vi.fn();

    const cleanup = subscribeToOpenTabsChanges(chrome, onChange);
    const createdListener = chrome.tabs.onCreated.addListener.mock.calls[0][0];
    const updatedListener = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
    const removedListener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];

    createdListener({ id: 4, windowId: 12, url: "https://created.test" });
    updatedListener(4, { url: "https://updated.test" }, { id: 4, windowId: 12, url: "https://updated.test" });
    removedListener(4, { windowId: 12, isWindowClosing: false });
    cleanup();

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(chrome.tabs.onCreated.removeListener).toHaveBeenCalledWith(createdListener);
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledWith(updatedListener);
    expect(chrome.tabs.onRemoved.removeListener).toHaveBeenCalledWith(removedListener);
  });

  it("returns a no-op open tab changes cleanup when Chrome tab events are unavailable", () => {
    const cleanup = subscribeToOpenTabsChanges({}, vi.fn());

    expect(cleanup()).toBeUndefined();
  });

  it("closes duplicate open tabs across all Chrome windows and keeps the first matching URL", async () => {
    const chrome = {
      runtime: { id: "abc" },
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, windowId: 10, title: "Manager", url: "chrome-extension://abc/index.html" },
          { id: 2, windowId: 10, title: "React", url: "https://react.dev/" },
          { id: 3, windowId: 20, title: "React Docs", url: "https://react.dev/#docs" },
          { id: 4, windowId: 20, title: "Vite", url: "https://vite.dev" },
          { id: 5, windowId: 30, title: "Vite Duplicate", url: "https://vite.dev/" }
        ]),
        remove: vi.fn().mockResolvedValue(undefined)
      }
    } satisfies ChromeLike;

    await expect(closeDuplicateOpenTabs(chrome)).resolves.toBe(2);

    expect(chrome.tabs.remove).toHaveBeenCalledWith([3, 5]);
  });

  it("uses populated Chrome windows to find duplicate tabs outside the current window", async () => {
    const chrome = {
      runtime: { id: "abc" },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 2, windowId: 10, title: "React", url: "https://react.dev/" }]),
        remove: vi.fn().mockResolvedValue(undefined)
      },
      windows: {
        getAll: vi.fn().mockResolvedValue([
          {
            id: 10,
            tabs: [
              { id: 2, title: "React", url: "https://react.dev/" },
              { id: 4, title: "Vite", url: "https://vite.dev" }
            ]
          },
          {
            id: 20,
            tabs: [
              { id: 3, title: "React Duplicate", url: "https://react.dev/#docs" },
              { id: 5, title: "Docs", url: "https://docs.test" }
            ]
          }
        ])
      }
    } satisfies ChromeLike;

    await expect(closeDuplicateOpenTabs(chrome)).resolves.toBe(1);

    expect(chrome.windows.getAll).toHaveBeenCalledWith({ populate: true });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.remove).toHaveBeenCalledWith([3]);
  });

  it("does not close tabs when no duplicate open URLs are found", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 2, windowId: 10, title: "React", url: "https://react.dev" },
          { id: 4, windowId: 20, title: "Vite", url: "https://vite.dev" }
        ]),
        remove: vi.fn().mockResolvedValue(undefined)
      }
    } satisfies ChromeLike;

    await expect(closeDuplicateOpenTabs(chrome)).resolves.toBe(0);

    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it("returns undefined when meta description injection fails", async () => {
    const chrome = {
      scripting: {
        executeScript: vi.fn().mockRejectedValue(new Error("Cannot access page"))
      }
    } satisfies ChromeLike;

    await expect(getMetaDescription(chrome, 99)).resolves.toBeUndefined();
  });

  it("reads meta description when injection succeeds", async () => {
    const chrome = {
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: "  Useful summary  " }])
      }
    } satisfies ChromeLike;

    await expect(getMetaDescription(chrome, 99)).resolves.toBe("Useful summary");
  });

  it("returns undefined when meta description is empty or scripting is unavailable", async () => {
    await expect(getMetaDescription({}, 1)).resolves.toBeUndefined();
    await expect(
      getMetaDescription(
        { scripting: { executeScript: vi.fn().mockResolvedValue([{ result: "   " }]) } },
        1
      )
    ).resolves.toBeUndefined();
  });

  it("searches recent history through Chrome", async () => {
    const now = Date.UTC(2026, 3, 18);
    const chrome = {
      history: {
        search: vi.fn().mockResolvedValue([
          { id: "h1", title: "Docs", url: "https://docs.test", lastVisitTime: now }
        ])
      }
    } satisfies ChromeLike;

    const result = await searchRecentHistory(chrome, "docs", now, 10);

    expect(chrome.history.search).toHaveBeenCalledWith({
      text: "docs",
      startTime: now - 90 * 24 * 60 * 60 * 1000,
      maxResults: 10
    });
    expect(result).toEqual([
      { id: "h1", title: "Docs", url: "https://docs.test", lastVisitTime: now }
    ]);
  });

  it("handles missing and incomplete history records", async () => {
    const chrome = {
      history: {
        search: vi.fn().mockResolvedValue([
          { id: "skip", title: "Skip" },
          { url: "https://fallback.test" }
        ])
      }
    } satisfies ChromeLike;

    await expect(searchRecentHistory(chrome, "", 1000)).resolves.toEqual([
      {
        id: "https://fallback.test",
        title: "https://fallback.test",
        url: "https://fallback.test",
        lastVisitTime: 0
      }
    ]);
    await expect(searchRecentHistory({}, "", 1000)).resolves.toEqual([]);
  });

  it("loads and saves workspace state with versioned local storage and legacy fallback", async () => {
    const state = { spaceIds: [], spaces: {}, stacks: {}, tabs: {}, activeSpaceId: undefined };
    const chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ tabManagerWorkspace: state, tabManagerSettings: { appSearchShortcut: "Ctrl+K" } }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    } satisfies ChromeLike;

    await expect(loadWorkspace(chrome)).resolves.toEqual(state);
    await expect(loadLocalState(chrome)).resolves.toMatchObject({
      format: "tabdock.local-state",
      schemaVersion: 1,
      workspace: state,
      settings: { appSearchShortcut: "Ctrl+K" }
    });
    await saveWorkspace(chrome, state);
    await expect(loadWorkspace(undefined)).resolves.toEqual({ spaceIds: [], spaces: {}, stacks: {}, tabs: {} });
    await expect(loadWorkspace({ storage: { local: { get: vi.fn().mockResolvedValue({ tabManagerWorkspace: null }) } } })).resolves.toEqual({
      spaceIds: [],
      spaces: {},
      stacks: {},
      tabs: {}
    });
    await expect(saveWorkspace(undefined, state)).resolves.toBeUndefined();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      "tabdock:local-state:v1": expect.objectContaining({
        format: "tabdock.local-state",
        workspace: state
      })
    });
  });

  it("loads settings and reads Chrome command shortcuts", async () => {
    const chrome = {
      commands: {
        getAll: vi.fn().mockResolvedValue([
          { name: "other", shortcut: "Ctrl+J" },
          { name: "open_global_search", shortcut: "Ctrl+Shift+K" }
        ])
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ tabManagerSettings: { appSearchShortcut: "Ctrl+K" } }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    } satisfies ChromeLike;

    await expect(loadSettings(chrome)).resolves.toEqual({ appSearchShortcut: "Ctrl+K" });
    await expect(getGlobalSearchShortcut(chrome)).resolves.toBe("Ctrl+Shift+K");
    await expect(getGlobalSearchShortcut(undefined)).resolves.toBe("Command+Shift+K");
    await saveSettings(chrome, { appSearchShortcut: "Command+K" });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      "tabdock:local-state:v1": expect.objectContaining({
        settings: { appSearchShortcut: "Command+K" }
      })
    });
  });

  it("prefers the versioned local state over legacy workspace keys", async () => {
    const chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            "tabdock:local-state:v1": {
              format: "tabdock.local-state",
              schemaVersion: 1,
              updatedAt: 123,
              workspace: { spaceIds: ["space-1"], spaces: { "space-1": { id: "space-1", name: "New", stackIds: [], createdAt: 1, updatedAt: 1 } }, stacks: {}, tabs: {} },
              settings: { appSearchShortcut: "Alt+J" }
            },
            tabManagerWorkspace: { spaceIds: [], spaces: {}, stacks: {}, tabs: {} }
          }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    } satisfies ChromeLike;

    await expect(loadLocalState(chrome)).resolves.toMatchObject({
      updatedAt: 123,
      workspace: { spaceIds: ["space-1"] },
      settings: { appSearchShortcut: "Alt+J" }
    });
    await saveLocalState(chrome, { spaceIds: [], spaces: {}, stacks: {}, tabs: {} }, { appSearchShortcut: "Ctrl+K" });
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      "tabdock:local-state:v1": expect.objectContaining({ settings: { appSearchShortcut: "Ctrl+K" } })
    });
  });

  it("builds global search groups and dispatches picked results", async () => {
    const now = Date.UTC(2026, 3, 18);
    const chrome = {
      runtime: {
        id: "abc",
        getURL: vi.fn((path: string) => `chrome-extension://abc/${path}`)
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            tabManagerWorkspace: {
              spaceIds: ["space-1"],
              spaces: {
                "space-1": { id: "space-1", name: "AI Research", stackIds: [], createdAt: now, updatedAt: now }
              },
              stacks: {},
              tabs: {}
            }
          })
        }
      },
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({})
      },
      history: {
        search: vi.fn().mockResolvedValue([])
      }
    } satisfies ChromeLike;

    const groups = await buildGlobalSearchGroups(chrome, "AI", now);
    await handleGlobalSearchResult(chrome, groups.spaces[0]);

    expect(groups.spaces[0]).toMatchObject({ title: "AI Research", kind: "space" });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://abc/index.html?space=space-1"
    });
  });

  it("identifies the extension newtab page", () => {
    expect(isTabManagerUrl("chrome-extension://abc/index.html", "abc")).toBe(true);
    expect(isTabManagerUrl("https://example.test", "abc")).toBe(false);
    expect(isTabManagerUrl(undefined, "abc")).toBe(false);
    expect(isTabManagerUrl("chrome-extension://abc/index.html", undefined)).toBe(false);
  });

  it("detects the runtime Chrome object when present", () => {
    expect(getChrome()).toBeUndefined();
    vi.stubGlobal("chrome", { runtime: { id: "abc" } });
    expect(getChrome()).toBeUndefined();
    vi.stubGlobal("chrome", { runtime: { id: "abc" }, storage: { local: {} } });
    expect(getChrome()).toEqual({ runtime: { id: "abc" }, storage: { local: {} } });
    vi.unstubAllGlobals();
  });
});
